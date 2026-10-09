#!/usr/bin/env node
/**
 * mclife.mjs — McLife Compiler CLI 主入口
 *
 * 用法：
 *   node mclife.mjs "今天加班到凌晨，修了十几个 Bug，明天还要开会，预算只有 30 元。"
 *   node mclife.mjs "我只有 25 元，编译一份快乐" --format md
 *   node mclife.mjs "累死了" --format card --out out/report.html
 *   node mclife.mjs "累死了" --budget 35 --pref spicy,light
 *   node mclife.mjs --check          # 只做 MCP 探活
 *   node mclife.mjs --tools          # 列出 MCP Server 真实工具
 *
 * 环境变量：
 *   MCD_MCP_TOKEN  麦当劳 MCP Token（必填，缺失则降级为离线编译并明确标注）
 *   MCD_MCP_URL    默认 https://mcp.mcd.cn
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { McdMcpClient, safeCall, hasToken, TOOLS_USED } from './mcd-client.mjs';
import { parseLifeState, describeState } from './life-parse.mjs';
import { compileLife, scoreRuntime, generateLogs } from './compile-engine.mjs';
import { resolveMcDependencies, buildPlan } from './mcd-resolver.mjs';
import { renderTerminal, renderMarkdown, renderShareCard } from './report.mjs';

const DISCLAIMER =
  '运行状态评分为娱乐用途，不是医学或心理学评估；餐品信息、价格、优惠与供应状态以麦当劳官方渠道实时结果为准。';

function parseArgs(argv) {
  const args = { input: '', format: 'terminal', out: '', budget: undefined, prefs: [], check: false, tools: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--format' || a === '-f') args.format = argv[++i];
    else if (a === '--out' || a === '-o') args.out = argv[++i];
    else if (a === '--budget' || a === '-b') args.budget = Number(argv[++i]);
    else if (a === '--pref' || a === '-p') args.prefs = String(argv[++i]).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--check') args.check = true;
    else if (a === '--tools') args.tools = true;
    else if (a.startsWith('-')) {
      console.error(`未知参数: ${a}`);
      process.exit(2);
    } else positional.push(a);
  }
  args.input = positional.join(' ').trim();
  return args;
}

async function cmdCheck() {
  const client = new McdMcpClient();
  console.log('── McLife MCP 探活 ──');
  console.log(`endpoint : ${client.endpoint}`);
  console.log(`token    : ${client.hasToken ? '已配置 (MCD_MCP_TOKEN)' : '❌ 未配置'}`);
  if (!client.hasToken) {
    console.log('');
    console.log('请先申请 Token: https://open.mcd.cn/mcp');
    console.log('然后: export MCD_MCP_TOKEN=你的Token');
    process.exit(1);
  }
  const res = await safeCall(() => client.initialize());
  if (!res.ok) {
    console.log(`结果     : ❌ ${res.error.code} — ${res.error.message}`);
    process.exit(1);
  }
  console.log(`server   : ✅ ${JSON.stringify(res.data)}`);
  const tools = await safeCall(() => client.listTools());
  if (tools.ok) {
    console.log(`tools    : ✅ ${tools.data.length} 个`);
    console.log('');
    for (const t of tools.data) {
      console.log(`  ${t.name}`);
      if (t.description) console.log(`    ${t.description.slice(0, 90)}`);
    }
  } else {
    console.log(`tools    : ❌ ${tools.error.code}`);
  }
}

async function cmdTools() {
  const client = new McdMcpClient();
  const res = await safeCall(() => client.listTools());
  if (!res.ok) {
    console.error(`无法获取工具列表: ${res.error.code} — ${res.error.message}`);
    process.exit(1);
  }
  console.log(JSON.stringify(res.data, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.check) return cmdCheck();
  if (args.tools) return cmdTools();

  if (!args.input) {
    console.error('用法: node mclife.mjs "你今天的状态描述" [--format terminal|md|json|card] [--out path] [--budget N] [--pref spicy,light]');
    process.exit(2);
  }

  // 1) 解析
  const overrides = {};
  if (Number.isFinite(args.budget)) overrides.budget = args.budget;
  if (args.prefs.length > 0) overrides.prefs = args.prefs;
  let state = parseLifeState(args.input, overrides);

  // 2) MCP 依赖解析
  const client = new McdMcpClient();
  const resolved = await resolveMcDependencies(client, state);

  // 用 MCP 时间信息重新解析状态（时段会带出 BREAKFAST / LATE_NIGHT 偏好）
  if (resolved.facts.time) {
    state = parseLifeState(args.input, {
      ...overrides,
      timeInfo: { timeOfDay: resolved.facts.time.timeOfDay, isWeekend: resolved.facts.time.isWeekend },
    });
    state.timeInfoSource = 'mcp';
  } else {
    state.timeInfoSource = 'local';
  }

  // 3) 编译
  const { bugs, runtime, summary } = compileLife(state);

  // 4) 方案
  const { plan, failed } = buildPlan({
    state,
    runtime,
    facts: resolved.facts,
    trace: resolved.trace,
  });

  // 5) 日志（需要 trace 与 plan 都就绪后再生成，保证日志真实反映 MCP 结果）
  const logs = generateLogs({
    state,
    bugs,
    mcpTrace: resolved.trace,
    timeSource: state.timeInfoSource,
  });

  const payload = {
    input: args.input,
    state: { ...state, raw: undefined },
    describe: describeState(state),
    bugs,
    runtime,
    summary,
    logs,
    plan,
    mcpTrace: resolved.trace,
    failed,
    toolsUsed: TOOLS_USED,
    disclaimer: DISCLAIMER,
  };

  // 6) 输出
  if (args.format === 'json') {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (args.format === 'md' || args.format === 'markdown') {
    const md = renderMarkdown(payload);
    if (args.out) {
      writeOut(args.out, md);
    } else {
      console.log(md);
    }
    return;
  }

  if (args.format === 'card' || args.format === 'html') {
    const html = renderShareCard(payload);
    const out = args.out || 'mclife-report.html';
    writeOut(out, html);
    console.log(`分享卡片已生成: ${resolve(out)}`);
    console.log('提示: 用浏览器打开后全页截图即可分享。');
    return;
  }

  console.log(renderTerminal(payload));
}

function writeOut(path, content) {
  const abs = resolve(path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
  console.error(`已写入: ${abs}`);
}

main().catch((err) => {
  console.error(`编译失败: ${err?.message || err}`);
  process.exit(1);
});
