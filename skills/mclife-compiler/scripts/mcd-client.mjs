/**
 * mcd-client.mjs — 麦当劳中国官方 MCP Server (https://mcp.mcd.cn) 最小可用客户端
 *
 * 协议：MCP Streamable HTTP
 *   - POST {endpoint}  body = JSON-RPC 2.0
 *   - 请求头必须携带 Authorization: Bearer <MCP_TOKEN>
 *   - Accept 必须同时包含 application/json 与 text/event-stream
 *   - 服务端可能在 initialize 响应中返回 Mcp-Session-Id，后续请求需回带
 *
 * 设计原则：
 *   1. Token 只从环境变量读取，永不落盘、永不进日志。
 *   2. 任何失败都返回结构化 {ok:false, error:{code,message}}，不抛裸异常，
 *      让上层可以优雅降级而不是崩溃。
 */

const DEFAULT_ENDPOINT = 'https://mcp.mcd.cn';
const PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_TIMEOUT_MS = 30000;

/** 本项目实际使用的工具（与 MCP_INTEGRATION.md 保持一致） */
export const TOOLS_USED = Object.freeze([
  'now-time-info',
  'list-nutrition-foods',
  'campaign-calendar',
  'query-my-account',
  'query-my-coupons',
  'available-coupons',
  'query-meals',
  'calculate-price',
  'query-store-coupons',
]);

export class McdMcpError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'McdMcpError';
    this.code = code;
    this.detail = detail;
  }
}

/** 从多种环境变量命名中读取 Token（不打印值） */
export function resolveToken(env = process.env) {
  const token =
    env.MCD_MCP_TOKEN ||
    env.MCD_MCP_SERVER_TOKEN ||
    env.MCP_TOKEN ||
    env.MCD_TOKEN ||
    '';
  return token.trim();
}

export function hasToken(env = process.env) {
  return Boolean(resolveToken(env));
}

function buildHeaders(token, sessionId) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'User-Agent': 'mclife-compiler/1.0.0 (non-official)',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  return headers;
}

/**
 * Streamable HTTP 允许服务端返回 application/json 或 text/event-stream(SSE)。
 * 这里把 SSE 帧解析成 JSON-RPC 消息，取出 id 匹配的那条。
 */
function parseSseOrJson(text, contentType = '') {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (contentType.includes('text/event-stream') || trimmed.startsWith('event:') || trimmed.startsWith('data:')) {
    const messages = [];
    for (const block of trimmed.split(/\r?\n\r?\n/)) {
      const dataLines = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim());
      if (dataLines.length === 0) continue;
      const payload = dataLines.join('');
      try {
        messages.push(JSON.parse(payload));
      } catch {
        /* 忽略非 JSON 心跳帧 */
      }
    }
    return messages;
  }
  try {
    return [JSON.parse(trimmed)];
  } catch {
    throw new McdMcpError('BAD_RESPONSE', `无法解析 MCP 响应: ${trimmed.slice(0, 200)}`);
  }
}

export class McdMcpClient {
  /**
   * @param {object} opts
   * @param {string} [opts.endpoint] MCP 地址，默认 https://mcp.mcd.cn
   * @param {string} [opts.token]    MCP Token；不传则读环境变量
   * @param {number} [opts.timeoutMs]
   */
  constructor(opts = {}) {
    this.endpoint = (opts.endpoint || process.env.MCD_MCP_URL || DEFAULT_ENDPOINT).replace(/\/+$/, '');
    this.token = (opts.token || resolveToken()).trim();
    this.timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.sessionId = null;
    this.initialized = false;
    this._serverInfo = null;
    this._id = 0;
  }

  get hasToken() {
    return Boolean(this.token);
  }

  _nextId() {
    this._id += 1;
    return this._id;
  }

  async _rpc(method, params, { expectResponse = true } = {}) {
    const body = { jsonrpc: '2.0', method, params };
    if (expectResponse) body.id = this._nextId();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res;
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers: buildHeaders(this.token, this.sessionId),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        throw new McdMcpError('TIMEOUT', `MCP 请求超时 (${this.timeoutMs}ms): ${method}`);
      }
      throw new McdMcpError('NETWORK', `无法连接麦当劳 MCP Server (${this.endpoint}): ${err.message}`);
    }
    clearTimeout(timer);

    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;

    const text = await res.text();
    const contentType = res.headers.get('content-type') || '';

    if (res.status === 401) {
      throw new McdMcpError(
        'UNAUTHORIZED',
        'MCP Token 无效或未配置。请在 https://open.mcd.cn/mcp 申请 Token，并设置环境变量 MCD_MCP_TOKEN。',
      );
    }
    if (res.status === 429) {
      throw new McdMcpError('RATE_LIMIT', '触发麦当劳 MCP 限流（每 Token 每分钟 600 次），请降低调用频率。');
    }
    if (!res.ok) {
      throw new McdMcpError('HTTP_ERROR', `MCP 返回 HTTP ${res.status}`, text.slice(0, 300));
    }

    const messages = parseSseOrJson(text, contentType) || [];
    const rpcError = messages.find((m) => m && m.error);
    if (rpcError) {
      throw new McdMcpError(
        'RPC_ERROR',
        rpcError.error.message || 'MCP JSON-RPC 错误',
        rpcError.error.data,
      );
    }
    const payload = messages.find((m) => m && m.id === body.id) || messages[messages.length - 1];
    if (!payload) {
      throw new McdMcpError('EMPTY_RESPONSE', `MCP 未返回有效响应: ${method}`);
    }
    return payload.result;
  }

  /** MCP 生命周期第一步：initialize */
  async initialize() {
    if (!this.hasToken) {
      throw new McdMcpError('NO_TOKEN', '未配置 MCD_MCP_TOKEN，无法调用麦当劳 MCP。');
    }
    const result = await this._rpc('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      clientInfo: { name: 'mclife-compiler', version: '1.0.0' },
    });
    this._serverInfo = result?.serverInfo || null;
    this.initialized = true;
    // 通知服务端，无需响应体
    try {
      await this._rpc('notifications/initialized', {}, { expectResponse: false });
    } catch {
      /* 部分实现不要求此通知，忽略失败 */
    }
    return this._serverInfo;
  }

  async listTools() {
    if (!this.initialized) await this.initialize();
    const result = await this._rpc('tools/list', {});
    return result?.tools || [];
  }

  /** 调用工具，返回解析后的内容（文本已解包，结构化 JSON 自动 parse） */
  async callTool(name, args = {}) {
    if (!this.initialized) await this.initialize();
    const result = await this._rpc('tools/call', { name, arguments: args });
    return normalizeToolResult(result);
  }

  /** 便捷方法：拿工具列表中指定工具的 schema（用于报告里展示真实参数） */
  async getToolSchema(name) {
    const tools = await this.listTools();
    return tools.find((t) => t.name === name) || null;
  }
}

/**
 * 把 MCP content[] 结构解包成 JS 值
 */
export function normalizeToolResult(result) {
  const contents = result?.content || [];
  const texts = [];
  const images = [];
  for (const c of contents) {
    if (c.type === 'text') texts.push(c.text);
    else if (c.type === 'image') images.push({ mimeType: c.mimeType, dataLength: (c.data || '').length });
  }
  const raw = texts.join('\n');
  return {
    isError: Boolean(result?.isError),
    rawText: raw,
    data: parseMcdPayload(raw),
    images,
  };
}

/**
 * 麦当劳 MCP Server 的返回并非统一的标准 JSON。实测（v1.0.0）有三种格式：
 *
 *   A) 标准 JSON
 *      {"success":true,"code":200,"data":{...}}
 *      例：query-my-account
 *
 *   B) JSON 包裹的自定义序列化表格
 *      前置一段 "## Response Structure" 字段说明 + "## Original Response" 后的 JSON，
 *      其中 data 是字符串："[160]{a,b,c}:\n  值1,值2,值3\n  ..."
 *      例：list-nutrition-foods
 *
 *   C) Markdown 文本
 *      "#### 2026年10月7日 往期回顾\n\n-   **活动标题**：xxx\n    **活动内容介绍**：yyy"
 *      例：campaign-calendar / available-coupons / query-my-coupons
 *
 * 本函数统一归一化为 { format, json, table, markdown }，
 * 业务语义解析交给 mcd-resolver.mjs，职责分离。
 */
export function parseMcdPayload(raw) {
  const text = String(raw || '');
  if (!text.trim()) return { format: 'empty', json: null, table: null, markdown: null };

  // 剥离 "## Original Response" 包装（格式 B 的前缀说明块）
  let body = text;
  const origIdx = text.indexOf('## Original Response');
  if (origIdx >= 0) {
    body = text.slice(origIdx + '## Original Response'.length).trim();
  }

  // 尝试截出第一个括号平衡的 JSON
  const jsonSlice = extractFirstJsonObject(body);
  if (jsonSlice) {
    try {
      const parsed = JSON.parse(jsonSlice);
      if (parsed?.success === false || (parsed?.code && parsed.code !== 200)) {
        return { format: 'json-error', json: parsed, table: null, markdown: text };
      }
      // parsed.data 可能是自定义表格字符串
      if (typeof parsed?.data === 'string' && /^\s*\[\d+\]\s*\{/.test(parsed.data)) {
        return { format: 'table-json', json: parsed, table: parseMcdTable(parsed.data), markdown: null };
      }
      return { format: 'json', json: parsed, table: null, markdown: text };
    } catch {
      /* 落到格式 B 兜底 */
    }
  }

  // 格式 B 兜底：裸的 [N]{...}: 表格
  const tableMatch = body.match(/\[\d+\]\s*\{[^}]*}\s*:/);
  if (tableMatch) {
    return { format: 'table-raw', json: null, table: parseMcdTable(body.slice(tableMatch.index)), markdown: null };
  }

  // 格式 C：Markdown
  return { format: 'markdown', json: null, table: null, markdown: text };
}

/** 从文本中截出第一个括号平衡的 JSON 对象/数组（正确跳过字符串内的括号） */
function extractFirstJsonObject(text) {
  const start = text.search(/[{[]/);
  if (start < 0) return null;
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * 解析麦当劳自定义表格格式
 *   输入: "[160]{productName,nutritionDescription,energyKcal,protein}:\n  猪柳麦满分,null,308,16\n  ..."
 *   输出: { count, fields: [...], rows: [{...}, ...] }
 *
 * 已知限制：不支持字段值内含逗号。
 *   实测官方营养表与券表中未出现该情况；
 *   若未来出现，需按官方格式升级为支持引号转义的解析。
 */
export function parseMcdTable(text) {
  const raw = String(text || '').trim();
  const headerMatch = raw.match(/^\s*\[(\d+)\]\s*\{([^}]*)}\s*:?\s*([\s\S]*)$/);
  if (!headerMatch) return null;

  const declaredCount = Number(headerMatch[1]);
  const fields = headerMatch[2].split(',').map((s) => s.trim());
  const body = headerMatch[3] || '';

  const rows = [];
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const cells = t.split(',');
    // 列数不匹配的行是说明/表头噪声，直接跳过
    if (cells.length !== fields.length) continue;
    const row = {};
    fields.forEach((f, i) => {
      const v = cells[i].trim();
      row[f] = v === 'null' || v === '' ? null : v;
    });
    rows.push(row);
  }

  return { count: declaredCount, fields, rows };
}

/**
 * 安全包装：把任意异常转成统一结果结构，用于「降级而不崩」。
 * @returns {Promise<{ok:true,data:any}|{ok:false,error:{code:string,message:string,detail?:any}}>}
 */
export async function safeCall(fn) {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (err) {
    if (err instanceof McdMcpError) {
      return { ok: false, error: { code: err.code, message: err.message, detail: err.detail } };
    }
    return { ok: false, error: { code: 'UNKNOWN', message: err?.message || String(err) } };
  }
}
