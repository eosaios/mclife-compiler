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

/** 情绪词典
 *
 * ⚠️ 修复记录（真实测试发现）：
 *   - 删除裸单字 '气'：会被「天气」「香气」「运气」命中 → 曾判「今天天气很好」为 ANGRY
 *   - 删除裸单字 '累'：会被「累计」「劳累」命中；且否定式已由匹配层统一处理
 *   - 修正 'emo' 重复：曾在 SAD 中字面写两次，导致计数翻倍压过 STRESSED
 *   - 删除 'nm'：会命中英文单词（environment）
 *   - 删除 '肝'：会命中「护肝」
 *   - 删除 '想跑'：会命中「想跑步」
 *   - 删除 '烦'：会命中「麻烦」（保留更具体的「烦躁」「烦心」）
 */
const EMOTION_LEXICON = [
  { key: 'EXHAUSTED', words: ['累坏了', '疲惫', '透支', '扛不住', '精疲力尽', '熬夜', '通宵', '很累', '好累'] },
  { key: 'STRESSED', words: ['压力', '焦虑', '崩溃', '烦躁', '烦心', '抑郁', '难受', '窒息', '忙不过来', 'deadline', 'ddl', '紧张', '慌'] },
  { key: 'BURNED_OUT', words: ['不想干', '摆烂', '躺平', '没劲', '厌倦', '离职', '辞职', '想辞职'] },
  { key: 'HAPPY', words: ['开心', '高兴', '爽', '不错', '顺利', '搞定', '成功', 'happy', '兴奋', '愉快'] },
  { key: 'SAD', words: ['难过', '低落', 'emo', '孤独', '失落', '想哭', '难受想哭'] },
  { key: 'ANGRY', words: ['愤怒', '生气', '离谱', '抓狂', '火大', '恼火'] },
];

/** 疲劳线索（0-10，越高越累）
 *
 * ⚠️ 修复记录：
 *   - 删除 '没睡'（2字）：会命中「睡得很好没睡够」等反向表达；
 *     漏餐/通宵类已由 '一夜没睡'/'通宵'/'整夜' 覆盖
 *   - 删除 '肝'：会命中「护肝」
 *   - 删除裸 '忙'：会命中「帮忙」「不忙」（否定式已由匹配层处理，但「帮忙」仍需靠单字防护）
 *   - 否定式（不太累/不忙/不用开会）由匹配层统一处理
 */
const FATIGUE_HINTS = [
  { score: 9, words: ['通宵', '整夜', '一夜没睡', '凌晨三点', '凌晨四点', '彻夜未眠'] },
  { score: 8, words: ['加班到凌晨', '熬夜', '007', '连续加班', '肝到', '一夜没合眼'] },
  { score: 7, words: ['加班', '996', '连轴转', '高强度'] },
  { score: 6, words: ['开会', '会议多', '改需求', '需求变更', '汇报'] },
  { score: 5, words: ['忙碌', '赶工', '事情多', '任务多', 'bug多', '修bug', '事情多'] },
  // 轻度疲劳：程度副词修饰，权重低
  { score: 3, words: ['有点累', '轻微累', '稍微累'] },
];

/** 饥饿线索
 *
 * ⚠️ 否定式陷阱（真实测试发现）：
 *   「今天不想吃饭」里的「想吃」会命中 value:8 的正向词条，
 *   导致「不想吃饭」被判为「很饿」，输出与用户表达完全相反的结论。
 *
 * 修复：新增 NEG_HUNGER_WORDS，命中否定式时直接反向处理，
 * 且否定式优先级高于所有正向词条。
 */
const HUNGER_LEXICON = [
  { value: 9, words: ['饿疯', '饿死了', '快饿死', '饿死', '没吃饭', '没吃午饭', '没吃早饭', '漏餐', '空腹一整天'] },
  { value: 8, words: ['很饿', '巨饿', '饿', '饥肠辘辘', '饿坏了'] },
  { value: 7, words: ['有点饿', '轻微饿', '半饱'] },
  { value: 6, words: ['不太饿', '不太想吃', '没胃口', '吃不下'] },
  { value: 8, words: ['想吃', '馋', '嘴馋'] },
];

/** 饥饿否定式：出现这些词说明「不想吃 / 不饿」，优先级最高
 *
 * ⚠️ 修复记录：移除了 '没吃早饭'。
 *   它曾被误归为「无食欲」(hunger=3)，但语义上是**漏餐=很饿**，
 *   与 '没吃饭'/'没吃午饭'(value 9) 同类。
 *   修复后 '没吃早饭' 走正向漏餐路径 → hunger=9。
 */
const NEG_HUNGER_WORDS = [
  '不想吃', '不想吃饭', '没胃口', '吃不下', '不想吃食', '不饿',
  '刚吃完', '刚吃过', '吃饱了', '吃撑', '撑了', '不吃了',
];

/** 饮食偏好
 *
 * ⚠️ 修复记录：
 *   - 删除裸单字 '素'：会命中「元素」「维生素」「朴素」「素材」→ 曾判「元素周期表」想吃素
 *   - 删除裸单字 '拼'：会命中「拼命」→ 曾判「拼了命加班」为分享场景
 *   - 否定式（不辣/不加辣/不能吃辣）由匹配层 + resolvePrefConflicts 双重处理
 *
 * 注意匹配顺序：SPICY 用裸 '辣'，NO_SPICY 用 '不辣'/'不要辣' 等否定式。
 * 「不辣」会同时命中两者，resolvePrefConflicts() 会移除 SPICY。
 */
const PREF_LEXICON = [
  { key: 'SPICY', words: ['辣', '香辣', '麻辣', '变态辣'] },
  { key: 'NO_SPICY', words: ['不辣', '不要辣', '不吃辣', '不加辣', '免辣', '戒辣', '清淡'] },
  { key: 'VEG', words: ['蔬菜', '沙拉', '清淡', '低卡', '素食', '吃素'] },
  { key: 'CHICKEN', words: ['鸡', '鸡肉', '鸡腿', '炸鸡'] },
  { key: 'BEEF', words: ['牛肉', '牛排', '汉堡肉'] },
  { key: 'FRIES', words: ['薯条', '薯'] },
  { key: 'BREAKFAST', words: ['早餐', '早饭', '早上', '通勤'] },
  { key: 'LATE_NIGHT', words: ['夜宵', '宵夜', '深夜', '凌晨'] },
  { key: 'LIGHT', words: ['轻食', '低卡', '减脂', '控卡', '健身'] },
  { key: 'SHAREABLE', words: ['两个人', '多人', '分享', '拼单', '聚餐', '同事一起'] },
];

/** 情景词典
 *
 * ⚠️ 否定式（不加班/不开会/没有deadline/不熬夜）由匹配层统一处理。
 *    修复前这些输入会污染 scenario → fatigue → emotion 三个字段。
 */
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

/** 预算解析
 *
 * 真实测试发现的三个缺口：
 *   1. 「一千元」解析失败 —— 原实现只覆盖到「百」，遇到「千」直接跳过
 *   2. 「没钱」「穷」「免费」不识别 —— 这些是明确的零预算表达，
 *      但原实现返回 null，报告会用 ¥50 默认值，与用户处境矛盾
 *   3. 「1毛」「5毛」这类小额单位未支持
 */

/** 中文数字 → 阿拉伯数字，支持到「万」 */
function cnNumberToArabic(cn) {
  const digits = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units = { 十: 10, 百: 100, 千: 1000, 万: 10000 };

  // 纯数字形式（如「三十」）
  if (!/[十百千万]/.test(cn)) {
    return digits[cn] ?? 0;
  }

  let total = 0; // 已结算到「万」以上的部分
  let section = 0; // 当前「千/百/十」段
  let current = 0; // 当前待结算数字
  let matched = false;

  for (const ch of cn) {
    if (digits[ch] !== undefined) {
      current = digits[ch];
      matched = true;
    } else if (units[ch] !== undefined) {
      const u = units[ch];
      if (u === 10000) {
        // 「万」结算：前面累积的总和 × 10000
        total += (section + current || 1) * u;
        section = 0;
        current = 0;
      } else {
        // 「十/百/千」：前面没有数字时默认为 1（十二 = 12）
        section += (current || 1) * u;
        current = 0;
      }
      matched = true;
    }
  }
  return matched ? total + section + current : 0;
}

/** 明确表示「没有钱」的表达 → 视为 0 元预算 */
const ZERO_BUDGET_WORDS = [
  '没钱', '没预算', '穷', '免费', '不要钱', '不花钱', '不点', '没钱点',
  '身上没', '穷得', '吃土', '月底', '发工资前', '等发工资',
];

function parseBudget(text) {
  // 0) 明确零预算表达（要在数字解析之前，避免「月底」被当成别的）
  for (const w of ZERO_BUDGET_WORDS) {
    if (text.includes(w)) return { value: 0, evidence: w };
  }

  // 1) 阿拉伯数字 + 元/块/¥/rmb
  let m = text.match(/(\d+(?:\.\d+)?)\s*(?:元|块|¥|rmb|RMB|软妹币)/);
  if (m) return { value: Number(m[1]), evidence: m[0] };

  // 2) 小额单位：1毛 / 5毛 / 2块5 毛
  m = text.match(/(\d+)\s*(?:毛|角)/);
  if (m) return { value: Number(m[1]) / 10, evidence: m[0] };

  // 3) 阿拉伯数字 + 预算/只有/只剩/花了/不超过/控制在/剩
  //    ⚠️ 必须要求货币单位，否则「今天只有3个人」「剩2小时」会被当成金额。
  //    修复前：`今天只有3个人` → budget=3（完全错误）。
  m = text.match(
    /(?:预算|花了|不超过|控制在)\s*(\d+(?:\.\d+)?)\s*(?:元|块|¥|rmb|RMB)?|(\d+(?:\.\d+)?)\s*(?:元|块|¥)/,
  );
  if (m) {
    // 「只有/只剩/剩」这类词后面若跟非货币单位名词，直接放弃
    const num = Number(m[1] ?? m[2]);
    const ambiguous = /^(?:只有|只剩|剩)\s*(\d+(?:\.\d+)?)\s*(?!元|块|¥|rmb)/.test(text);
    if (!ambiguous || m[1] !== undefined) {
      return { value: num, evidence: m[0] };
    }
  }

  // 3b) 「只有/只剩/剩 N 元/block」—— 必须带单位才认
  m = text.match(/(?:只有|只剩|剩)\s*(\d+(?:\.\d+)?)\s*(元|块|¥|rmb|RMB)/);
  if (m) return { value: Number(m[1]), evidence: m[0] };

  // 4) 中文数字 + 元/块/¥（支持到「万」）
  const cnMatch = text.match(/([零一二两三四五六七八九十百千万]+)\s*(?:元|块|¥)/);
  if (cnMatch) {
    const val = cnNumberToArabic(cnMatch[1]);
    if (val > 0) return { value: val, evidence: cnMatch[0] };
  }

  // 5) 中文数字 + 预算/只有/只剩（同样支持千/万）
  const cnMatch2 = text.match(/(?:预算|只有|只剩|剩)\s*([零一二两三四五六七八九十百千万]+)\s*(?:元|块)?/);
  if (cnMatch2) {
    const val = cnNumberToArabic(cnMatch2[1]);
    if (val > 0) return { value: val, evidence: cnMatch2[0] };
  }

  return null;
}

/** 合法情绪 key（用于 overrides 校验，防止任意字符串进入 describeState） */
export const VALID_EMOTIONS = Object.freeze([
  'EXHAUSTED', 'STRESSED', 'BURNED_OUT', 'HAPPY', 'SAD', 'ANGRY', 'NEUTRAL',
]);

/** 钳制到 0-10 区间 */
function clamp10(n) {
  if (!Number.isFinite(n)) return 3;
  return Math.max(0, Math.min(10, Math.round(n)));
}

/** 合法偏好 key（与 PREF_LEXICON 的 key 一致，用于 CLI --pref 参数校验与归一化） */
export const VALID_PREFS = Object.freeze([
  'SPICY', 'NO_SPICY', 'VEG', 'LIGHT', 'CHICKEN', 'BEEF',
  'FRIES', 'BREAKFAST', 'LATE_NIGHT', 'SHAREABLE',
]);

/**
 * 归一化用户/CLI 传入的偏好。
 *
 * 真实使用发现的问题：`mclife.mjs --pref spicy`（小写）把 'spicy' 原样塞进
 * state.prefs，而解析器内部一律用大写 key（'SPICY'）做 includes 判断，
 * 导致偏好静默失效 —— 用户明确要求辣，主料却是不辣的安格斯厚牛堡。
 *
 * 这里做「大小写不敏感 + 别名映射 + 非法值过滤」，并对未知值给出提示。
 */
export function normalizePrefs(input) {
  // null/undefined 都应返回空，不应把字符串 "null" 当成未知偏好上报
  if (input === null || input === undefined) return { prefs: [], unknown: [] };
  const raw = Array.isArray(input) ? input : String(input).split(',');
  const alias = {
    spicy: 'SPICY', hot: 'SPICY', 辣: 'SPICY', 香辣: 'SPICY',
    nospicy: 'NO_SPICY', mild: 'NO_SPICY', 不辣: 'NO_SPICY', 清淡: 'NO_SPICY',
    veg: 'VEG', salad: 'VEG', vegetable: 'VEG', 素: 'VEG', 沙拉: 'VEG', 蔬菜: 'VEG',
    light: 'LIGHT', lowcal: 'LIGHT', 轻食: 'LIGHT', 低卡: 'LIGHT', 减脂: 'LIGHT',
    chicken: 'CHICKEN', 鸡: 'CHICKEN', 鸡肉: 'CHICKEN',
    beef: 'BEEF', 牛: 'BEEF', 牛肉: 'BEEF',
    fries: 'FRIES', 薯条: 'FRIES', 薯: 'FRIES',
    breakfast: 'BREAKFAST', 早餐: 'BREAKFAST', 早饭: 'BREAKFAST',
    latenight: 'LATE_NIGHT', night: 'LATE_NIGHT', 夜宵: 'LATE_NIGHT', 宵夜: 'LATE_NIGHT',
    shareable: 'SHAREABLE', group: 'SHAREABLE', 分享: 'SHAREABLE', 拼单: 'SHAREABLE',
  };

  const out = [];
  const unknown = [];
  for (const item of raw) {
    const s = String(item).trim();
    if (!s) continue;
    const upper = s.toUpperCase().replace(/[\s-]/g, '_');
    let key = null;
    if (VALID_PREFS.includes(upper)) key = upper;
    else if (alias[s.toLowerCase()]) key = alias[s.toLowerCase()];
    else if (alias[s]) key = alias[s];
    if (key) {
      if (!out.includes(key)) out.push(key);
    } else {
      unknown.push(s);
    }
  }
  return { prefs: resolvePrefConflicts(out), unknown };
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

/** 否定词：出现在命中词条**左侧紧邻位置**时，该命中作废。
 *
 * ⚠️ 这是全模块通用机制（真实测试发现的核心缺陷）。
 *
 * 之前只在饥饿模块做了否定式消解，导致其他模块「凡是不X句式，系统性反向」：
 *   不开心   → HAPPY      （正确：SAD）
 *   不太累   → EXHAUSTED  （正确：不累）
 *   不加班   → OVERTIME_NIGHT
 *   不开会   → MEETING
 *   没有deadline → DEADLINE
 *   甚至级联放大：情景误判 → fatigue 拉高 → emotion 再被推断成 EXHAUSTED，
 *   一个否定词污染三个字段。
 *
 * 只看紧邻左侧 1 个汉字，符合中文「不/没/无/未 + 词」的构词习惯，
 * 避免把「不锈钢」「没关系」这类正常词误杀。
 */
const NEGATION_PREFIXES = [
  // 基础单字否定
  '不', '没', '无', '未', '别', '莫', '甭',
  // 复合否定（真实审计发现「没有deadline」「不加辣」曾漏判）
  '没有', '并不', '从不', '毫无', '并非', '不是',
  // 「不加」「不要」「不用」等动补结构
  '不加', '不要', '不用', '不吃', '不开', '不做', '不需', '不需要',
];

/** 判断 text 中 idx 位置的命中是否为否定式 */
function isNegated(text, idx) {
  if (idx <= 0) return false;
  for (const p of NEGATION_PREFIXES) {
    if (idx >= p.length && text.slice(idx - p.length, idx) === p) return true;
  }
  return false;
}

/**
 * 需要做单字歧义防护的字符。
 *
 * 判定标准：这个单字单独出现时语义不明确，嵌在别的词里会改变含义。
 *   气 → 天气 / 香气 / 运气
 *   素 → 元素 / 维生素 / 朴素
 *   肝 → 护肝（且已从词典删除，这里仅作兜底）
 *   拼 → 拼命
 *   烦 → 麻烦
 *   累 → 累计 / 劳累（且已从词典删除）
 *   甜/咸/酸/苦 → 甜腻 / 咸鱼 / 酸甜 / 苦楚
 *
 * 反之，「辣」不在此列 —— 它是高频明确需求词，
 * 「想吃辣」「辣的」「麻辣」「香辣」都应命中，加了防护反而全废。
 */
function isSingleCharAmbiguous(ch) {
  return '气素肝拼烦累甜咸酸苦'.includes(ch);
}

/**
 * 词条匹配（带否定式与单字边界防护）。
 *
 * 三重防护：
 *   1. 否定式：命中位置左侧紧邻否定词 → 作废
 *   2. 单字词条：单字（如「气」「素」）要求左侧不是另一个中文词的一部分，
 *      否则「天气」「元素」「护肝」「想跑步」都会误命中
 *   3. 英文词条：要求词边界，避免「nm」命中「element」
 */
function matchWord(text, lower, word) {
  const w = word.toLowerCase();
  const isAscii = /^[\x00-\x7F]+$/.test(word);
  const isSingleCjk = !isAscii && word.length === 1;

  let from = 0;
  for (;;) {
    const idx = lower.indexOf(w, from);
    if (idx < 0) return -1;

    // 1) 否定式检测
    if (isNegated(text, idx)) {
      from = idx + 1;
      continue;
    }

    // 2) 单字歧义防护：要求左邻非中文，否则大概率是跨词命中
    if (isSingleCjk && isSingleCharAmbiguous(word)) {
      const left = idx > 0 ? text[idx - 1] : '';
      if (/[\u4e00-\u9fa5]/.test(left)) {
        from = idx + 1;
        continue;
      }
    }

    // 3) 英文词条要求词边界
    if (isAscii && /^[a-z0-9]+$/i.test(word)) {
      const right = idx + word.length < text.length ? lower[idx + word.length] : '';
      const left2 = idx > 0 ? lower[idx - 1] : '';
      const isWordChar = (c) => /[a-z0-9]/.test(c);
      if (isWordChar(right) || isWordChar(left2)) {
        from = idx + 1;
        continue;
      }
    }

    return idx;
  }
}

function countHits(text, words) {
  const lower = String(text).toLowerCase();
  const found = [];
  const seen = new Set();
  for (const w of words) {
    const key = w.toLowerCase();
    // 去重：同一词条在词典里重复出现（如 emo 曾写两次）不应重复计分
    if (seen.has(key)) continue;
    seen.add(key);
    const idx = matchWord(text, lower, w);
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
 * 收集全部命中项（不截断），按出现位置排序。
 * 用于偏好这类「集合语义」字段 —— 用户可以同时想吃辣和牛肉。
 */
function collectAllMatches(text, lexicon) {
  return lexicon
    .map((entry) => ({ entry, hits: countHits(text, entry.words) }))
    .filter((x) => x.hits.length > 0)
    .map((x) => ({ key: x.entry.key ?? x.entry.value, hits: x.hits, score: x.hits.length }))
    .sort((a, b) => a.hits[0].index - b.hits[0].index);
}

/**
 * 解析人生状态
 * @param {string} input 用户自然语言输入
 * @param {object} [overrides] 追问得到的显式字段（budget/prefs 等）
 *
 * ⚠️ overrides 允许为 null —— MCP tool 参数反序列化常得到 null，
 *    默认参数 `= {}` 只对 undefined 生效，null 会穿透导致 TypeError。
 */
export function parseLifeState(input = '', overrides) {
  const text = input === null || input === undefined ? '' : String(input);
  overrides = overrides && typeof overrides === 'object' ? overrides : {};
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
  // 否定式优先：「不想吃饭」「刚吃完」不能被判为「很饿」
  const negHungerHits = countHits(text, NEG_HUNGER_WORDS);

  if (negHungerHits.length > 0) {
    // 明确表示不饿/吃不下 → hunger 取低值
    const isSatiated = /刚吃完|刚吃过|吃饱了|吃撑|撑了|不饿/.test(negHungerHits.map((h) => h.word).join(''));
    hunger = isSatiated ? 1 : 3;
    state.hunger = hunger; // ← 之前漏了这行，导致 evidence 有值但 state 为 null
    evidence.push({
      field: 'hunger',
      value: hunger,
      from: negHungerHits.map((h) => h.word),
      note: isSatiated ? '已进食' : '无食欲',
    });
  } else {
    for (const entry of HUNGER_LEXICON) {
      const hits = countHits(text, entry.words);
      if (hits.length > 0) hungerHits.push(...hits.map((h) => ({ ...h, value: entry.value })));
    }
    if (hungerHits.length > 0) {
      // 精度优先：更长/更具体的词条覆盖更泛的词条。
      // 真实测试发现：若只取 max，「有点饿」会因同时命中泛词「饿」被抬到 8，
      // 而它的本意只是轻微饥饿（7）。
      // 做法：若命中了带修饰的精确词条（词长 > 2 且含程度副词），用精确词条的值。
      const PRECISE = /有点|轻微|稍微|有点点|不太|比较/;
      const preciseHits = hungerHits.filter((h) => PRECISE.test(h.word));
      if (preciseHits.length > 0) {
        hunger = Math.min(...preciseHits.map((h) => h.value));
        evidence.push({
          field: 'hunger',
          value: hunger,
          from: preciseHits.map((h) => h.word),
          note: '按程度副词精确匹配（覆盖泛化词条）',
        });
      } else {
        // 「饿」比「想吃」更能说明生理饥饿，取最高值
        hunger = Math.max(...hungerHits.map((h) => h.value));
        evidence.push({ field: 'hunger', value: hunger, from: hungerHits.map((h) => h.word) });
      }
      state.hunger = Math.min(10, hunger);
    }
  }

  // 预算
  const budget = parseBudget(text);
  if (budget) {
    state.budget = budget.value;
    evidence.push({ field: 'budget', value: budget.value, from: [budget.evidence] });
  }

  // 偏好
  // 偏好是「多值集合」语义（用户可以既想吃辣又想吃牛肉），
  // 不能用 pickDominant 的 top-N 单值策略 —— 修复前 limit=3 会静默丢弃第 4 种口味
  // （「想吃辣、牛排、鸡腿、薯条」会丢掉 BEEF，且 evidence 与结论不符）。
  const prefs = collectAllMatches(text, PREF_LEXICON);
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
    // 归一化：支持小写/中文别名，避免 CLI --pref spicy 这类输入静默失效
    const { prefs: normalized, unknown } = normalizePrefs(overrides.prefs);
    state.prefs = resolvePrefConflicts([...state.prefs, ...normalized]);
    evidence.push({
      field: 'prefs',
      value: normalized,
      from: ['user_confirmed'],
    });
    if (unknown.length > 0) {
      state.unknownPrefs = unknown;
    }
  }
  // ⚠️ 数值必须钳制到 0-10。修复前直接赋值，overrides 里的
  //    fatigue:99 / hunger:-5 / NaN 会穿透到报告（唯一的越界路径）。
  if (typeof overrides.fatigue === 'number' && Number.isFinite(overrides.fatigue)) {
    state.fatigue = clamp10(overrides.fatigue);
  }
  if (typeof overrides.hunger === 'number' && Number.isFinite(overrides.hunger)) {
    state.hunger = clamp10(overrides.hunger);
  }
  if (typeof overrides.emotion === 'string' && VALID_EMOTIONS.includes(overrides.emotion)) {
    state.emotion = overrides.emotion;
  }

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
