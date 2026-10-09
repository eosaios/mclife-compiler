/**
 * compile-engine.mjs — 人生编译引擎
 *
 * 输入：LifeState
 * 输出：编译日志行 + Bug 清单 + 运行状态评分（娱乐用途）
 *
 * 评分说明：所有分值都是「生活状态娱乐化描述」，不是医学/心理学量表，
 * 不构成任何健康建议。报告中会显式声明这一点。
 */

import { describeState } from './life-parse.mjs';

/** Bug 类型库：每条包含 code / severity / message / fixHint */
export const BUG_LIBRARY = Object.freeze({
  OVERTIME_OVERFLOW: {
    code: 'OVERTIME_OVERFLOW',
    severity: 'ERROR',
    title: '加班溢出',
    message: 'Workload exceeded recommended threshold',
    fixHint: '停止接单，先补能量再继续 build',
  },
  ENERGY_UNDERFLOW: {
    code: 'ENERGY_UNDERFLOW',
    severity: 'ERROR',
    title: '精力不足',
    message: 'Energy buffer underflow detected',
    fixHint: '补充高能量密度补给，避免空转',
  },
  DEADLINE_EXCEPTION: {
    code: 'DEADLINE_EXCEPTION',
    severity: 'ERROR',
    title: '截止日期异常',
    message: 'Deadline buffer exhausted, throwing unhandled exception',
    fixHint: '把交付拆小，先交一个能跑的版本',
  },
  HAPPINESS_NOT_FOUND: {
    code: 'HAPPINESS_NOT_FOUND',
    severity: 'WARN',
    title: '快乐依赖缺失',
    message: 'Happiness dependency missing, falling back to default joy',
    fixHint: '注入一个即时愉悦因子（甜品/饮料）',
  },
  REQUIREMENT_RECURSION: {
    code: 'REQUIREMENT_RECURSION',
    severity: 'WARN',
    title: '需求无限递归',
    message: 'Requirement change recursion depth exceeded',
    fixHint: '把需求冻结，先完成当前 iteration',
  },
  MEETING_MEMORY_LEAK: {
    code: 'MEETING_MEMORY_LEAK',
    severity: 'WARN',
    title: '会议内存泄漏',
    message: 'Context memory leaked during synchronous meetings',
    fixHint: '清理无用上下文，保留有效结论',
  },
  SLEEP_DEPENDENCY_STALE: {
    code: 'SLEEP_DEPENDENCY_STALE',
    severity: 'ERROR',
    title: '睡眠依赖过期',
    message: 'Sleep dependency is stale, cache miss on recovery',
    fixHint: '优先补睡眠，短期靠食物托底',
  },
  BUG_FIX_LOOP: {
    code: 'BUG_FIX_LOOP',
    severity: 'WARN',
    title: '修 Bug 死循环',
    message: 'Detected recursive bug-fix loop in current iteration',
    fixHint: '跳出循环，先吃饭再回来看代码',
  },
  HUNGRY_VALUE_UNDEFINED: {
    code: 'HUNGRY_VALUE_UNDEFINED',
    severity: 'WARN',
    title: '饥饿值未定义',
    message: 'Hunger variable is undefined, using safe default',
    fixHint: '按常规补给量处理',
  },
  LONELY_MODE_NO_PAIR: {
    code: 'LONELY_MODE_NO_PAIR',
    severity: 'INFO',
    title: '单人模式无搭档',
    message: 'Runtime is single-instance, no pair dependency',
    fixHint: '单人份即最优解，无需拼单',
  },
  BUDGET_CONSTRAINT_ACTIVE: {
    code: 'BUDGET_CONSTRAINT_ACTIVE',
    severity: 'INFO',
    title: '预算约束生效',
    message: 'Budget constraint active, optimizing for cost',
    fixHint: '优先使用可用优惠后再下单',
  },
  WEATHER_DEPENDENCY_DEGRADED: {
    code: 'WEATHER_DEPENDENCY_DEGRADED',
    severity: 'INFO',
    title: '天气依赖降级',
    message: 'Weather-dependent plan degraded to indoor variant',
    fixHint: '到店取餐，不受配送影响',
  },
  TEAM_MODE_BUNDLE_OPTIMIZED: {
    code: 'TEAM_MODE_BUNDLE_OPTIMIZED',
    severity: 'INFO',
    title: '团队模式已合并',
    message: 'Multi-instance detected, bundling strategy applied',
    fixHint: '走多人套餐，摊薄单价',
  },
});

const EMOTION_BUG_MAP = {
  EXHAUSTED: ['ENERGY_UNDERFLOW', 'SLEEP_DEPENDENCY_STALE'],
  STRESSED: ['OVERTIME_OVERFLOW', 'HAPPINESS_NOT_FOUND'],
  BURNED_OUT: ['ENERGY_UNDERFLOW', 'HAPPINESS_NOT_FOUND'],
  HAPPY: [],
  SAD: ['HAPPINESS_NOT_FOUND'],
  ANGRY: ['MEETING_MEMORY_LEAK', 'HAPPINESS_NOT_FOUND'],
  NEUTRAL: [],
};

const SCENARIO_BUG_MAP = {
  OVERTIME_NIGHT: ['OVERTIME_OVERFLOW', 'SLEEP_DEPENDENCY_STALE'],
  MEETING: ['MEETING_MEMORY_LEAK', 'DEADLINE_EXCEPTION'],
  DEADLINE: ['DEADLINE_EXCEPTION', 'REQUIREMENT_RECURSION'],
  DEBUG_DAY: ['BUG_FIX_LOOP', 'ENERGY_UNDERFLOW'],
  LONELY: ['LONY_MODE_NO_PAIR'],
  TEAM: ['TEAM_MODE_BUNDLE_OPTIMIZED'],
  TRAVEL: [],
  RAINY: ['WEATHER_DEPENDENCY_DEGRADED'],
  UNKNOWN: [],
};

/** 依据状态挑选 Bug（去重、保持稳定顺序） */
export function detectBugs(state) {
  const codes = [];

  for (const c of EMOTION_BUG_MAP[state.emotion] || []) codes.push(c);
  for (const c of SCENARIO_BUG_MAP[state.scenario] || []) codes.push(c);

  if (state.fatigue >= 8) codes.push('ENERGY_UNDERFLOW');
  if (state.fatigue >= 7) codes.push('OVERTIME_OVERFLOW');
  if (state.budget != null && state.budget <= 30) codes.push('BUDGET_CONSTRAINT_ACTIVE');
  if (state.hunger == null) codes.push('HUNGRY_VALUE_UNDEFINED');
  if (state.hunger != null && state.hunger >= 8) codes.push('ENERGY_UNDERFLOW');
  if (state.prefs.includes('LATE_NIGHT')) codes.push('SLEEP_DEPENDENCY_STALE');

  // 关联规则：需求反复变更会持续消耗愉悦感，因此递归链上一定挂着快乐缺失
  if (codes.includes('REQUIREMENT_RECURSION')) codes.push('HAPPINESS_NOT_FOUND');
  // 关联规则：深夜加班场景必然缺少睡眠依赖，而睡眠依赖过期又会放大快乐缺失
  if (codes.includes('SLEEP_DEPENDENCY_STALE')) codes.push('HAPPINESS_NOT_FOUND');

  // 至少给一条，用于让报告始终有内容可展示（明确标记为 INFO 探测项）
  if (codes.length === 0) codes.push('HAPPINESS_NOT_FOUND');

  const unique = [];
  for (const c of codes) if (!unique.includes(c) && BUG_LIBRARY[c]) unique.push(c);

  const sevOrder = { ERROR: 0, WARN: 1, INFO: 2 };
  unique.sort((a, b) => {
    const s = sevOrder[BUG_LIBRARY[a].severity] - sevOrder[BUG_LIBRARY[b].severity];
    return s !== 0 ? s : codes.indexOf(a) - codes.indexOf(b);
  });

  return unique.map((code) => ({ ...BUG_LIBRARY[code] }));
}

/**
 * 运行状态评分（0-100，娱乐用途）。
 * 三个维度：精力(fatigue 越低越好) / 补给缺口(hunger) / 预算余量。
 * 无预算/无饥饿时不计该维度，按已知维度归一化。
 */
export function scoreRuntime(state) {
  const dims = [];

  // 精力：fatigue 0-10 → 100-0
  dims.push({
    key: 'ENERGY',
    label: '能量水位',
    value: Math.round((10 - state.fatigue) * 10),
    weight: 1,
  });

  // 情绪：映射到 0-100
  const emoScore = {
    HAPPY: 92,
    NEUTRAL: 70,
    SAD: 42,
    STRESSED: 38,
    ANGRY: 30,
    EXHAUSTED: 22,
    BURNED_OUT: 28,
  };
  dims.push({
    key: 'MOOD',
    label: '情绪稳定度',
    value: emoScore[state.emotion] ?? 65,
    weight: 1,
  });

  // 补给：hunger 越高分越低（缺口越大）
  if (state.hunger != null) {
    dims.push({
      key: 'SUPPLY',
      label: '补给完成度',
      value: Math.max(0, Math.round(100 - state.hunger * 9)),
      weight: 1,
    });
  }

  const totalWeight = dims.reduce((s, d) => s + d.weight, 0);
  const score = Math.round(dims.reduce((s, d) => s + d.value * d.weight, 0) / totalWeight);

  // buildStatus 不含 "BUILD " 前缀，渲染层负责加前缀，避免出现 "BUILD BUILD FAILED"
  let buildStatus;
  if (score >= 75) buildStatus = 'SUCCESS';
  else if (score >= 55) buildStatus = 'SUCCESS (with warnings)';
  else buildStatus = 'FAILED — recoverable';

  return { score, buildStatus, dimensions: dims, disclaimer: '运行状态评分为娱乐用途，不是医学或心理学评估。' };
}

const pad = (s, n) => String(s).padEnd(n, ' ');
const ts = () => {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

/** 生成编译器风格日志（根据真实状态动态变化） */
export function generateLogs({ state, bugs, mcpTrace, timeSource }) {
  const lines = [];
  const d = describeState(state);

  lines.push(`${ts()} [INFO]  Loading Life Runtime...`);
  lines.push(`${ts()} [INFO]  Runtime version: human/1.0.0 (kernel: ${state.scenario})`);
  lines.push(`${ts()} [INFO]  Detected mood=${state.emotion} energy=${10 - state.fatigue}/10 hunger=${state.hunger ?? 'UNKNOWN'}`);

  // 时间来源：MCP 优先
  if (timeSource === 'mcp' && state.timeOfDay) {
    lines.push(`${ts()} [INFO]  Server time resolved via mcd-mcp::now-time-info -> ${state.timeOfDay}`);
  } else {
    lines.push(`${ts()} [WARN]  now-time-info unavailable, time slot inferred locally (降低置信度)`);
  }

  if (state.budget == null) {
    lines.push(`${ts()} [WARN]  BUDGET variable is undefined, applying safe default (¥50)`);
  } else {
    lines.push(`${ts()} [INFO]  Budget constraint: ¥${state.budget}`);
  }

  for (const bug of bugs) {
    const tag = bug.severity;
    const loc = `life://${bug.code.toLowerCase().replace(/_/g, '-')}`;
    lines.push(`${ts()} [${tag}] ${bug.message}  (${loc})`);
  }

  lines.push(`${ts()} [INFO]  Resolving McDonald's resources via mcd-mcp...`);

  for (const step of mcpTrace || []) {
    const icon = step.ok ? 'SUCCESS' : 'FAIL';
    lines.push(`${ts()} [${icon}] mcp.${step.tool} -> ${pad(step.summary || (step.ok ? 'ok' : 'failed'), 60)}`);
  }

  lines.push(`${ts()} [INFO]  Linking happiness dependency...`);
  lines.push(`${ts()} [SUCCESS] Recovery plan generated`);
  lines.push(``);
  lines.push(`BUILD ${scoreRuntime(state).buildStatus}`);
  lines.push(`runtime score: ${scoreRuntime(state).score}/100 (娱乐用途)  |  ${d.emotion} · ${d.scenario}`);

  return lines;
}

/** 一句程序员式总结：从模板库按状态选取，避免每次都一样 */
const SUMMARY_POOL = {
  low: [
    '人生不一定能一次编译通过，但快乐可以持续集成。',
    '这不是编译失败，这是生活发的一个特性分支。',
    '今天的构建带着警告通过 —— 警告可以晚点修，饱腹不能。',
    'runtime 崩了一次，快乐可以重启。',
    '别怕 timeout，先把能量依赖装上。',
  ],
  mid: [
    '还差一点 commit，但至少不是 hotfix。',
    '生活给了你 warning，你给自己选了 continue。',
    '建议下次带上 budget 和 sleep 两个依赖。',
    '今天跑通了，明天试试重构一下心情。',
    '稳定运行靠的是缓存，热量只是其中一种。',
  ],
  high: [
    '这一轮 build 完美通过，建议立刻 merge 到快乐分支。',
    'runtime 状态良好，趁机把想做的那件事做了。',
    '这是今天最好的编译结果，建议固化。',
    '绿色状态，保持这个 commit。',
  ],
};

export function pickSummary(score) {
  const bucket = score >= 75 ? 'high' : score >= 55 ? 'mid' : 'low';
  const pool = SUMMARY_POOL[bucket];
  return pool[Math.floor(Math.random() * pool.length)];
}

/** 完整编译流程 */
export function compileLife(state) {
  const bugs = detectBugs(state);
  const runtime = scoreRuntime(state);
  const summary = pickSummary(runtime.score);
  return { bugs, runtime, summary };
}
