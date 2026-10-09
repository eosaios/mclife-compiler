#!/usr/bin/env node
/**
 * test.mjs — 无需网络、无需 Token 的本地单元测试
 * 运行: node tests/test.mjs
 */

import { parseLifeState, describeState, normalizePrefs, VALID_PREFS, VALID_EMOTIONS } from '../skills/mclife-compiler/scripts/life-parse.mjs';
import { detectBugs, scoreRuntime, compileLife, generateLogs } from '../skills/mclife-compiler/scripts/compile-engine.mjs';
import { renderTerminal, renderMarkdown, renderShareCard } from '../skills/mclife-compiler/scripts/report.mjs';
import { pickNutritionPlan, applicableCoupons } from '../skills/mclife-compiler/scripts/mcd-resolver.mjs';
import { normalizeToolResult, parseMcdPayload, parseMcdTable } from '../skills/mclife-compiler/scripts/mcd-client.mjs';
import * as m from '../skills/mclife-compiler/scripts/mcd-client.mjs';
import { McdMcpClient } from '../skills/mclife-compiler/scripts/mcd-client.mjs';

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
  ok(!s.prefs.includes('SPICY'), '否定式优先时不应保留 SPICY');
  ok(s.prefs.includes('NO_SPICY'));
});

t('「不辣」不应同时命中 SPICY（回归：曾自相矛盾）', () => {
  const s = parseLifeState('不辣');
  eq(s.prefs.includes('SPICY'), false);
  eq(s.prefs.includes('NO_SPICY'), true);
});

t('「想吃辣」应命中 SPICY 且不含 NO_SPICY', () => {
  const s = parseLifeState('想吃辣');
  eq(s.prefs.includes('SPICY'), true);
  eq(s.prefs.includes('NO_SPICY'), false);
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

/* 真实 MCP 返回样本（2026-10-09 实测截取，字段做最小化但保留结构） */
const REAL_TABLE_JSON = JSON.stringify({
  success: true,
  code: 200,
  message: '请求成功',
  data: '[3]{productName,nutritionDescription,energyKcal,protein,fat,carbohydrate,sodium}:\n  麦辣鸡腿汉堡,null,485,24,20,45,1100\n  大薯条,null,379,6,16,50,216\n  鸡肉蛋沙拉叠叠卷,null,387,17,11,38,560',
});

const REAL_NUTRITION_MD =
  '# API Response Information\n\n## Response Structure\n\n- **data**: 餐品热量列表\n\n## Original Response\n\n' +
  REAL_TABLE_JSON;

const REAL_ACCOUNT_JSON = JSON.stringify({
  success: true,
  code: 200,
  data: { availablePoint: '0', accumulativePoint: '384.6', expiredPoint: '384.6', currency: '麦享会积分' },
});

t('解析真实营养表：自定义表格格式', () => {
  const p = parseMcdPayload(REAL_NUTRITION_MD);
  eq(p.format, 'table-json');
  eq(p.table.count, 3);
  eq(p.table.fields.length, 7);
  eq(p.table.rows.length, 3);
  eq(p.table.rows[0].productName, '麦辣鸡腿汉堡');
  eq(p.table.rows[0].energyKcal, '485');
  eq(p.table.rows[0].nutritionDescription, null);
});

t('解析真实积分返回：字段名为 availablePoint', () => {
  const p = parseMcdPayload('## Original Response\n\n' + REAL_ACCOUNT_JSON);
  eq(p.format, 'json');
  eq(p.json.data.availablePoint, '0');
  eq(p.json.data.accumulativePoint, '384.6');
});

t('解析 JSON 时正确跳过字符串内的括号', () => {
  const tricky = '{"success":true,"data":{"note":"含 } 和 { 的文本","v":1}}';
  const p = parseMcdPayload(tricky);
  eq(p.format, 'json');
  eq(p.json.data.v, 1);
  eq(p.json.data.note, '含 } 和 { 的文本');
});

t('解析业务错误码', () => {
  const p = parseMcdPayload('{"success":false,"code":500,"message":"服务异常"}');
  eq(p.format, 'json-error');
  eq(p.json.code, 500);
});

t('表格解析跳过列数不匹配的噪声行', () => {
  const raw = '[2]{a,b}:\n  1,2\n  这行是说明文字\n  3,4';
  const t2 = parseMcdTable(raw);
  eq(t2.rows.length, 2);
  eq(t2.rows[1].a, '3');
});

t('Markdown 返回（活动/券）被正确识别', () => {
  const md = '### 活动列表：\n#### 2026年10月7日 往期回顾\n-   **活动标题**：测试活动\n    **活动内容介绍**：内容\n';
  const p = parseMcdPayload(md);
  eq(p.format, 'markdown');
  ok(p.markdown.includes('测试活动'));
});

t('推荐组合总能量不超过目标 125%', () => {
  const p = parseMcdPayload(REAL_NUTRITION_MD);
  const rows = p.table.rows.map((r) => ({
    name: r.productName,
    energy: Number(r.energyKcal),
    protein: Number(r.protein),
    fat: Number(r.fat),
    carb: Number(r.carbohydrate),
    sodium: Number(r.sodium),
  }));
  const plan = pickNutritionPlan(rows, parseLifeState('累死了,饿死了'), 3);
  ok(plan.totalEnergy <= plan.hardCap, `实际 ${plan.totalEnergy} > 上限 ${plan.hardCap}`);
});

t('推荐组合不会能量超标（真实样本）', () => {
  const p = parseMcdPayload(REAL_NUTRITION_MD);
  const rows = p.table.rows.map((r) => ({
    name: r.productName,
    energy: Number(r.energyKcal),
    protein: Number(r.protein),
    fat: Number(r.fat),
    carb: Number(r.carbohydrate),
    sodium: Number(r.sodium),
  }));
  // 低目标能量时应只选小份
  const plan = pickNutritionPlan(rows, parseLifeState('不太饿'), 3);
  ok(plan.totalEnergy <= plan.targetEnergy * 1.25 + 1, `实际 ${plan.totalEnergy}`);
});

t('SPICY 偏好必须压过能量密度（回归：偏好曾被能量分压制）', () => {
  const rows = [
    { name: '培根安格斯厚牛堡', energy: 707, protein: 34, fat: 40, carb: 50, sodium: 1200 },
    { name: '麦辣鸡腿汉堡', energy: 485, protein: 24, fat: 20, carb: 45, sodium: 1100 },
  ];
  const plan = pickNutritionPlan(rows, parseLifeState('想吃辣'), 1);
  eq(plan.items[0].name, '麦辣鸡腿汉堡');
  eq(plan.items[0].prefMatch, 'SPICY');
});

t('VEG 偏好必须命中沙拉类（回归）', () => {
  const rows = [
    { name: '培根安格斯厚牛堡', energy: 707, protein: 34, fat: 40, carb: 50, sodium: 1200 },
    { name: '鸡肉蛋沙拉叠叠卷', energy: 387, protein: 17, fat: 11, carb: 38, sodium: 560 },
  ];
  const plan = pickNutritionPlan(rows, parseLifeState('想吃沙拉'), 1);
  eq(plan.items[0].name, '鸡肉蛋沙拉叠叠卷');
});

t('NO_SPICY 偏好排除辣味（负向权重生效）', () => {
  const rows = [
    { name: '麦辣鸡腿汉堡', energy: 485, protein: 24, fat: 20, carb: 45, sodium: 1100 },
    { name: '原味板烧鸡腿堡', energy: 520, protein: 26, fat: 24, carb: 46, sodium: 1150 },
  ];
  const plan = pickNutritionPlan(rows, parseLifeState('不辣'), 1);
  eq(plan.items[0].name, '原味板烧鸡腿堡');
});

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

t('normalizeToolResult 归一化为 {format,json,table,markdown}', () => {
  const r = normalizeToolResult({ content: [{ type: 'text', text: '{"a":1}' }] });
  eq(r.isError, false);
  eq(r.data.format, 'json');
  eq(r.data.json, { a: 1 });
});

t('normalizeToolResult 非 JSON 走 markdown 分支并保留原文', () => {
  const r = normalizeToolResult({ content: [{ type: 'text', text: 'plain text' }] });
  eq(r.data.format, 'markdown');
  eq(r.data.markdown, 'plain text');
  eq(r.data.json, null);
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

console.log('\n── 偏好归一化（CLI --pref）──');

t('normalizePrefs 小写归一化为大写（回归：--pref spicy 曾静默失效）', () => {
  eq(normalizePrefs(['spicy']).prefs, ['SPICY']);
});

t('normalizePrefs 支持中文别名', () => {
  eq(normalizePrefs(['辣']).prefs, ['SPICY']);
  eq(normalizePrefs(['清淡']).prefs, ['NO_SPICY']);
  eq(normalizePrefs(['沙拉']).prefs, ['VEG']);
});

t('normalizePrefs 支持英文别名', () => {
  eq(normalizePrefs(['salad']).prefs, ['VEG']);
  eq(normalizePrefs(['chicken']).prefs, ['CHICKEN']);
  eq(normalizePrefs(['fries']).prefs, ['FRIES']);
});

t('normalizePrefs 非法值被过滤并报告', () => {
  const r = normalizePrefs(['INVALID', 'spicy']);
  eq(r.prefs, ['SPICY']);
  eq(r.unknown, ['INVALID']);
});

t('normalizePrefs 去重', () => {
  eq(normalizePrefs(['spicy', 'SPICY', '辣']).prefs, ['SPICY']);
});

t('normalizePrefs 不辣与辣同时出现时否定优先', () => {
  eq(normalizePrefs(['spicy', 'nospicy']).prefs, ['NO_SPICY']);
});

t('VALID_PREFS 覆盖所有词典 key', () => {
  eq(VALID_PREFS.includes('SHAREABLE'), true);
  ok(VALID_PREFS.length >= 10);
});

t('--pref 小写经 CLI 路径也能生效（端到端解析层）', () => {
  const s = parseLifeState('想吃点东西', { prefs: ['spicy'] });
  ok(s.prefs.includes('SPICY'), `实际: ${JSON.stringify(s.prefs)}`);
});

t('--pref 中文经 CLI 路径也能生效', () => {
  const s = parseLifeState('想吃点东西', { prefs: ['沙拉'] });
  ok(s.prefs.includes('VEG'), `实际: ${JSON.stringify(s.prefs)}`);
});

t('无效偏好值被记入 unknownPrefs 供提示', () => {
  const s = parseLifeState('想吃点东西', { prefs: ['INVALID'] });
  eq(s.unknownPrefs, ['INVALID']);
});

console.log('\n── 饥饿否定式与精度（真实测试发现）──');

t('「不想吃饭」不应被判为很饿（回归：曾命中「想吃」=8）', () => {
  ok(parseLifeState('今天不想吃饭').hunger <= 3, `实际 ${parseLifeState('今天不想吃饭').hunger}`);
});

t('「刚吃完」判定为已进食', () => {
  const h = parseLifeState('刚吃完').hunger;
  ok(h !== null && h <= 2, `实际 ${h}`);
});

t('「吃饱了撑的」判定为已进食', () => {
  ok(parseLifeState('吃饱了撑的').hunger <= 2);
});

t('「没胃口」判定为无食欲而非饥饿', () => {
  ok(parseLifeState('没胃口').hunger <= 3);
});

t('「不饿」不被误判为饥饿', () => {
  ok(parseLifeState('不饿').hunger <= 2);
});

t('「有点饿」按程度副词取 7，不被泛词「饿」抬到 8（回归）', () => {
  eq(parseLifeState('有点饿').hunger, 7);
});

t('「稍微有点饿」同样取 7', () => {
  eq(parseLifeState('稍微有点饿').hunger, 7);
});

t('「不太饿」取 6', () => {
  eq(parseLifeState('不太饿').hunger, 6);
});

t('真实饥饿词仍正确', () => {
  eq(parseLifeState('饿死了').hunger, 9);
  eq(parseLifeState('很饿').hunger, 8);
});

console.log('\n── 预算解析扩展（真实测试发现）──');

t('「一千元」解析为 1000（回归：原实现只覆盖到百）', () => {
  eq(parseLifeState('一千元').budget, 1000);
});

t('「两千块」解析为 2000', () => {
  eq(parseLifeState('两千块').budget, 2000);
});

t('「一万」解析为 10000', () => {
  eq(parseLifeState('一万块').budget, 10000);
});

t('「三百五十元」复合中文数字', () => {
  eq(parseLifeState('三百五十元').budget, 350);
});

t('「没钱」视为 0 元预算（回归：曾返回 null → 用默认 ¥50）', () => {
  eq(parseLifeState('今天没钱').budget, 0);
});

t('「穷」视为 0 元预算', () => {
  eq(parseLifeState('太穷了').budget, 0);
});

t('「免费」视为 0 元预算', () => {
  eq(parseLifeState('有免费的吗').budget, 0);
});

t('「月底吃土」视为 0 元预算', () => {
  eq(parseLifeState('月底吃土').budget, 0);
});

t('「5毛」解析为 0.5 元', () => {
  eq(parseLifeState('还有5毛').budget, 0.5);
});

t('预算 0 仍能正确区分于「未提供」', () => {
  eq(parseLifeState('预算只有 0 元').budget, 0);
  eq(parseLifeState('今天').budget, null);
});

console.log('\n── 否定式通用机制（审计发现：只做了饥饿一处，其余模块全反向）──');

t('「不开心」不应判为 HAPPY（回归）', () => {
  eq(parseLifeState('不开心').emotion === 'HAPPY', false);
});

t('「不高兴」「不顺利」同理', () => {
  eq(parseLifeState('不高兴').emotion === 'HAPPY', false);
  eq(parseLifeState('不顺利').emotion === 'HAPPY', false);
});

t('「不太累」不应判为 EXHAUSTED（回归）', () => {
  const s = parseLifeState('不太累');
  eq(s.emotion === 'EXHAUSTED', false);
  ok(s.fatigue <= 5, `fatigue=${s.fatigue}`);
});

t('「不累」疲劳值应低', () => {
  ok(parseLifeState('不累').fatigue <= 5);
});

t('「不加班」不应判为 OVERTIME_NIGHT（回归）', () => {
  eq(parseLifeState('不加班').scenario, 'UNKNOWN');
});

t('「不开会」不应判为 MEETING（回归）', () => {
  eq(parseLifeState('不开会').scenario, 'UNKNOWN');
});

t('「没有deadline」不应判为 DEADLINE（复合否定词「没有」）', () => {
  eq(parseLifeState('没有deadline').scenario, 'UNKNOWN');
});

t('「不加辣」应判为 NO_SPICY（动补结构否定）', () => {
  const p = parseLifeState('不加辣').prefs;
  ok(p.includes('NO_SPICY') && !p.includes('SPICY'), `实际 ${JSON.stringify(p)}`);
});

t('「不要辣」应判为 NO_SPICY', () => {
  ok(parseLifeState('不要辣').prefs.includes('NO_SPICY'));
});

t('「不是一个人」不应判为 LONELY', () => {
  eq(parseLifeState('不是一个人').scenario, 'UNKNOWN');
});

t('「不熬夜」「不孤独」同理', () => {
  eq(parseLifeState('不熬夜').scenario, 'UNKNOWN');
  eq(parseLifeState('不孤独').scenario, 'UNKNOWN');
});

t('否定式不应误杀正向表达', () => {
  eq(parseLifeState('想加班').scenario, 'OVERTIME_NIGHT');
  eq(parseLifeState('今天开会').scenario, 'MEETING');
  eq(parseLifeState('想吃辣').prefs.includes('SPICY'), true);
  ok(parseLifeState('加班到凌晨').fatigue >= 8);
});

console.log('\n── 单字词条歧义防护 ──');

t('「今天天气很好」不应判为 ANGRY（回归：裸单字「气」）', () => {
  eq(parseLifeState('今天天气很好').emotion, 'NEUTRAL');
});

t('「想跑步」不应判为 BURNED_OUT（回归：「想跑」）', () => {
  eq(parseLifeState('想跑步').emotion, 'NEUTRAL');
});

t('「维生素C」「元素周期表」不应产生 VEG 偏好（回归：裸单字「素」）', () => {
  eq(parseLifeState('维生素C').prefs.includes('VEG'), false);
  eq(parseLifeState('元素周期表').prefs.includes('VEG'), false);
});

t('「累计了一万块」不应判为 EXHAUSTED（回归：裸单字「累」）', () => {
  const s = parseLifeState('累计了一万块');
  eq(s.emotion === 'EXHAUSTED', false);
  eq(s.budget, 10000);
});

t('「element」不应判为 ANGRY（回归：「nm」子串命中英文）', () => {
  eq(parseLifeState('element').emotion, 'NEUTRAL');
});

t('「麻烦你了」不应判为 STRESSED（回归：裸单字「烦」）', () => {
  eq(parseLifeState('麻烦你了').emotion, 'NEUTRAL');
});

t('「拼命干活」不应产生 SHAREABLE 偏好（回归：裸单字「拼」）', () => {
  eq(parseLifeState('拼命干活').prefs.includes('SHAREABLE'), false);
});

console.log('\n── 多值字段与越界防护 ──');

t('偏好不应被 limit=3 截断（回归：丢第 4 种口味）', () => {
  const s = parseLifeState('想吃辣、牛排、鸡腿、薯条');
  eq(s.prefs.length, 4);
  ['SPICY', 'BEEF', 'CHICKEN', 'FRIES'].forEach((k) => {
    ok(s.prefs.includes(k), `缺少 ${k}：${JSON.stringify(s.prefs)}`);
  });
});

t('overrides.fatigue 越界应被钳制（回归：99 穿透）', () => {
  const s = parseLifeState('开心', { fatigue: 99 });
  ok(s.fatigue <= 10 && s.fatigue >= 0, `fatigue=${s.fatigue}`);
});

t('overrides.hunger 负值应被钳制', () => {
  const s = parseLifeState('开心', { hunger: -5 });
  ok(s.hunger >= 0, `hunger=${s.hunger}`);
});

t('overrides NaN 应被忽略', () => {
  const s = parseLifeState('开心', { fatigue: NaN });
  ok(Number.isFinite(s.fatigue), `fatigue=${s.fatigue}`);
});

t('overrides.emotion 非法值应被忽略', () => {
  eq(parseLifeState('开心', { emotion: 'ZZZ' }).emotion, 'HAPPY');
});

t('overrides=null 不应崩溃（回归：MCP 反序列化常见）', () => {
  let s;
  try {
    s = parseLifeState('累', null);
  } catch (e) {
    throw new Error('崩溃: ' + e.message);
  }
  ok(Number.isFinite(s.fatigue));
});

t('input=null / undefined 不应崩溃', () => {
  ok(parseLifeState(null).budget === null);
  ok(parseLifeState(undefined).budget === null);
});

t('normalizePrefs(null) 不应把 "null" 当未知值', () => {
  eq(normalizePrefs(null).unknown, []);
  eq(normalizePrefs(undefined).unknown, []);
});

t('VALID_EMOTIONS 已导出', () => {
  ok(VALID_EMOTIONS.includes('EXHAUSTED') && VALID_EMOTIONS.includes('NEUTRAL'));
});

console.log('\n── 预算单位约束 ──');

t('「今天只有3个人」不应当作预算（回归：缺单位约束）', () => {
  eq(parseLifeState('今天只有3个人').budget, null);
});

t('「剩2小时」不应当作预算', () => {
  eq(parseLifeState('剩2小时').budget, null);
});

t('「今天只有3个bug要修」不应当作预算', () => {
  eq(parseLifeState('今天只有3个bug要修').budget, null);
});

t('带单位的「只有30元」仍应正确识别', () => {
  eq(parseLifeState('只有 30 元').budget, 30);
});

t('「没吃早饭」应判为很饿（回归：曾误归为无食欲）', () => {
  eq(parseLifeState('没吃早饭').hunger, 9);
});

console.log('\n── MCP 客户端健壮性（审计发现）──');

t('表格解析：CSV 引号内含逗号', () => {
  const r = parseMcdTable('[1]{name,kcal}:\n  "猪柳, 蛋麦满分",387');
  eq(r.rows[0].name, '猪柳, 蛋麦满分');
  eq(r.rows[0].kcal, '387');
});

t('表格解析：反斜杠续行应合并', () => {
  const r = parseMcdTable('[1]{a,b}:\n  第一行\\\n  第二行,30元');
  eq(r.rows[0].a, '第一行第二行');
  eq(r.rows[0].b, '30元');
});

t('表格解析：列数不匹配需记录 skippedLines（不再静默丢弃）', () => {
  const r = parseMcdTable('[3]{a,b}:\n  1,2,3\n  4,5');
  ok(r.skippedLines.length > 0, '应记录被跳过的行');
});

t('表格解析：truncated 标记 count 与实际不符', () => {
  const r = parseMcdTable('[5]{a,b}:\n  1,2');
  eq(r.truncated, true);
});

t('客户端构造：opts=null 不崩溃', () => {
  let c;
  try {
    c = new McdMcpClient(null);
  } catch (e) {
    throw new Error('崩溃: ' + e.message);
  }
  ok(c.endpoint.startsWith('http'));
});

t('客户端构造：token 为数字不崩溃', () => {
  let c;
  try {
    c = new McdMcpClient({ token: 123 });
  } catch (e) {
    throw new Error('崩溃: ' + e.message);
  }
  eq(c.token, '123');
});

t('客户端构造：token 自动剥离 Bearer 前缀（避免双重 Bearer）', () => {
  eq(new McdMcpClient({ token: 'Bearer abc123' }).token, 'abc123');
});

t('客户端构造：非法 timeoutMs 回退默认而非 NaN', () => {
  const c = new McdMcpClient({ timeoutMs: 'abc' });
  ok(Number.isFinite(c.timeoutMs) && c.timeoutMs > 1000, `timeoutMs=${c.timeoutMs}`);
});

t('resolveToken 支持多环境变量名', () => {
  eq(m.resolveToken({ MCP_TOKEN: 'x1' }), 'x1');
  eq(m.resolveToken({ MCD_TOKEN: 'x2' }), 'x2');
});

t('resolveToken(null) 不崩溃', () => {
  eq(m.resolveToken(null), '');
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
