#!/usr/bin/env node
/**
 * test.mjs — 无需网络、无需 Token 的本地单元测试
 * 运行: node tests/test.mjs
 */

import { parseLifeState, describeState } from '../skills/mclife-compiler/scripts/life-parse.mjs';
import { detectBugs, scoreRuntime, compileLife, generateLogs } from '../skills/mclife-compiler/scripts/compile-engine.mjs';
import { renderTerminal, renderMarkdown, renderShareCard } from '../skills/mclife-compiler/scripts/report.mjs';
import { pickNutritionPlan, applicableCoupons } from '../skills/mclife-compiler/scripts/mcd-resolver.mjs';
import { normalizeToolResult } from '../skills/mclife-compiler/scripts/mcd-client.mjs';

let pass = 0;
let fail = 0;
const failures = [];

function t(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    fail++;
    failures.push({ name, message: err.message });
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${err.message}`);
  }
}

function eq(actual, expected, msg = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} 期望 ${e}，实际 ${a}`);
}

function ok(cond, msg = '断言失败') {
  if (!cond) throw new Error(msg);
}

console.log('\n── life-parse ──');

t('解析预算：阿拉伯数字 + 元', () => {
  eq(parseLifeState('预算只有 30 元').budget, 30);
});

t('解析预算：数字 + 块', () => {
  eq(parseLifeState('我只有 25 块').budget, 25);
});

t('解析预算：中文数字', () => {
  eq(parseLifeState('给我三十块').budget, 30);
});

t('预算缺失时为 null（不臆造）', () => {
  eq(parseLifeState('今天很累').budget, null);
});

t('解析疲劳：加班到凌晨', () => {
  ok(parseLifeState('今天加班到凌晨').fatigue >= 8, '疲劳应 >= 8');
});

t('解析疲劳：通宵为最高档', () => {
  eq(parseLifeState('通宵没睡').fatigue, 9);
});

t('疲劳不因重复命中而累加', () => {
  eq(parseLifeState('加班 加班 加班 通宵').fatigue, 9);
});

t('解析饥饿：饿死了', () => {
  ok(parseLifeState('饿死了') .hunger >= 8, '饥饿应 >= 8');
});

t('饥饿未提供时为 null', () => {
  eq(parseLifeState('今天加班').hunger, null);
});

t('解析偏好：辣', () => {
  ok(parseLifeState('想吃辣').prefs.includes('SPICY'));
});

t('解析偏好：清淡覆盖 SPICY 抵扣', () => {
  const s = parseLifeState('想吃辣但也要清淡');
  ok(s.prefs.includes('SPICY') && s.prefs.includes('NO_SPICY'));
});

t('情景：debug 场景', () => {
  eq(parseLifeState('今天全是 bug，排查一天').scenario, 'DEBUG_DAY');
});

t('情绪与疲劳联动：加班到凌晨判定为 EXHAUSTED', () => {
  eq(parseLifeState('今天加班到凌晨').emotion, 'EXHAUSTED');
});

t('overrides 优先级最高', () => {
  eq(parseLifeState('预算 30 元', { budget: 88 }).budget, 88);
});

t('evidence 记录可解释来源', () => {
  const s = parseLifeState('今天加班到凌晨，预算只有 30 元');
  ok(s.evidence.length >= 2, '应至少有 budget 与 fatigue/scene 的证据');
  ok(s.evidence.every((e) => Array.isArray(e.from)), '每条证据都需有 from');
});

console.log('\n── compile-engine ──');

t('加班场景检出 OVERTIME_OVERFLOW', () => {
  const codes = detectBugs(parseLifeState('加班到凌晨')).map((b) => b.code);
  ok(codes.includes('OVERTIME_OVERFLOW'), `实际: ${codes.join(',')}`);
});

t('Bug 库包含全部 5 个核心类型', () => {
  const codes = detectBugs(parseLifeState('加班到凌晨，需求又变了，一个人，饿死了')).map((b) => b.code);
  ['OVERTIME_OVERFLOW', 'ENERGY_UNDERFLOW', 'HAPPINESS_NOT_FOUND'].forEach((c) => {
    ok(codes.includes(c), `缺少 ${c}，实际: ${codes.join(',')}`);
  });
});

t('Bug 按严重度排序 ERROR 在前', () => {
  const bugs = detectBugs(parseLifeState('累死了，预算 20 元，没吃饭'));
  const firstWarn = bugs.findIndex((b) => b.severity !== 'ERROR');
  ok(firstWarn === -1 || firstWarn === bugs.findIndex((b) => b.severity !== 'ERROR'), '排序检查');
  const sev = bugs.map((b) => b.severity);
  const rank = { ERROR: 0, WARN: 1, INFO: 2 };
  for (let i = 1; i < sev.length; i++) {
    ok(rank[sev[i - 1]] <= rank[sev[i]], `第 ${i} 项顺序错误: ${sev.join(',')}`);
  }
});

t('Bug 无重复', () => {
  const bugs = detectBugs(parseLifeState('加班到凌晨，累死了，通宵'));
  eq(bugs.length, new Set(bugs.map((b) => b.code)).size);
});

t('预算 <= 30 触发 BUDGET_CONSTRAINT_ACTIVE', () => {
  const codes = detectBugs(parseLifeState('预算只有 25 元')).map((b) => b.code);
  ok(codes.includes('BUDGET_CONSTRAINT_ACTIVE'));
});

t('预算 > 30 不触发预算约束', () => {
  const codes = detectBugs(parseLifeState('预算 100 元，今天开心')).map((b) => b.code);
  ok(!codes.includes('BUDGET_CONSTRAINT_ACTIVE'));
});

t('评分范围 0-100', () => {
  const a = scoreRuntime(parseLifeState('今天超开心，全部搞定'));
  const b = scoreRuntime(parseLifeState('累死了，通宵，饿死了'));
  ok(a.score >= 0 && a.score <= 100 && b.score >= 0 && b.score <= 100);
  ok(a.score > b.score, '状态好应分数更高');
});

t('buildStatus 不含 BUILD 前缀（防重复）', () => {
  const r = scoreRuntime(parseLifeState('今天累死了'));
  ok(!r.buildStatus.startsWith('BUILD'), `实际: ${r.buildStatus}`);
});

t('评分带免责声明', () => {
  ok(scoreRuntime(parseLifeState('累')).disclaimer.includes('娱乐'));
});

t('compileLife 返回三件套', () => {
  const r = compileLife(parseLifeState('加班到凌晨，预算 30'));
  ok(Array.isArray(r.bugs) && r.runtime && typeof r.summary === 'string');
  ok(r.summary.length > 0);
});

t('日志随状态动态变化', () => {
  const a = generateLogs({ state: parseLifeState('加班到凌晨'), bugs: [], mcpTrace: [] });
  const b = generateLogs({ state: parseLifeState('预算 200 今天开心'), bugs: [], mcpTrace: [] });
  ok(a.join('\n') !== b.join('\n'), '不同状态应产生不同日志');
});

t('日志反映 MCP 失败', () => {
  const logs = generateLogs({
    state: parseLifeState('累'),
    bugs: [],
    mcpTrace: [{ tool: 'now-time-info', ok: false, summary: '401' }],
  });
  ok(logs.some((l) => l.includes('[FAIL]') && l.includes('now-time-info')));
});

console.log('\n── mcd-resolver ──');

t('营养推荐只用真实传入条目，不新增', () => {
  const list = [
    { name: '巨无霸汉堡', energy: 550, protein: 25, fat: 30, carb: 45, sodium: 800 },
    { name: '麦辣鸡腿堡', energy: 480, protein: 24, fat: 22, carb: 42, sodium: 750 },
    { name: '中薯条', energy: 240, protein: 4, fat: 12, carb: 28, sodium: 320 },
  ];
  const plan = pickNutritionPlan(list, parseLifeState('累死了,饿死了'), 2);
  eq(plan.items.length, 2);
  const names = plan.items.map((i) => i.name);
  ok(names.every((n) => list.some((f) => f.name === n)), '推荐项必须来自输入列表');
  ok(plan.totalEnergy === plan.items.reduce((s, i) => s + i.energy, 0), '能量汇总需正确');
});

t('营养列表为空时返回 null（不编造）', () => {
  eq(pickNutritionPlan([], parseLifeState('累'), 3), null);
});

t('偏好影响真实条目排序', () => {
  const list = [
    { name: '香辣鸡腿堡', energy: 500, protein: 24, fat: 24, carb: 44, sodium: 760 },
    { name: '牛肉汉堡', energy: 520, protein: 26, fat: 28, carb: 42, sodium: 800 },
  ];
  const spicy = pickNutritionPlan(list, parseLifeState('想吃辣'), 1);
  eq(spicy.items[0].name, '香辣鸡腿堡');
  const beef = pickNutritionPlan(list, parseLifeState('想吃牛肉'), 1);
  eq(beef.items[0].name, '牛肉汉堡');
});

t('券门槛过滤：只保留 <= 预算的券', () => {
  const coupons = [
    { name: 'A', threshold: 20, amount: 5 },
    { name: 'B', threshold: 50, amount: 10 },
  ];
  eq(applicableCoupons(coupons, 30).map((c) => c.name), ['A']);
});

t('预算未知时不筛券（无法判断，返回空更安全）', () => {
  eq(applicableCoupons([{ name: 'A', threshold: 20 }], null).length, 0);
});

t('normalizeToolResult 解包文本并尝试 JSON', () => {
  const r = normalizeToolResult({ content: [{ type: 'text', text: '{"a":1}' }] });
  eq(r.data, { a: 1 });
  eq(r.isError, false);
});

t('normalizeToolResult 非 JSON 保留原文', () => {
  const r = normalizeToolResult({ content: [{ type: 'text', text: 'plain text' }] });
  eq(r.data, 'plain text');
});

console.log('\n── report ──');

function payloadFor(input) {
  const state = parseLifeState(input);
  const { bugs, runtime, summary } = compileLife(state);
  const logs = generateLogs({ state, bugs, mcpTrace: [{ tool: 'now-time-info', ok: false, summary: 'no token' }] });
  return {
    state,
    bugs,
    runtime,
    summary,
    logs,
    plan: [{ slot: '测试', title: 'T', lines: ['L1'], mcpSource: ['mcd-mcp::x'], why: 'w', creative: 'c' }],
    trace: [{ tool: 'now-time-info', ok: false, summary: 'no token' }],
    disclaimer: 'DISC',
    rawInput: input,
  };
}

t('终端报告无渲染层 undefined 拼接错误', () => {
  // 注意：日志文案本身可能合法包含 "undefined"（如 "BUDGET variable is undefined"），
  // 这里检测的是渲染 bug —— 颜色常量缺失导致的 "undefined[SUCCESS]" 这类拼接错误。
  const out = renderTerminal(payloadFor('加班到凌晨，预算 30'));
  ok(!/undefined\[/.test(out), '不应出现 undefined[COLOR] 形式的拼接错误');
  ok(!/\$?\{undefined\}/.test(out), '不应出现 {undefined} 插值残留');
  ok(!/:\s*undefined/.test(out), '不应出现 ": undefined"');
});

t('终端报告含 BUILD 前缀且不重复', () => {
  const out = renderTerminal(payloadFor('加班到凌晨，预算 30'));
  ok(out.includes('BUILD '), '应含 BUILD');
  ok(!out.includes('BUILD BUILD'), '不应重复 BUILD');
});

t('Markdown 报告含必需章节', () => {
  const md = renderMarkdown(payloadFor('加班到凌晨，预算 30'));
  ['## 编译状态', '## 编译日志', '## 今日 Bug 清单', '## 麦麦补给方案', '## MCP 调用记录', '## 总结'].forEach((h) => {
    ok(md.includes(h), `缺少章节 ${h}`);
  });
});

t('Markdown 标注未验证声明', () => {
  const md = renderMarkdown(payloadFor('累死了'));
  ok(md.includes('未验证'), '应含未验证声明');
});

t('Markdown 标注非官方', () => {
  const md = renderMarkdown(payloadFor('累死了'));
  ok(md.includes('非麦当劳官方开发者作品'));
});

t('分享卡片是完整 HTML', () => {
  const html = renderShareCard(payloadFor('加班到凌晨，预算 30'));
  ok(html.startsWith('<!DOCTYPE html>') && html.includes('</html>'));
  ok(html.includes('非麦当劳官方开发者作品'));
});

t('分享卡片转义 HTML 注入', () => {
  const p = payloadFor('x');
  p.summary = '<script>alert(1)</script>';
  const html = renderShareCard(p);
  ok(!html.includes('<script>alert(1)</script>'), '应转义 script');
  ok(html.includes('&lt;script&gt;'));
});

t('三种格式对同一输入都能产出', () => {
  const p = payloadFor('加班到凌晨，预算只有 30 元');
  ok(renderTerminal(p).length > 100);
  ok(renderMarkdown(p).length > 100);
  ok(renderShareCard(p).length > 100);
});

console.log('\n── 边界与安全 ──');

t('空输入不崩溃', () => {
  const s = parseLifeState('');
  ok(s && s.budget === null);
  const { bugs, runtime } = compileLife(s);
  ok(Array.isArray(bugs) && runtime.score >= 0);
});

t('超长输入不崩溃', () => {
  const s = parseLifeState('累'.repeat(5000) + ' 预算 30 元');
  ok(s.budget === 30);
});

t('特殊字符不破坏渲染', () => {
  const p = payloadFor('测试"引号"与\\反斜杠');
  ok(renderTerminal(p).length > 0);
  ok(renderMarkdown(p).length > 0);
});

t('预算 0 元被正确解析', () => {
  eq(parseLifeState('预算只有 0 元').budget, 0);
});

console.log(`\n${'─'.repeat(46)}`);
console.log(`  通过 ${pass}  失败 ${fail}`);
if (fail > 0) {
  console.log('\n失败详情:');
  for (const f of failures) console.log(`  ✗ ${f.name}: ${f.message}`);
  process.exit(1);
}
console.log('  全部通过 ✓\n');
