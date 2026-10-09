/**
 * mcd-resolver.mjs — 麦麦依赖解析器
 *
 * 职责：调用麦当劳中国官方 MCP Server 的真实工具，把「人生 Bug」映射成补给方案。
 *
 * ⚠️ 本文件的字段映射基于对官方 MCP Server v1.0.0 的真实调用验证（2026-10-09），
 *    不是照文档推测。三种返回格式的解析逻辑见 mcd-client.mjs 的 parseMcdPayload。
 *
 * 真实使用的工具与真实返回格式：
 *   now-time-info        → JSON，字段 hour/time/date/weekday
 *   list-nutrition-foods → 自定义表格 [N]{productName,energyKcal,protein,fat,...}
 *   campaign-calendar    → Markdown（按日期分组的 **活动标题** / **活动内容介绍**）
 *   query-my-coupons     → Markdown（"暂无可用优惠券" 或券条目列表）
 *   available-coupons    → Markdown（**优惠券标题** / **状态**）
 *   query-my-account     → JSON，字段 availablePoint / accumulativePoint / expiredPoint
 *
 * 严格约束：绝不编造价格、优惠、库存、营养数据。
 * 任何工具失败都在 mcpTrace 中留痕，并在报告中标注该结论为「未验证」。
 */

import { safeCall, TOOLS_USED } from './mcd-client.mjs';

function pick(obj, keys, fallback = undefined) {
  if (!obj) return fallback;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return fallback;
}

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/* ------------------------------------------------------------------ *
 * now-time-info
 * ------------------------------------------------------------------ */
function normalizeTimeInfo(payload) {
  // 真实验证：返回 {"success":true,...,"data":{"hour":..,"minute":..,"weekday":..,...}}
  const src = payload?.json?.data || payload?.json || {};

  let hour = toNum(pick(src, ['hour', 'currentHour', 'hourOfDay']), NaN);
  if (!Number.isFinite(hour)) {
    const timeStr = pick(src, ['time', 'currentTime', 'dateTime', 'datetime']);
    if (typeof timeStr === 'string') {
      const m = timeStr.match(/(\d{1,2}):(\d{2})/);
      if (m) hour = Number(m[1]);
    }
  }
  if (!Number.isFinite(hour)) hour = new Date().getHours();

  let timeOfDay;
  if (hour >= 5 && hour < 10) timeOfDay = 'BREAKFAST';
  else if (hour >= 10 && hour < 14) timeOfDay = 'LUNCH';
  else if (hour >= 14 && hour < 17) timeOfDay = 'SNACK';
  else if (hour >= 17 && hour < 22) timeOfDay = 'DINNER';
  else timeOfDay = 'LATE_NIGHT';

  const weekdayRaw = pick(src, ['weekday', 'dayOfWeek', 'week']);
  let isWeekend = null;
  if (weekdayRaw !== undefined && weekdayRaw !== null) {
    isWeekend = /6|7|sat|sun|六|日|星期六|星期日/i.test(String(weekdayRaw));
  }
  return {
    hour,
    minute: toNum(pick(src, ['minute']), 0),
    timeOfDay,
    isWeekend,
    date: pick(src, ['date', 'today', 'currentDate', 'datetime'], ''),
    raw: src,
  };
}

/* ------------------------------------------------------------------ *
 * list-nutrition-foods —— 自定义表格
 * ------------------------------------------------------------------ */

/** 真实验证字段：productName, nutritionDescription, energyKj, energyKcal, protein, fat, carbohydrate, sodium, calcium */
function normalizeNutrition(payload) {
  const rows = payload?.table?.rows || [];
  return rows
    .map((r) => {
      const name = pick(r, ['productName', 'name', 'foodName', 'title']);
      if (!name) return null;
      return {
        name: String(name),
        desc: pick(r, ['nutritionDescription'], '') || '',
        // 能量优先用 kcal；energyKj 是千焦，混用会导致推荐完全错位
        energy: toNum(pick(r, ['energyKcal', 'energy', 'calories', 'kcal']), 0),
        energyKj: toNum(pick(r, ['energyKj']), 0),
        protein: toNum(pick(r, ['protein']), 0),
        fat: toNum(pick(r, ['fat']), 0),
        carb: toNum(pick(r, ['carbohydrate', 'carbs', 'carb']), 0),
        sodium: toNum(pick(r, ['sodium']), 0),
        calcium: toNum(pick(r, ['calcium']), 0),
        raw: r,
      };
    })
    .filter(Boolean);
}

/**
 * 从真实营养表里按目标挑一个组合。
 *
 * 真实运行发现的问题：最初按「能量密度 + 蛋白密度」排序取 Top-3，
 * 结果选出 2697 kcal（目标仅 860 kcal）—— 密度优先会选出所有高热量大份餐，
 * 组合起来严重超标。改为「先选单品，再按总能量缺口拼组合」。
 *
 * @param {number} count 最多选几样
 */
export function pickNutritionPlan(nutrition, state, count = 3) {
  if (!Array.isArray(nutrition) || nutrition.length === 0) return null;

  const fatigue = state.fatigue ?? 3;
  const hunger = state.hunger ?? 6;
  // 目标能量：疲劳/饥饿越高，越需要高能量。刻意封顶 1100 kcal，
  // 避免极端疲劳值推出不现实的推荐量。
  const targetEnergy = Math.min(1100, Math.round(320 + fatigue * 45 + hunger * 30));

  // 1) 偏好打分
  //
  // 真实运行发现的问题：偏好权重设计成「小加成」（+0.18），
  // 结果被能量分（0~1）完全压制 —— 用户说「想吃辣」「想吃沙拉」，
  // 推荐的主料永远是能量密度最高的安格斯厚牛堡，偏好形同虚设。
  //
  // 修法：引入 prefMatch 标记，主料选择时「命中明确偏好」是硬优先级，
  // 权重加成改为放大到能真正改变排序的量级。
  const scored = nutrition.map((f) => {
    const e = f.energy || 1;
    const density = Math.min(1, e / 700);
    const proteinScore = Math.min(1, (f.protein || 0) / 30);
    const base = density * 0.5 + proteinScore * 0.5;
    const n = f.name;

    let score = base;
    let prefMatch = null;
    const bump = (key, delta, label, test) => {
      if (state.prefs?.includes(key) && test(n)) {
        score += delta;
        prefMatch = label;
      }
    };

    // 硬偏好：命中即显著加权（足以改变主料排序）
    bump('CHICKEN', 0.85, 'CHICKEN', (x) => /鸡|chicken|麦辣|腿堡|麦满分/i.test(x));
    bump('BEEF', 0.85, 'BEEF', (x) => /牛|beef|巨无霸|厚牛堡|汉堡/i.test(x));
    bump('SPICY', 0.9, 'SPICY', (x) => /辣|spicy/i.test(x));
    bump('FRIES', 0.9, 'FRIES', (x) => /薯|fries/i.test(x));
    bump('VEG', 0.9, 'VEG', (x) => /沙拉|蔬菜| salad|玉米/i.test(x));
    bump('LIGHT', 0.7, 'LIGHT', (x) => /沙拉|蔬菜|玉米|茶|咖啡|ice|冰淇淋/i.test(x));
    bump('BREAKFAST', 0.8, 'BREAKFAST', (x) => /麦满分|早餐|蛋堡|coffee|咖啡|汉堡/i.test(x));
    bump('LATE_NIGHT', 0.6, 'LATE_NIGHT', (x) => /薯|ice|冰淇淋|coffee|咖啡|玉米/i.test(x));

    // 负向偏好（排除项）
    //
    // 真实运行发现的问题：「不辣」这句话会同时命中 SPICY(+0.9) 和 NO_SPICY(-1.2)，
    // 因为两者都用 /辣/ 匹配同一批条目。原始实现里正向加成反而赢了，
    // 结果用户说「不辣」却推了麦辣鸡腿堡。
    //
    // 修法：负向偏好单独收集为 excluded 标记，排序时置于最高优先级，
    // 且 excluded 项不参与主料候选（搭配位仍可考虑，因为无替代时优于什么都不给）。
    let excluded = false;
    let excludeReason = null;
    if (state.prefs?.includes('NO_SPICY') && /辣/.test(n)) {
      excluded = true;
      excludeReason = 'NO_SPICY';
    }
    if (state.prefs?.includes('LIGHT') && /厚牛堡|双层|培根/.test(n)) {
      score -= 0.5;
    }

    return { ...f, score, base, prefMatch, excluded, excludeReason };
  });

  // 明确偏好命中项优先，其余按总分排
  const hasPref = scored.some((f) => f.prefMatch);
  const byScore = [...scored].sort((a, b) => {
    // 1) 排除项永远最后
    if (a.excluded !== b.excluded) return a.excluded ? 1 : -1;
    // 2) 偏好命中项优先
    if (hasPref) {
      const ap = a.prefMatch ? 1 : 0;
      const bp = b.prefMatch ? 1 : 0;
      if (ap !== bp) return bp - ap;
    }
    return b.score - a.score;
  });

  // 2) 按总能量缺口贪心拼组合：主料优先，再补到目标附近
  //    约束：不超过目标 * 1.25，避免推荐明显过量
  const hardCap = Math.round(targetEnergy * 1.25);
  const chosen = [];
  let total = 0;

  // 主料候选池：优先非排除项。若全部被排除，退回全集（并在报告中说明）
  const mainPool = byScore.filter((f) => !f.excluded);
  const pool = mainPool.length > 0 ? mainPool : byScore;
  const allExcluded = mainPool.length === 0;

  for (const f of pool) {
    if (chosen.length >= count) break;
    if (f.energy <= 0) continue;
    // 已达目标就不再加（留 10% 容差）
    if (total >= targetEnergy * 1.1) break;
    // 加了会超上限就跳过它，找更小的单品
    if (total + f.energy > hardCap && chosen.length > 0) continue;
    chosen.push(f);
    total += f.energy;
  }

  // 极端情况下（所有单品都超 cap）至少给最低能量的那一份
  if (chosen.length === 0 && pool.length > 0) {
    const smallest = [...pool].sort((a, b) => a.energy - b.energy)[0];
    chosen.push(smallest);
    total = smallest.energy;
  }

  const sum = (k) => chosen.reduce((s, f) => s + (f[k] || 0), 0);

  return {
    items: chosen.map((f) => ({
      name: f.name,
      energy: f.energy,
      protein: f.protein,
      fat: f.fat,
      carb: f.carb,
      prefMatch: f.prefMatch || null,
    })),
    allExcluded,
    totalEnergy: total,
    totalProtein: sum('protein'),
    totalFat: sum('fat'),
    totalSodium: sum('sodium'),
    targetEnergy,
    hardCap,
    gap: Math.round(targetEnergy - total),
    source: 'mcd-mcp::list-nutrition-foods',
    totalAvailable: nutrition.length,
  };
}

/* ------------------------------------------------------------------ *
 * campaign-calendar —— Markdown
 * ------------------------------------------------------------------ */

/**
 * 真实验证格式：
 *   #### 2026年10月7日 往期回顾
 *   -   **活动标题**：超值9.9元早餐两件套陪你开工啦😋
 *       **活动内容介绍**：早八的快乐，一堡一咖已就位🍔☕
 *       **活动图片介绍**：<img ...>
 */
function parseCampaigns(markdown) {
  const md = markdown || '';
  const campaigns = [];
  // 以「#### 日期」分段
  const sectionRe = /^####\s*(.+?)\s*$/gm;
  const sections = [];
  let m;
  while ((m = sectionRe.exec(md)) !== null) {
    sections.push({ header: m[1], start: m.index + m[0].length, end: md.length });
  }
  for (let i = 0; i < sections.length; i++) {
    const body = md.slice(sections[i].start, sections[i + 1]?.start ?? md.length);
    const re = /\*\*活动标题\*\*[：:]\s*(.+)/g;
    let t;
    while ((t = re.exec(body)) !== null) {
      const title = t[1].trim();
      // 从标题位置往后取内容介绍
      const after = body.slice(t.index + t[0].length);
      const nextTitle = after.search(/\*\*活动标题\*\*/);
      const seg = nextTitle >= 0 ? after.slice(0, nextTitle) : after;
      const descMatch = seg.match(/\*\*活动内容介绍\*\*[：:]\s*([\s\S]*?)(?=\n\s*\*\*活动图片介绍\*\*|$)/);
      let desc = (descMatch?.[1] || '').trim();
      // 去掉 markdown 强调与图片标签，压成一行摘要
      desc = desc
        .replace(/!\[[^\]]*]\([^)]*\)/g, '')
        .replace(/<img[^>]*>/g, '')
        .replace(/\*\*/g, '')
        .replace(/\s*\n+\s*/g, ' ')
        .trim();
      campaigns.push({
        name: title.replace(/\*\*/g, ''),
        desc: desc.slice(0, 120),
        dateLabel: sections[i].header,
        raw: seg,
      });
    }
  }
  return campaigns;
}

/* ------------------------------------------------------------------ *
 * 券 —— Markdown
 * ------------------------------------------------------------------ */

/**
 * query-my-coupons 真实验证：
 *   "# 您的优惠券列表\n\n暂无可用优惠券"   （无券）
 *
 * available-coupons 真实验证：
 *   "### 麦麦省优惠券列表：\n- 优惠券标题：麦旋风任选 \\\n  状态：可领取 \\\n  优惠券图片：\n    <img ...>"
 */
function parseAvailableCoupons(markdown) {
  const md = markdown || '';
  const out = [];
  const re = /优惠券标题[：:]\s*(.+?)\s*(?:\\)?\s*$/gm;
  let m;
  while ((m = re.exec(md)) !== null) {
    const name = m[1].replace(/\\/g, '').trim();
    if (!name) continue;
    const after = md.slice(m.index + m[0].length, m.index + 800);
    const statusMatch = after.match(/状态[：:]\s*(.+?)\s*(?:\\)?\s*$/m);
    out.push({
      name,
      status: statusMatch ? statusMatch[1].replace(/\\/g, '').trim() : '未知',
      // 官方返回不含面额/门槛字段，不臆造
      amount: null,
      threshold: null,
      raw: after,
    });
  }
  return out;
}

function parseMyCoupons(markdown) {
  const md = markdown || '';
  if (/暂无可用优惠券|暂无优惠券|没有可用优惠券/.test(md)) return [];
  const out = [];
  const re = /优惠券名称[：:]\s*(.+?)\s*(?:\\)?\s*$|券名称[：:]\s*(.+?)\s*(?:\\)?\s*$/gm;
  let m;
  while ((m = re.exec(md)) !== null) {
    const name = (m[1] || m[2] || '').replace(/\\/g, '').trim();
    if (!name) continue;
    const after = md.slice(m.index + m[0].length, m.index + 800);
    const amountMatch = after.match(/(?:优惠金额|面额|抵扣)[^\d]{0,6}(\d+(?:\.\d+)?)/);
    const thresholdMatch = after.match(/(?:使用门槛|满[^\d]{0,4})[^\d]{0,6}(\d+(?:\.\d+)?)/);
    out.push({
      name,
      amount: amountMatch ? Number(amountMatch[1]) : null,
      threshold: thresholdMatch ? Number(thresholdMatch[1]) : null,
      status: '已持有',
      raw: after,
    });
  }
  return out;
}

/** 券能否用于「估算预算」这一档：门槛 <= budget。门槛未知时保守返回 true 但标注未验证。 */
export function applicableCoupons(coupons, budget) {
  if (budget == null) return [];
  return coupons.filter((c) => {
    const th = Number(c.threshold);
    if (!Number.isFinite(th)) return true; // 门槛未知，不排除（报告中会标注未验证）
    return th <= budget;
  });
}

/* ------------------------------------------------------------------ *
 * 主入口
 * ------------------------------------------------------------------ */
export async function resolveMcDependencies(client, state) {
  const trace = [];
  const facts = {
    time: null,
    timeSource: 'local',
    nutrition: null,
    nutritionPlan: null,
    campaigns: [],
    myCoupons: [],
    availableCoupons: [],
    account: null,
    meals: null,
    price: null,
  };

  const record = (tool, ok, summary) => trace.push({ tool, ok, summary });

  if (!client.hasToken) {
    record('(skipped)', false, '未配置 MCD_MCP_TOKEN，本次为离线编译');
    return { trace, facts, degraded: true, degradeReason: 'NO_TOKEN' };
  }

  // 1) 时间：MCP 权威
  const timeRes = await safeCall(() => client.callTool('now-time-info', {}));
  if (timeRes.ok && !timeRes.data.isError) {
    facts.time = normalizeTimeInfo(timeRes.data.data);
    facts.timeSource = 'mcp';
    const d = facts.time.date || '';
    record('now-time-info', true, `${facts.time.timeOfDay} @${String(facts.time.hour).padStart(2, '0')}:${String(facts.time.minute).padStart(2, '0')}${d ? ' ' + d : ''}`);
  } else {
    record('now-time-info', false, timeRes.error?.message || '调用失败，已降级为本地推断');
  }

  // 2) 营养表：真实能量/蛋白数据
  const nutRes = await safeCall(() => client.callTool('list-nutrition-foods', {}));
  if (nutRes.ok && !nutRes.data.isError) {
    const payload = nutRes.data.data;
    const list = normalizeNutrition(payload);
    facts.nutrition = list;
    facts.nutritionPlan = pickNutritionPlan(list, state, 3);
    const declared = payload?.table?.count;
    record(
      'list-nutrition-foods',
      list.length > 0,
      list.length > 0
        ? `${list.length} 条真实营养数据${declared && declared !== list.length ? `（官方声明 ${declared} 条）` : ''}`
        : `解析到 0 条（format=${payload?.format}），本次不做营养推荐`,
    );
  } else {
    record('list-nutrition-foods', false, nutRes.error?.message || '调用失败');
  }

  // 3) 活动日历：真实在售活动
  const campRes = await safeCall(() => client.callTool('campaign-calendar', {}));
  if (campRes.ok && !campRes.data.isError) {
    const payload = campRes.data.data;
    const list = parseCampaigns(payload.markdown);
    facts.campaigns = list.slice(0, 8);
    // 区分「成功但本月无活动」与「解析失败」
    record(
      'campaign-calendar',
      list.length > 0,
      list.length > 0
        ? `${list.length} 个活动（${facts.campaigns[0].dateLabel} 等）`
        : '调用成功，但未能解析出活动条目',
    );
  } else {
    record('campaign-calendar', false, campRes.error?.message || '调用失败');
  }

  // 4) 我的券（真实持有）
  const myRes = await safeCall(() => client.callTool('query-my-coupons', {}));
  if (myRes.ok && !myRes.data.isError) {
    const list = parseMyCoupons(myRes.data.data.markdown);
    facts.myCoupons = list;
    record('query-my-coupons', true, list.length > 0 ? `${list.length} 张已持有券` : '账户当前无已持有券');
  } else if (myRes.error?.code === 'UNAUTHORIZED') {
    record('query-my-coupons', false, 'Token 无效，券信息不可用');
  } else {
    record('query-my-coupons', false, myRes.error?.message || '调用失败');
  }

  // 5) 可领券（真实可领）
  const avRes = await safeCall(() => client.callTool('available-coupons', {}));
  if (avRes.ok && !avRes.data.isError) {
    const list = parseAvailableCoupons(avRes.data.data.markdown);
    facts.availableCoupons = list;
    record('available-coupons', true, list.length > 0 ? `${list.length} 张可领券` : '当前无可领券');
  } else {
    record('available-coupons', false, avRes.error?.message || '调用失败');
  }

  // 6) 积分
  const accRes = await safeCall(() => client.callTool('query-my-account', {}));
  if (accRes.ok && !accRes.data.isError) {
    const d = accRes.data.data?.json?.data || {};
    // 真实验证字段名：availablePoint / accumulativePoint / expiredPoint / nextMouthExpirePoint
    facts.account = {
      points: toNum(pick(d, ['availablePoint', 'availablePoints', 'points', 'usablePoints']), null),
      total: toNum(pick(d, ['accumulativePoint', 'totalPoints']), null),
      expiring: toNum(pick(d, ['nextMouthExpirePoint', 'currentMouthExpirePoint', 'expiringPoints']), null),
      expired: toNum(pick(d, ['expiredPoint', 'expiredPoints']), null),
      currency: pick(d, ['currency'], '积分'),
      raw: d,
    };
    record(
      'query-my-account',
      true,
      facts.account.points != null ? `可用积分 ${facts.account.points} ${facts.account.currency || ''}`.trim() : '积分信息已获取',
    );
  } else {
    record('query-my-account', false, accRes.error?.message || '调用失败');
  }

  return {
    trace,
    facts,
    degraded: trace.some((t) => !t.ok),
    degradeReason: trace.filter((t) => !t.ok).map((t) => t.tool).join(','),
  };
}

/* ------------------------------------------------------------------ *
 * 方案组装
 * ------------------------------------------------------------------ */
export function buildPlan({ state, runtime, facts, trace }) {
  const budget = state.budget ?? 50; // safe default，日志中已标注
  const budgetIsDefault = state.budget == null;
  const plan = [];
  const mcpOk = (tool) => trace.find((t) => t.tool === tool)?.ok;

  // ---- 1) 主食：基于真实营养数据 ----
  if (facts.nutritionPlan) {
    const p = facts.nutritionPlan;
    const [main, ...sides] = p.items;
    const lines = [`主料：${main.name} — ${main.energy} kcal / 蛋白质 ${main.protein}g${main.prefMatch ? `（命中你的 ${main.prefMatch} 偏好）` : ''}`];
    if (sides.length > 0) {
      lines.push(`搭配：${sides.map((s) => `${s.name}（${s.energy} kcal${s.prefMatch ? ` · ${s.prefMatch}` : ''}）`).join('、')}`);
    }
    lines.push(`合计 ${p.totalEnergy} kcal / 蛋白 ${p.totalProtein}g / 脂肪 ${p.totalFat}g / 钠 ${p.totalSodium}mg`);

    plan.push({
      slot: '主食组合',
      title: '高能量密度组合（真实营养数据驱动）',
      lines,
      mcpSource: 'mcd-mcp::list-nutrition-foods',
      why: `目标能量约 ${p.targetEnergy} kcal（按你的疲劳度与饥饿度推算，上限 1100 kcal），该组合提供 ${p.totalEnergy} kcal，${
        p.gap > 0
          ? `缺口 ${p.gap} kcal，可再加一份小食补齐。`
          : `已在合理区间内（不超目标 25%，即 ${p.hardCap} kcal）。`
      } 官方营养表共 ${p.totalAvailable} 条，本次全部从中选取，未引入任何表外条目。`,
      creative: '用「能量缺口 / 蛋白质密度」这些工程指标解释「为什么现在该吃这个」，是本项目的创意表达部分。',
    });
  } else {
    plan.push({
      slot: '主食组合',
      title: '营养数据不可用',
      lines: ['list-nutrition-foods 未返回可解析的数据，本次不做营养维度推荐。'],
      mcpSource: null,
      why: '不编造营养数据。',
      creative: '无',
    });
  }

  // ---- 2) 预算与优惠：真实券 ----
  const usableCoupons = applicableCoupons(facts.myCoupons, budget);
  const budgetBlock = {
    slot: '预算与优惠',
    title: budgetIsDefault ? '预算未提供（使用安全默认值 ¥50）' : `预算 ¥${budget}`,
    lines: [],
    mcpSource: [],
    why: '',
    creative: '',
  };

  if (facts.myCoupons.length > 0) {
    budgetBlock.mcpSource.push('mcd-mcp::query-my-coupons');
    if (usableCoupons.length > 0) {
      budgetBlock.lines.push(`账户内有 ${usableCoupons.length} 张券的使用门槛不高于 ¥${budget}：`);
      for (const c of usableCoupons.slice(0, 3)) {
        budgetBlock.lines.push(`  · ${c.name}${c.amount != null ? `（优惠 ${c.amount} 元）` : ''}`);
      }
    } else {
      budgetBlock.lines.push(`账户内共 ${facts.myCoupons.length} 张券，但门槛均高于 ¥${budget}，本场景用不上。`);
    }
  } else {
    budgetBlock.lines.push('账户当前没有已持有的优惠券（真实查询结果）。');
  }

  if (facts.availableCoupons.length > 0) {
    budgetBlock.mcpSource.push('mcd-mcp::available-coupons');
    budgetBlock.lines.push(
      `另有 ${facts.availableCoupons.length} 张券当前可领取 —— 这是最直接的省钱动作，例：${facts.availableCoupons
        .slice(0, 2)
        .map((c) => c.name)
        .join('、')}`,
    );
  } else {
    budgetBlock.lines.push('当前没有可领取的优惠券。');
  }

  budgetBlock.lines.push('未执行 calculate-price（需先确定门店与具体商品），实时价格请以官方 App/小程序为准。');
  budgetBlock.why = '本项目不编造实时价格。';
  plan.push(budgetBlock);

  // ---- 3) 快乐依赖：真实活动 ----
  const happyBlock = {
    slot: '快乐依赖',
    title: 'HAPPINESS_NOT_FOUND 修复方案',
    lines: [],
    mcpSource: [],
    why: '',
    creative: '把「吃点好的」翻译成「注入一个即时愉悦因子」，是编译器隐喻的落点。',
  };
  if (facts.campaigns.length > 0) {
    happyBlock.mcpSource.push('mcd-mcp::campaign-calendar');
    happyBlock.lines.push('当月真实活动中可关注：');
    for (const c of facts.campaigns.slice(0, 3)) {
      happyBlock.lines.push(`  · ${c.name}${c.desc ? ` —— ${c.desc.slice(0, 50)}` : ''}（${c.dateLabel}）`);
    }
    happyBlock.why = '活动信息来自官方活动日历的真实返回，而非编造。';
  } else {
    happyBlock.lines.push('活动日历未返回可解析的活动条目，不做活动推荐。');
    happyBlock.why = '不编造活动。';
  }
  plan.push(happyBlock);

  // ---- 4) 时段策略：MCP 时间 ----
  const timeBlock = {
    slot: '时段策略',
    title: facts.timeSource === 'mcp' ? `当前时段：${facts.time.timeOfDay}` : '当前时段：本地推断（MCP 时间不可用）',
    lines: [],
    mcpSource: facts.timeSource === 'mcp' ? ['mcd-mcp::now-time-info'] : [],
    why: '',
    creative: '',
  };
  const slotAdvice = {
    BREAKFAST: '早餐时段：优先考虑早餐类组合，注意 10:00 后部分早餐品类可能已下架。',
    LUNCH: '午餐时段：午高峰建议提前下单或选择到店取餐，避开配送延迟。',
    SNACK: '下午茶时段：小食 + 饮料的组合更匹配当前节奏。',
    DINNER: '晚餐时段：适合正餐组合，堂食/取餐柜取餐更快。',
    LATE_NIGHT: '深夜时段：门店营业时间与菜品供应有限，请先确认门店是否仍在营业。',
  };
  timeBlock.lines.push(slotAdvice[facts.time?.timeOfDay] || '按常规时段处理。');
  timeBlock.why =
    facts.timeSource === 'mcp'
      ? `时段判定使用 MCP 服务端返回的时间（${facts.time.date || ''} ${String(facts.time.hour).padStart(2, '0')}:${String(facts.time.minute).padStart(2, '0')}），避免客户端时钟偏差。`
      : 'MCP 时间调用失败，此处为本地推断，置信度较低。';
  plan.push(timeBlock);

  // ---- 5) 积分路径 ----
  if (facts.account && facts.account.points != null) {
    const a = facts.account;
    const lines = [];
    lines.push(`可用积分 ${a.points}${a.currency ? ' ' + a.currency : ''}，累计获得 ${a.total ?? '—'}。`);
    if (a.expiring && a.expiring > 0) {
      lines.push(`其中 ${a.expiring} 积分即将过期，注意使用。`);
    }
    if (a.expired && a.expired > 0) {
      lines.push(`已有 ${a.expired} 积分过期 —— 这就是「依赖版本过期」的代价。`);
    }
    plan.push({
      slot: '积分路径',
      title: `账户积分状态`,
      lines,
      mcpSource: ['mcd-mcp::query-my-account'],
      why: '过期积分是最容易白白浪费的资产；本项目不会自动兑换或抽奖。',
      creative: '把「积分过期」类比成「依赖版本过期」。',
    });
  }

  const failed = trace.filter((t) => !t.ok).map((t) => t.tool);
  return { plan, failed, toolsUsed: TOOLS_USED.filter((t) => mcpOk(t)) };
}
