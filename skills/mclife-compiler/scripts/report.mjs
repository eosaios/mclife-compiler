/**
 * report.mjs — 人生编译报告渲染
 *
 * 三种输出：
 *   1. renderTerminal()  终端日志风格文本
 *   2. renderMarkdown()  Markdown 报告
 *   3. renderShareCard() 可保存 PNG 的分享卡片 HTML（独立页面）
 *
 * 合规：分享卡片与报告均标注「非麦当劳官方开发者作品」。
 */

import { describeState } from './life-parse.mjs';
import { generateLogs } from './compile-engine.mjs';

/**
 * mcpSource 兼容两种形态：字符串（单来源）与字符串数组（多来源）。
 * 归一化为数组，避免渲染层到处做类型判断。
 */
function mcpSourceList(block) {
  const s = block?.mcpSource;
  if (!s) return [];
  return Array.isArray(s) ? s.filter(Boolean) : [s];
}

const C = {
  reset: '[0m',
  dim: '[2m',
  bold: '[1m',
  red: '[31m',
  green: '[32m',
  yellow: '[33m',
  cyan: '[36m',
  gray: '[90m',
};

const SEV_COLOR = { ERROR: C.red, WARN: C.yellow, INFO: C.cyan };
const SEV_ICON = { ERROR: '✖', WARN: '⚠', INFO: 'ℹ' };

/** 1) 终端风格 */
export function renderTerminal({ state, bugs, runtime, summary, logs, plan, trace, disclaimer }) {
  const d = describeState(state);
  const L = [];

  L.push('');
  L.push(`${C.bold}${C.cyan}  McLife Compiler${C.reset} ${C.gray}// 麦麦人生编译器 v1.0.0${C.reset}`);
  L.push(`${C.gray}  ─────────────────────────────────────────────${C.reset}`);
  L.push(`  ${C.gray}时间${C.reset}   ${facts_time(state)}`);
  L.push(`  ${C.gray}状态${C.reset}   ${C.bold}BUILD ${runtime.buildStatus}${C.reset}`);
  L.push(`  ${C.gray}评分${C.reset}   ${runtime.score}/100 ${C.gray}(娱乐用途)${C.reset}`);
  L.push(`  ${C.gray}解读${C.reset}   ${d.emotion} · ${d.scenario} · 能量 ${10 - (state.fatigue ?? 3)}/10 · 饥饿 ${d.hungerLabel}`);
  L.push(`  ${C.gray}预算${C.reset}   ${state.budget != null ? `¥${state.budget}` : `${C.yellow}未提供，使用默认值 ¥50${C.reset}`}`);
  L.push('');

  L.push(`${C.bold}  编译日志${C.reset}`);
  for (const line of logs) {
    let out = line;
    if (line.includes('[ERROR]')) out = line.replace('[ERROR]', `${SEV_COLOR.ERROR}[ERROR]${C.reset}`);
    else if (line.includes('[WARN]')) out = line.replace('[WARN]', `${SEV_COLOR.WARN}[WARN]${C.reset}`);
    else if (line.includes('[SUCCESS]')) out = line.replace('[SUCCESS]', `${C.green}[SUCCESS]${C.reset}`);
    else if (line.includes('[FAIL]')) out = line.replace('[FAIL]', `${C.red}[FAIL]${C.reset}`);
    else if (line.includes('[INFO]')) out = line.replace('[INFO]', `${C.cyan}[INFO]${C.reset}`);
    else if (line.startsWith('BUILD')) {
      out = runtime.score >= 55 ? `${C.green}${C.bold}${line}${C.reset}` : `${C.yellow}${C.bold}${line}${C.reset}`;
    } else if (line.includes('runtime score')) {
      out = `${C.gray}${line}${C.reset}`;
    }
    L.push('  ' + out);
  }

  L.push('');
  L.push(`${C.bold}  今日 Bug 清单 (${bugs.length})${C.reset}`);
  bugs.forEach((b, i) => {
    const color = SEV_COLOR[b.severity];
    L.push(`  ${color}${SEV_ICON[b.severity]} ${String(i + 1).padStart(2)}. ${b.code}${C.reset}  ${C.gray}${b.title}${C.reset}`);
    L.push(`      ${C.gray}${b.message}${C.reset}`);
    L.push(`      ${C.green}fix:${C.reset} ${b.fixHint}`);
  });

  if (plan?.length) {
    L.push('');
    L.push(`${C.bold}  麦麦补给方案${C.reset}`);
    for (const block of plan) {
      L.push(`  ${C.gray}──${C.reset} ${C.bold}${block.slot}${C.reset} ${C.gray}· ${block.title}${C.reset}`);
      for (const line of block.lines) L.push(`     ${line}`);
      const src = mcpSourceList(block);
      if (src.length) L.push(`     ${C.gray}[MCP] ${src.join(', ')}${C.reset}`);
      if (block.why) L.push(`     ${C.gray}理由:${C.reset} ${block.why}`);
      if (block.creative && block.creative !== '无') L.push(`     ${C.gray}创意:${C.reset} ${block.creative}`);
    }
  }

  const failed = (trace || []).filter((t) => !t.ok);
  if (failed.length > 0) {
    L.push('');
    L.push(`${C.yellow}  ⚠ 未验证部分（不编造，官方渠道为准）${C.reset}`);
    for (const f of failed) L.push(`     · ${f.tool}: ${f.summary || '调用失败'}`);
  }

  L.push('');
  L.push(`  ${C.green}${summary}${C.reset}`);
  L.push('');
  L.push(`${C.gray}  ${disclaimer}${C.reset}`);
  L.push(`${C.gray}  非麦当劳官方开发者作品 · 数据来源：麦当劳中国官方 MCP Server${C.reset}`);
  L.push('');
  return L.join('\n');
}

function facts_time(state) {
  if (state.timeOfDay) {
    const src = state.timeInfoSource === 'mcp' ? 'MCP' : '本地推断';
    return `${state.timeOfDay} ${C.gray}(${src})${C.reset}`;
  }
  return `${C.yellow}未知${C.reset}`;
}

/** 2) Markdown 报告 */
export function renderMarkdown({ state, bugs, runtime, summary, logs, plan, trace, disclaimer, rawInput }) {
  const d = describeState(state);
  const failed = (trace || []).filter((t) => !t.ok);
  const ok = (trace || []).filter((t) => t.ok);

  const M = [];
  M.push(`# McLife Compiler · 人生编译报告`);
  M.push('');
  M.push(`> 把你的人生状态当成一次构建来编译，把 Bug 编译成一顿麦当劳。`);
  M.push('');
  M.push(`## 编译状态`);
  M.push('');
  M.push('```');
  M.push('BUILD ' + runtime.buildStatus);
  M.push(`runtime score : ${runtime.score}/100   (娱乐用途，非医学/心理学评估)`);
  M.push(`energy        : ${10 - (state.fatigue ?? 3)}/10`);
  M.push(`mood          : ${d.emotion}`);
  M.push(`scenario      : ${d.scenario}`);
  M.push(`hunger        : ${d.hungerLabel}`);
  M.push(`budget        : ${state.budget != null ? `¥${state.budget}` : '未提供（使用默认值 ¥50）'}`);
  M.push(`detected at   : ${state.timeOfDay ? `${state.timeOfDay}（来源：${state.timeInfoSource === 'mcp' ? 'MCP now-time-info' : '本地推断'}）` : '未知'}`);
  M.push('```');
  M.push('');

  if (rawInput) {
    M.push('**输入**：`' + rawInput + '`');
    M.push('');
  }

  M.push(`## 编译日志`);
  M.push('');
  M.push('```text');
  for (const line of logs) M.push(line);
  M.push('```');
  M.push('');

  M.push(`## 今日 Bug 清单 (${bugs.length})`);
  M.push('');
  M.push(`| # | 级别 | Bug Code | 含义 | 编译器信息 |`);
  M.push(`|---|------|----------|------|------------|`);
  bugs.forEach((b, i) => {
    M.push(`| ${i + 1} | ${b.severity} | \`${b.code}\` | ${b.title} | ${b.message} |`);
  });
  M.push('');
  for (const b of bugs) {
    M.push(`- **\`${b.code}\`** → ${b.fixHint}`);
  }
  M.push('');

  M.push(`## 麦麦补给方案`);
  M.push('');
  for (const block of plan || []) {
    M.push(`### ${block.slot} · ${block.title}`);
    M.push('');
    for (const line of block.lines) M.push(`- ${line}`);
    M.push('');
    const src = mcpSourceList(block);
    if (src.length) {
      M.push(`> \`[MCP]\` 本节数据来自：${src.join('、')}`);
    }
    if (block.why) M.push(`> **理由**：${block.why}`);
    if (block.creative && block.creative !== '无') M.push(`> \`[AI]\` ${block.creative}`);
    M.push('');
  }

  M.push(`## MCP 调用记录`);
  M.push('');
  M.push(`| Tool | 结果 | 说明 |`);
  M.push(`|------|------|------|`);
  for (const t of trace || []) {
    M.push(`| \`${t.tool}\` | ${t.ok ? '✅' : '❌'} | ${t.summary || (t.ok ? 'ok' : 'failed')} |`);
  }
  M.push('');
  M.push(`成功调用 ${ok.length} 个工具${failed.length > 0 ? `，失败 ${failed.length} 个` : ''}。`);
  if (failed.length > 0) {
    M.push('');
    M.push(`> **未验证声明**：以下内容因 MCP 不可用而未验证，本报告不做任何推测：${failed.map((f) => `\`${f.tool}\``).join('、')}。`);
    M.push(`> 实时价格、优惠、库存与营养信息以麦当劳官方渠道实时结果为准。`);
  }
  M.push('');

  M.push(`## 运行状态评分`);
  M.push('');
  M.push(`| 维度 | 得分 |`);
  M.push(`|------|------|`);
  for (const dim of runtime.dimensions) {
    M.push(`| ${dim.label} (${dim.key}) | ${dim.value} |`);
  }
  M.push('');
  M.push(`> ${runtime.disclaimer}`);
  M.push('');

  M.push(`## 总结`);
  M.push('');
  M.push(`> ${summary}`);
  M.push('');
  M.push(`---`);
  M.push('');
  M.push(`${disclaimer}`);
  M.push('');
  M.push(`本报告由 [McLife Compiler](https://github.com/eosaios/mclife-compiler) 生成，为**非麦当劳官方开发者作品**。`);
  M.push(`数据来源：麦当劳中国官方 MCP Server（https://mcp.mcd.cn）。实时价格、优惠与供应状态以麦当劳官方渠道为准。`);
  M.push('');
  return M.join('\n');
}

/** 3) 分享卡片 HTML（终端 + 复古像素风，单文件、可截图） */
export function renderShareCard({ state, bugs, runtime, summary, plan, disclaimer, rawInput }) {
  const d = describeState(state);
  const bugRows = bugs
    .map(
      (b, i) => `
      <li class="bug bug-${b.severity}">
        <span class="bug-idx">${String(i + 1).padStart(2, '0')}</span>
        <span class="bug-code">${escapeHtml(b.code)}</span>
        <span class="bug-title">${escapeHtml(b.title)}</span>
        <span class="badge">${b.severity}</span>
      </li>`,
    )
    .join('');

  const planHtml = (plan || [])
    .map(
      (b) => `
      <section class="block">
        <h3>${escapeHtml(b.slot)}<small>${escapeHtml(b.title)}</small></h3>
        <ul>${(b.lines || []).map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>
        ${mcpSourceList(b).length ? `<p class="src">[MCP] ${mcpSourceList(b).map(escapeHtml).join(', ')}</p>` : ''}
      </section>`,
    )
    .join('');

  const statusClass = runtime.score >= 75 ? 'ok' : runtime.score >= 55 ? 'warn' : 'fail';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>McLife Compiler · 人生编译报告</title>
<style>
  :root {
    --bg: #0b0f0c;
    --panel: #101613;
    --line: #1e2a23;
    --green: #35d07f;
    --yellow: #f5c542;
    --red: #ff5c5c;
    --cyan: #57c7ff;
    --text: #d7e5db;
    --dim: #6b8074;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace;
    min-height: 100vh;
    display: flex;
    justify-content: center;
    padding: 20px 12px 40px;
    line-height: 1.6;
  }
  .frame {
    width: 100%;
    max-width: 680px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--panel);
    overflow: hidden;
    box-shadow: 0 0 0 1px rgba(53,208,127,.08), 0 24px 60px rgba(0,0,0,.6);
  }
  .titlebar {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 14px;
    background: #0d120f;
    border-bottom: 1px solid var(--line);
    font-size: 12px; color: var(--dim);
  }
  .dot { width: 11px; height: 11px; border-radius: 50%; }
  .dot.r { background: #ff5f56; } .dot.y { background: #ffbd2e; } .dot.g { background: #27c93f; }
  .titlebar .name { margin-left: 6px; color: var(--text); letter-spacing: .5px; }

  .hero { padding: 22px 18px 18px; border-bottom: 1px dashed var(--line); }
  .kicker { color: var(--dim); font-size: 11px; letter-spacing: 2px; text-transform: uppercase; }
  .status { font-size: 21px; font-weight: 700; margin: 10px 0 4px; letter-spacing: .5px; }
  .status.ok { color: var(--green); }
  .status.warn { color: var(--yellow); }
  .status.fail { color: var(--red); }
  .score { display: flex; align-items: baseline; gap: 8px; }
  .score b { font-size: 40px; color: var(--green); font-weight: 700; line-height: 1; }
  .score span { color: var(--dim); font-size: 12px; }
  .meter { height: 8px; background: #0a0e0b; border: 1px solid var(--line); border-radius: 2px; margin-top: 12px; overflow: hidden; }
  .meter i { display: block; height: 100%; background: linear-gradient(90deg, var(--green), #9be86e); animation: fill 1.1s ease-out; }
  .meter.warn i { background: linear-gradient(90deg, var(--yellow), #ffd97a); }
  .meter.fail i { background: linear-gradient(90deg, var(--red), #ff9c6b); }
  @keyframes fill { from { width: 0 } }

  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; background: var(--line); border-bottom: 1px solid var(--line); }
  .stat { background: var(--panel); padding: 12px 10px; text-align: center; }
  .stat i { display: block; font-style: normal; font-size: 10px; color: var(--dim); margin-bottom: 6px; }
  .stat b { font-size: 15px; color: var(--text); }

  .content { padding: 16px 18px 20px; }
  .sec-title { color: var(--dim); font-size: 11px; letter-spacing: 2px; margin: 0 0 10px; text-transform: uppercase; }
  ul.bugs { list-style: none; display: flex; flex-direction: column; gap: 6px; margin-bottom: 18px; }
  .bug { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: #0d120f; border-left: 3px solid var(--line); border-radius: 2px; flex-wrap: wrap; }
  .bug-ERROR { border-left-color: var(--red); }
  .bug-WARN { border-left-color: var(--yellow); }
  .bug-INFO { border-left-color: var(--cyan); }
  .bug-idx { color: var(--dim); font-size: 11px; }
  .bug-code { color: var(--text); font-size: 12px; font-weight: 600; }
  .bug-title { color: var(--dim); font-size: 11px; }
  .badge { margin-left: auto; font-size: 10px; padding: 1px 6px; border-radius: 2px; border: 1px solid currentColor; }
  .bug-ERROR .badge { color: var(--red); }
  .bug-WARN .badge { color: var(--yellow); }
  .bug-INFO .badge { color: var(--cyan); }

  .block { margin-bottom: 14px; padding: 12px; background: #0d120f; border: 1px solid var(--line); border-radius: 3px; }
  .block h3 { font-size: 12px; color: var(--green); margin-bottom: 8px; display: flex; flex-direction: column; gap: 2px; }
  .block h3 small { color: var(--dim); font-weight: 400; font-size: 10px; }
  .block ul { list-style: none; }
  .block li { font-size: 12px; color: var(--text); padding: 2px 0 2px 12px; position: relative; }
  .block li::before { content: '▸'; position: absolute; left: 0; color: var(--dim); }
  .src { margin-top: 8px; font-size: 10px; color: var(--cyan); }

  .art { text-align: center; padding: 14px 0 6px; }
  .art .burger { font-size: 40px; letter-spacing: 4px; filter: grayscale(.2); }
  .summary { margin: 14px 0 0; padding: 14px; border: 1px dashed var(--green); border-radius: 3px; color: var(--green); text-align: center; font-size: 14px; }
  .footer { padding: 14px 18px 18px; border-top: 1px solid var(--line); color: var(--dim); font-size: 10px; text-align: center; }
  .footer b { color: var(--yellow); }
  @media (max-width: 420px) {
    .stats { grid-template-columns: repeat(2, 1fr); }
    .score b { font-size: 34px; }
  }
</style>
</head>
<body>
<div class="frame">
  <div class="titlebar">
    <span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>
    <span class="name">mclife — build life</span>
  </div>

  <div class="hero">
    <div class="kicker">McLife Compiler · 人生编译报告</div>
    <div class="status ${statusClass}">BUILD ${escapeHtml(runtime.buildStatus)}</div>
    <div class="score"><b>${runtime.score}</b><span>/ 100 · 运行状态评分（娱乐用途）</span></div>
    <div class="meter ${statusClass}"><i style="width:${runtime.score}%"></i></div>
  </div>

  <div class="stats">
    <div class="stat"><i>ENERGY</i><b>${10 - (state.fatigue ?? 3)}/10</b></div>
    <div class="stat"><i>MOOD</i><b>${escapeHtml(d.emotion)}</b></div>
    <div class="stat"><i>HUNGER</i><b>${escapeHtml(String(d.hungerLabel))}</b></div>
    <div class="stat"><i>BUDGET</i><b>${state.budget != null ? `¥${state.budget}` : 'DEFAULT'}</b></div>
  </div>

  <div class="content">
    <p class="sec-title">Bug 清单 (${bugs.length})</p>
    <ul class="bugs">${bugRows}</ul>

    ${planHtml ? `<p class="sec-title">麦麦补给方案</p>${planHtml}` : ''}

    <div class="art"><div class="burger">🍔 🍟 🥤</div></div>
    <p class="summary">${escapeHtml(summary)}</p>
  </div>

  <div class="footer">
    ${escapeHtml(disclaimer)}<br />
    <b>非麦当劳官方开发者作品</b> · 数据来源：麦当劳中国官方 MCP Server · 实时价格与优惠以官方渠道为准
  </div>
</div>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
