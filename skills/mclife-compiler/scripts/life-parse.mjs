/**
 * life-parse.mjs — 人生代码解析器
 *
 * 把一段自然语言（今天累死了 / 加班到凌晨 / 只有 25 块 / 想吃辣的）
 * 解析成结构化的 LifeState。
 *
 * 说明：所有评分均为「娱乐用途」的生活状态描述，不是医学或心理学诊断。
 * 解析采用可解释的词典 + 规则匹配，命中项会记录 evidence（原文片段），
 * 便于在报告里说明「为什么判成这样」。
 */

export const DEFAULT_STATE = Object.freeze({
  emotion: 'NEUTRAL',
  fatigue: 3,
  hunger: null, // 未提供时为 null，报告标记 UNKNOWN
  budget: null,
  prefs: [],
  scenario: 'UNKNOWN',
  timeOfDay: null, // 由 MCP now-time-info 填充
  isWeekend: null,
});

/** 情绪词典 */
const EMOTION_LEXICON = [
  { key: 'EXHAUSTED', words: ['累', '疲', '透支', '扛不住', '精疲力尽', '熬夜', '通宵', '肝'] },
  { key: 'STRESSED', words: ['压力', '焦虑', '崩溃', '烦', '抑郁', 'emo', '难受', '窒息', '忙不过来', 'deadline', 'ddl'] },
  { key: 'BURNED_OUT', words: ['不想干', '摆烂', '躺平', '没劲', '厌倦', '离职', '辞职', '想跑'] },
  { key: 'HAPPY', words: ['开心', '高兴', '爽', '不错', '顺利', '搞定', '成功', 'happy', '兴奋'] },
  { key: 'SAD', words: ['难过', '低落', 'emo', '孤独', 'emo', '失落', '哭'] },
  { key: 'ANGRY', words: ['气', '愤怒', '离谱', '抓狂', 'nm', '服了'] },
];

/** 疲劳线索（0-10，越高越累） */
const FATIGUE_HINTS = [
  { score: 9, words: ['通宵', '整夜', '一夜没睡', '凌晨三点', '凌晨四点', '没睡'] },
  { score: 8, words: ['加班到凌晨', '熬夜', '007', '连续加班', '肝到'] },
  { score: 7, words: ['加班', '996', '连轴转', '高强度', '肝'] },
  { score: 6, words: ['开会', '会议多', '改需求', '需求变更', '汇报'] },
  { score: 5, words: ['忙', '赶工', '事情多', '任务多', 'bug多', '修bug'] },
];

/** 饥饿线索 */
const HUNGER_LEXICON = [
  { value: 9, words: ['饿疯', '饿死了', '快饿死', '饿死', '没吃饭', '没吃午饭', '漏餐'] },
  { value: 8, words: ['很饿', '巨饿', '饿', '饥肠辘辘', '空腹'] },
  { value: 7, words: ['有点饿', '轻微饿', '半饱'] },
  { value: 6, words: ['不太饿', '不太想吃', '没胃口', '吃不下'] },
  { value: 8, words: ['想吃', '馋', '嘴馋'] },
];

/** 饮食偏好
 *
 * 注意 PREF_LEXICON 的匹配顺序：SPICY 用裸 '辣'，NO_SPICY 用 '不辣'/'不要辣' 等否定式。
 * 「不辣」会同时命中两者，所以后面 parsePrefs() 会做互斥消歧：
 * 出现否定式时移除 SPICY，避免「不辣」被当成「想吃辣」。
 */
const PREF_LEXICON = [
  { key: 'SPICY', words: ['辣', '香辣', '麻辣', '变态辣'] },
  { key: 'NO_SPICY', words: ['不辣', '不要辣', '不吃辣', '清淡', '免辣'] },
  { key: 'VEG', words: ['素', '蔬菜', '沙拉', '清淡', '低卡'] },
  { key: 'CHICKEN', words: ['鸡', '鸡肉', '鸡腿', '炸鸡'] },
  { key: 'BEEF', words: ['牛肉', '牛排', '汉堡肉'] },
  { key: 'FRIES', words: ['薯条', '薯'] },
  { key: 'BREAKFAST', words: ['早餐', '早饭', '早上', '通勤'] },
  { key: 'LATE_NIGHT', words: ['夜宵', '宵夜', '深夜', '凌晨'] },
  { key: 'LIGHT', words: ['轻食', '低卡', '减脂', '控卡', '健身'] },
  { key: 'SHAREABLE', words: ['两个人', '多人', '分享', '拼', '聚餐', '同事一起'] },
];

/** 情景词典 */
const SCENARIO_LEXICON = [
  { key: 'OVERTIME_NIGHT', words: ['加班', '通宵', '熬夜', '凌晨', '007'] },
  { key: 'MEETING', words: ['开会', '会议', '汇报', '评审', '面谈'] },
  { key: 'DEADLINE', words: ['deadline', 'ddl', '截止', '上线', '交付', '赶工'] },
  { key: 'DEBUG_DAY', words: ['bug', 'debug', '报错', '线上问题', '故障', '排查', '修复'] },
  { key: 'LONELY', words: ['一个人', '孤独', '单身', '没人'] },
  { key: 'TEAM', words: ['团队', '同事', '项目组', '多人'] },
  { key: 'TRAVEL', words: ['出差', '路上', '高铁', '飞机', '机场'] },
  { key: 'RAINY', words: ['下雨', '暴雨', '台风', '降温'] },
];

/** 预算解析：支持「30 元 / 25块 / 三十块 / 预算50 / 50以内 / 一百」 */
const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 百: 100 };

function parseBudget(text) {
  // 阿拉伯数字：优先 数字 + 元/块/¥
  let m = text.match(/(\d+(?:\.\d+)?)\s*(?:元|块|¥|rmb|RMB|软妹币)/);
  if (m) return { value: Number(m[1]), evidence: m[0] };

  // 阿拉伯数字 + 预算/以内/够
  m = text.match(/(?:预算|只有|只剩|就|花了|不超过|控制在|剩)\s*(\d+(?:\.\d+)?)/);
  if (m) return { value: Number(m[1]), evidence: m[0] };

  // 中文数字
  const cnMatch = text.match(/([一二两三四五六七八九十百]+)\s*(?:元|块|¥)/);
  if (cnMatch) {
    const cn = cnMatch[1];
    let val = 0;
    if (cn.includes('十')) {
      const [tens, ones] = cn.split('十');
      val = (CN_NUM[tens] || 1) * 10 + (ones ? CN_NUM[ones] : 0);
    } else if (cn.includes('百')) {
      val = 100;
    } else {
      val = CN_NUM[cn] ?? 0;
    }
    if (val > 0) return { value: val, evidence: cnMatch[0] };
  }
  return null;
}

/**
 * 偏好互斥消歧。
 *
 * 真实运行发现的问题：「不辣」「不想吃辣」会同时命中 SPICY（裸 '辣'）
 * 与 NO_SPICY（'不辣'），导致既想吃辣又不想吃辣，
 * 推荐的「辣度调整」方向自相矛盾。
 *
 * 规则：否定式优先。命中 NO_SPICY 时移除 SPICY。
 */
function resolvePrefConflicts(keys) {
  const set = new Set(keys);
  if (set.has('NO_SPICY')) set.delete('SPICY');
  return [...set];
}

function countHits(text, words) {  const found = [];
  for (const w of words) {
    const lower = w.toLowerCase();
    const idx = text.toLowerCase().indexOf(lower);
    if (idx >= 0) found.push({ word: w, index: idx });
  }
  return found.sort((a, b) => a.index - b.index);
}

function pickDominant(text, lexicon, limit = 3) {
  const scored = lexicon
    .map((entry) => ({ entry, hits: countHits(text, entry.words) }))
    .filter((x) => x.hits.length > 0)
    .map((x) => ({ key: x.entry.key ?? x.entry.value, hits: x.hits, score: x.hits.length }))
    .sort((a, b) => b.score - a.score || a.hits[0].index - b.hits[0].index);
  return scored.slice(0, limit);
}

/**
 * 解析人生状态
 * @param {string} input 用户自然语言输入
 * @param {object} [overrides] 追问得到的显式字段（budget/prefs 等）
 */
export function parseLifeState(input = '', overrides = {}) {
  const text = String(input);
  const evidence = [];
  const state = { ...DEFAULT_STATE };

  // 情绪
  const emotions = pickDominant(text, EMOTION_LEXICON);
  if (emotions.length > 0) {
    state.emotion = emotions[0].key;
    evidence.push({ field: 'emotion', value: emotions[0].key, from: emotions[0].hits.map((h) => h.word) });
  }

  // 疲劳：取所有命中里最高分，不叠加（避免"累+加班"被重复计）
  let fatigue = 3;
  const fatigueHits = [];
  for (const hint of FATIGUE_HINTS) {
    const hits = countHits(text, hint.words);
    if (hits.length > 0) {
      fatigueHits.push(...hits.map((h) => ({ ...h, score: hint.score })));
      fatigue = Math.max(fatigue, hint.score);
    }
  }
  if (state.emotion === 'EXHAUSTED') fatigue = Math.max(fatigue, 8);
  if (state.emotion === 'BURNED_OUT') fatigue = Math.max(fatigue, 7);
  state.fatigue = Math.min(10, fatigue);
  if (fatigueHits.length > 0) {
    evidence.push({
      field: 'fatigue',
      value: state.fatigue,
      from: fatigueHits.map((h) => h.word),
    });
  }

  // 饥饿
  let hunger = null;
  const hungerHits = [];
  for (const entry of HUNGER_LEXICON) {
    const hits = countHits(text, entry.words);
    if (hits.length > 0) hungerHits.push(...hits.map((h) => ({ ...h, value: entry.value })));
  }
  if (hungerHits.length > 0) {
    // 「饿」比「想吃」更能说明生理饥饿，取最高值
    hunger = Math.max(...hungerHits.map((h) => h.value));
    state.hunger = Math.min(10, hunger);
    evidence.push({ field: 'hunger', value: state.hunger, from: hungerHits.map((h) => h.word) });
  }

  // 预算
  const budget = parseBudget(text);
  if (budget) {
    state.budget = budget.value;
    evidence.push({ field: 'budget', value: budget.value, from: [budget.evidence] });
  }

  // 偏好
  const prefs = pickDominant(text, PREF_LEXICON);
  state.prefs = resolvePrefConflicts(prefs.map((p) => p.key));
  if (prefs.length > 0) {
    evidence.push({ field: 'prefs', value: state.prefs, from: prefs.flatMap((p) => p.hits.map((h) => h.word)) });
  }

  // 情景
  const scenarios = pickDominant(text, SCENARIO_LEXICON, 2);
  if (scenarios.length > 0) {
    state.scenario = scenarios[0].key;
    evidence.push({ field: 'scenario', value: state.scenario, from: scenarios[0].hits.map((h) => h.word) });
  }

  // 情绪与疲劳/情景联动：
  // 单独说「加班到凌晨」没有情绪词，但语义上就是透支。
  // 这里只做保守推断，且记录 inferred 标记，便于报告说明来源。
  if (state.emotion === 'NEUTRAL') {
    if (state.fatigue >= 8 || state.scenario === 'OVERTIME_NIGHT') {
      state.emotion = 'EXHAUSTED';
      evidence.push({ field: 'emotion', value: 'EXHAUSTED', from: ['inferred_from_fatigue_or_night_shift'] });
    } else if (state.fatigue >= 6) {
      state.emotion = 'STRESSED';
      evidence.push({ field: 'emotion', value: 'STRESSED', from: ['inferred_from_fatigue'] });
    }
  }

  // 覆盖（多轮对话补齐的字段优先级最高）
  if (typeof overrides.budget === 'number') {
    state.budget = overrides.budget;
    evidence.push({ field: 'budget', value: overrides.budget, from: ['user_confirmed'] });
  }
  if (Array.isArray(overrides.prefs) && overrides.prefs.length > 0) {
    state.prefs = [...new Set([...state.prefs, ...overrides.prefs])];
    evidence.push({ field: 'prefs', value: overrides.prefs, from: ['user_confirmed'] });
  }
  if (typeof overrides.fatigue === 'number') state.fatigue = overrides.fatigue;
  if (typeof overrides.hunger === 'number') state.hunger = overrides.hunger;
  if (typeof overrides.emotion === 'string') state.emotion = overrides.emotion;

  // MCP 时间信息融合（来自 now-time-info，非本地推断）
  if (overrides.timeInfo) {
    state.timeOfDay = overrides.timeInfo.timeOfDay ?? null;
    state.isWeekend = overrides.timeInfo.isWeekend ?? null;
    if (state.timeOfDay === 'BREAKFAST' && !state.prefs.includes('BREAKFAST')) {
      state.prefs.push('BREAKFAST');
    }
    if ((state.timeOfDay === 'LATE_NIGHT' || state.timeOfDay === 'NIGHT') && !state.prefs.includes('LATE_NIGHT')) {
      state.prefs.push('LATE_NIGHT');
    }
  }

  state.evidence = evidence;
  state.raw = text;
  return state;
}

/** 供报告使用的、人类可读的状态摘要（明确标注娱乐用途） */
export function describeState(state) {
  const emotionLabel = {
    EXHAUSTED: '电量见底',
    STRESSED: '压力负载高',
    BURNED_OUT: '燃尽待重启',
    HAPPY: '运行良好',
    SAD: '情绪低落',
    ANGRY: '错误风暴',
    NEUTRAL: '平稳运行',
  }[state.emotion] || '平稳运行';

  const scenarioLabel = {
    OVERTIME_NIGHT: '深夜加班',
    MEETING: '会议密集',
    DEADLINE: '交付冲刺',
    DEBUG_DAY: '排障模式',
    LONELY: '单人模式',
    TEAM: '团队协作',
    TRAVEL: '移动中',
    RAINY: '恶劣天气',
    UNKNOWN: '未知场景',
  }[state.scenario] || '未知场景';

  return {
    emotion: emotionLabel,
    scenario: scenarioLabel,
    fatigue: state.fatigue,
    hunger: state.hunger,
    hungerLabel: state.hunger == null ? 'UNKNOWN' : state.hunger,
    budget: state.budget,
    prefs: state.prefs,
  };
}
