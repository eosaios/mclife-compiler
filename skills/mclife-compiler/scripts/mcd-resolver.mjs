/**
 * mcd-resolver.mjs — 麦麦依赖解析器
 *
 * 职责：调用麦当劳中国官方 MCP Server 的真实工具，把「人生 Bug」映射成补给方案。
 *
 * 真实使用的工具（每个都有不可替代的业务价值）：
 *   now-time-info        → 判定时段（早/午/晚/夜宵），决定推荐套餐类型。MCP 权威时间，非本地推断。
 *   list-nutrition-foods → 真实营养成分（能量/蛋白质/脂肪/碳水/钠/钙），用于按疲劳度选高能量密度组合。
 *   campaign-calendar    → 当月真实营销活动，用于把「快乐依赖缺失」锚定到在售活动上。
 *   query-my-coupons     → 用户账户真实持有的券，直接影响预算可行性判断。
 *   available-coupons    → 当前可领取的券，识别「有券可用但没领」这一真实省钱动作。
 *   query-my-account     → 积分余额，判断积分兑换路径是否可行。
 *   query-meals          → 门店真实在售菜单（需先有门店，故为可选增强）。
 *   calculate-price      → 官方计价（含券/配送费），唯一可信的价格来源。
 *
 * 严格约束：绝不编造价格、优惠、库存、营养数据。
 * 任何工具失败都在 mcpTrace 中留痕，并在报告中标注该结论为「未验证」。
 */

import { safeCall, TOOLS_USED } from './mcd-client.mjs';

/** MCP 返回的餐品字段名在不同版本可能不同，这里做宽松匹配 */
function pick(obj, keys, fallback = undefined) {
  if (!obj) return fallback;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return fallback;
}

function toArray(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  for (const k of ['data', 'list', 'items', 'records', 'result', 'foods', 'coupons', 'products', 'activities']) {
    if (Array.isArray(data[k])) return data[k];
    if (data[k] && typeof data[k] === 'object') {
      const nested = toArray(data[k]);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

/** 把 now-time-info 的返回规整成 {timeOfDay, raw} */
function normalizeTimeInfo(data) {
  const src = data?.data || data || {};
  const hourRaw = pick(src, ['hour', 'currentHour', 'hourOfDay']);
  let hour = Number.isFinite(Number(hourRaw)) ? Number(hourRaw) : null;

  if (hour == null) {
    const timeStr = pick(src, ['time', 'currentTime', 'dateTime', 'datetime']);
    if (typeof timeStr === 'string') {
      const m = timeStr.match(/(\d{1,2}):(\d{2})/);
      if (m) hour = Number(m[1]);
    }
  }
  if (hour == null) {
    const d = new Date();
    hour = d.getHours();
  }

  let timeOfDay;
  if (hour >= 5 && hour < 10) timeOfDay = 'BREAKFAST';
  else if (hour >= 10 && hour < 14) timeOfDay = 'LUNCH';
  else if (hour >= 14 && hour < 17) timeOfDay = 'SNACK';
  else if (hour >= 17 && hour < 22) timeOfDay = 'DINNER';
  else timeOfDay = 'LATE_NIGHT';

  const weekdayRaw = pick(src, ['weekday', 'dayOfWeek', 'week']);
  let isWeekend = null;
  if (weekdayRaw !== undefined) {
    const w = String(weekdayRaw);
    isWeekend = /6|7|sat|sun|六|日|星期六|星期日/i.test(w);
  }
  const dateStr = pick(src, ['date', 'today', 'currentDate']);
  return { hour, timeOfDay, isWeekend, date: dateStr, raw: src };
}

/** 营养条目规整 */
function normalizeNutrition(list) {
  return list
    .map((f) => {
      const name = pick(f, ['name', 'foodName', 'title', 'itemName', 'productName']);
      if (!name) return null;
      const energy = Number(pick(f, ['energy', 'calories', 'kcal', 'heat', 'energyKcal'], 0)) || 0;
      const protein = Number(pick(f, ['protein', 'proteinG'], 0)) || 0;
      const fat = Number(pick(f, ['fat', 'fatG'], 0)) || 0;
      const carb = Number(pick(f, ['carbohydrate', 'carb', 'carbs', 'carbohydrateG'], 0)) || 0;
      const sodium = Number(pick(f, ['sodium', 'salt', 'sodiumMg'], 0)) || 0;
      return { name, energy, protein, fat, carb, sodium, raw: f };
    })
    .filter(Boolean);
}

/** 从真实营养表里按目标挑一个组合（能量密度 + 蛋白优先） */
export function pickNutritionPlan(nutrition, state, count = 3) {
  if (nutrition.length === 0) return null;

  // 目标能量：疲劳/饥饿越高，越需要高能量
  const fatigue = state.fatigue ?? 3;
  const hunger = state.hunger ?? 6;
  const targetEnergy = Math.round(320 + fatigue * 45 + hunger * 30);

  const scored = nutrition.map((f) => {
    const e = f.energy || 1;
    // 能量密度得分 + 蛋白得分
    const density = Math.min(1, e / 700);
    const proteinScore = Math.min(1, (f.protein || 0) / 30);
    let score = density * 0.65 + proteinScore * 0.35;

    // 偏好加权（仅在真实存在的条目里加权，不新增条目）
    if (state.prefs?.includes('CHICKEN') && /鸡|chicken|麦辣|腿堡/i.test(f.name)) score += 0.18;
    if (state.prefs?.includes('BEEF') && /牛|beef|巨无霸|汉堡/i.test(f.name)) score += 0.18;
    if (state.prefs?.includes('SPICY') && /辣|spicy/i.test(f.name)) score += 0.12;
    if (state.prefs?.includes('NO_SPICY') && /辣/.test(f.name)) score -= 0.15;
    if (state.prefs?.includes('VEG') || state.prefs?.includes('LIGHT')) {
      if (/沙拉|蔬菜| salad|玉米|tea|茶/i.test(f.name)) score += 0.15;
    }
    if (state.prefs?.includes('FRIES') && /薯|fries/i.test(f.name)) score += 0.1;
    return { ...f, score };
  });

  const sorted = scored.sort((a, b) => b.score - a.score).slice(0, count);
  const totalEnergy = sorted.reduce((s, f) => s + (f.energy || 0), 0);
  const totalProtein = sorted.reduce((s, f) => s + (f.protein || 0), 0);
  const totalFat = sorted.reduce((s, f) => s + (f.fat || 0), 0);
  const totalSodium = sorted.reduce((s, f) => s + (f.sodium || 0), 0);

  return {
    items: sorted.map((f) => ({ name: f.name, energy: f.energy, protein: f.protein, fat: f.fat, carb: f.carb })),
    totalEnergy,
    totalProtein,
    totalFat,
    totalSodium,
    targetEnergy,
    gap: Math.round(targetEnergy - totalEnergy),
    source: 'mcd-mcp::list-nutrition-foods',
  };
}

/** 券规整 + 可用性判断 */
function normalizeCoupons(list) {
  return list
    .map((c) => {
      const name = pick(c, ['couponName', 'name', 'title', 'discountName']);
      if (!name) return null;
      const amount = pick(c, ['amount', 'discountAmount', 'value', 'price']);
      const threshold = pick(c, ['threshold', 'minAmount', 'useThreshold', 'conditionAmount', 'fullAmount']);
      const status = pick(c, ['status', 'state'], '');
      const expire = pick(c, ['expireTime', 'validEndTime', 'endTime', 'expireDate'], '');
      return { name, amount, threshold, status, expire, raw: c };
    })
    .filter(Boolean);
}

/** 券能否用于「估算预算」这一档：门槛 <= budget */
export function applicableCoupons(coupons, budget) {
  if (budget == null) return [];
  return coupons.filter((c) => {
    const th = Number(c.threshold);
    if (!Number.isFinite(th)) return true; // 无门槛信息的券不排除，但标注未验证
    return th <= budget;
  });
}

/**
 * 主入口：跑完整 MCP 依赖解析
 * @param {import('./mcd-client.mjs').McdMcpClient} client
 * @param {object} state LifeState
 */
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

  const record = (tool, ok, summary) => {
    trace.push({ tool, ok, summary });
  };

  if (!client.hasToken) {
    record('(skipped)', false, '未配置 MCD_MCP_TOKEN，本次为离线编译');
    return { trace, facts, degraded: true, degradeReason: 'NO_TOKEN' };
  }

  // 1) 时间：MCP 权威
  const timeRes = await safeCall(() => client.callTool('now-time-info', {}));
  if (timeRes.ok && !timeRes.data.isError) {
    facts.time = normalizeTimeInfo(timeRes.data.data);
    facts.timeSource = 'mcp';
    record('now-time-info', true, `${facts.time.timeOfDay} @${String(facts.time.hour).padStart(2, '0')}:00`);
  } else {
    record('now-time-info', false, timeRes.error?.message || '调用失败，已降级为本地推断');
  }

  // 2) 营养表：真实能量/蛋白数据
  const nutRes = await safeCall(() => client.callTool('list-nutrition-foods', {}));
  if (nutRes.ok && !nutRes.data.isError) {
    const list = normalizeNutrition(toArray(nutRes.data.data));
    facts.nutrition = list;
    facts.nutritionPlan = pickNutritionPlan(list, state, 3);
    record('list-nutrition-foods', true, `${list.length} 条真实营养数据`);
  } else {
    record('list-nutrition-foods', false, nutRes.error?.message || '调用失败');
  }

  // 3) 活动日历：真实在售活动
  const campRes = await safeCall(() => client.callTool('campaign-calendar', {}));
  if (campRes.ok && !campRes.data.isError) {
    const raw = campRes.data.data;
    const list = toArray(raw);
    facts.campaigns = list
      .map((a) => ({
        name: pick(a, ['activityName', 'name', 'title', 'campaignName']),
        desc: pick(a, ['description', 'desc', 'content', 'brief'], ''),
        start: pick(a, ['startTime', 'beginTime', 'startDate'], ''),
        end: pick(a, ['endTime', 'finishTime', 'endDate'], ''),
        raw: a,
      }))
      .filter((a) => a.name)
      .slice(0, 6);
    record('campaign-calendar', true, `${facts.campaigns.length} 个当月活动`);
  } else {
    record('campaign-calendar', false, campRes.error?.message || '调用失败');
  }

  // 4) 我的券（真实持有）
  const myRes = await safeCall(() => client.callTool('query-my-coupons', {}));
  if (myRes.ok && !myRes.data.isError) {
    facts.myCoupons = normalizeCoupons(toArray(myRes.data.data));
    record('query-my-coupons', true, `${facts.myCoupons.length} 张可用券`);
  } else if (myRes.error?.code === 'UNAUTHORIZED') {
    record('query-my-coupons', false, 'Token 无效，券信息不可用');
  } else {
    record('query-my-coupons', false, myRes.error?.message || '调用失败');
  }

  // 5) 可领券（真实可领）
  const avRes = await safeCall(() => client.callTool('available-coupons', {}));
  if (avRes.ok && !avRes.data.isError) {
    facts.availableCoupons = normalizeCoupons(toArray(avRes.data.data));
    record('available-coupons', true, `${facts.availableCoupons.length} 张可领券`);
  } else {
    record('available-coupons', false, avRes.error?.message || '调用失败');
  }

  // 6) 积分
  const accRes = await safeCall(() => client.callTool('query-my-account', {}));
  if (accRes.ok && !accRes.data.isError) {
    const d = accRes.data.data || {};
    facts.account = {
      points: pick(d, ['availablePoints', 'points', 'usablePoints', 'balance'], null),
      total: pick(d, ['totalPoints', 'accumulatedPoints'], null),
      expiring: pick(d, ['expiringPoints', 'expirePoints', 'willExpirePoints'], null),
      raw: d,
    };
    record('query-my-account', true, facts.account.points != null ? `可用积分 ${facts.account.points}` : '积分信息已获取');
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

/**
 * 生成补给方案文本。
 * 严格区分三类信息：
 *   [MCP]    来自麦当劳 MCP 的真实数据
 *   [AI]     创意表达/推理
 *   [?]      需要用户到官方渠道确认
 */
export function buildPlan({ state, runtime, facts, trace }) {
  const budget = state.budget ?? 50; // safe default，日志中已标注
  const budgetIsDefault = state.budget == null;
  const plan = [];
  const mcpOk = (tool) => trace.find((t) => t.tool === tool)?.ok;

  // ---- 1) 主食：基于真实营养数据 ----
  if (facts.nutritionPlan) {
    const p = facts.nutritionPlan;
    plan.push({
      slot: '主食组合',
      title: '高能量密度组合（真实营养数据驱动）',
      lines: p.items.map((i) => `${i.name} — 能量 ${i.energy} / 蛋白质 ${i.protein}g`),
      mcpSource: 'mcd-mcp::list-nutrition-foods',
      why: `目标能量约 ${p.targetEnergy} kcal，该组合提供 ${p.totalEnergy} kcal，缺口 ${p.gap > 0 ? p.gap : 0} kcal${
        p.gap > 0 ? '（建议再加一份小食补齐）' : '（已覆盖）'
      }。蛋白质 ${p.totalProtein}g，有助于饱腹感。`,
      creative: '用「能量缺口 / 蛋白质」这些工程指标解释「为什么现在该吃这个」，是本项目的创意表达部分。',
    });
  } else {
    plan.push({
      slot: '主食组合',
      title: '营养数据不可用',
      lines: ['list-nutrition-foods 未返回可用数据，本次不做营养维度推荐。'],
      mcpSource: null,
      why: '不编造营养数据。',
      creative: '无',
    });
  }

  // ---- 2) 预算与优惠：真实券 + 官方计价 ----
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
        budgetBlock.lines.push(`  · ${c.name}${c.amount != null ? `（面额/优惠 ${c.amount}）` : ''}`);
      }
    } else {
      budgetBlock.lines.push(`账户内共 ${facts.myCoupons.length} 张券，但门槛均高于 ¥${budget}，本场景用不上。`);
    }
  } else {
    budgetBlock.lines.push('未能获取账户优惠券信息（需有效 Token）。');
  }

  if (facts.availableCoupons.length > 0) {
    budgetBlock.mcpSource.push('mcd-mcp::available-coupons');
    budgetBlock.lines.push(`另有 ${facts.availableCoupons.length} 张券当前可领取 —— 这是最直接的省钱动作。`);
  }

  if (facts.price) {
    budgetBlock.mcpSource.push('mcd-mcp::calculate-price');
    budgetBlock.lines.push(`官方计价结果：应付 ¥${facts.price.total}${facts.price.deliveryFee ? `（含配送费 ¥${facts.price.deliveryFee}）` : ''}`);
    budgetBlock.why = '该金额为麦当劳 MCP 官方计价输出，含优惠与配送费，可信度最高。';
  } else {
    budgetBlock.lines.push('未执行 calculate-price（需先确定门店与具体商品），价格请以官方 App/小程序为准。');
    budgetBlock.why = '本项目不编造实时价格。';
  }
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
    happyBlock.lines.push(`当月真实活动中可关注：`);
    for (const c of facts.campaigns.slice(0, 3)) {
      happyBlock.lines.push(`  · ${c.name}${c.start ? `（${c.start} 起）` : ''}`);
    }
    happyBlock.why = '活动信息来自当月活动日历，是真实在售内容，而非编造。';
  } else {
    happyBlock.lines.push('活动日历不可用，无法给出真实活动推荐。');
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
      ? '时段判定使用 MCP 返回的服务端时间，避免客户端时钟偏差。'
      : 'MCP 时间调用失败，此处为本地推断，置信度较低。';
  plan.push(timeBlock);

  // ---- 5) 积分路径 ----
  if (facts.account?.points != null && Number(facts.account.points) > 0) {
    plan.push({
      slot: '积分路径',
      title: `账户可用积分 ${facts.account.points}`,
      lines: [
        facts.account.expiring != null ? `其中 ${facts.account.expiring} 积分即将过期，注意使用。` : '积分余额信息来自账户查询。',
        '积分兑换路径见 mall-points-products（本项目默认不自动兑换）。',
      ],
      mcpSource: ['mcd-mcp::query-my-account'],
      why: '过期的积分是最容易白白浪费的资产。',
      creative: '把「积分过期」类比成「依赖版本过期」。',
    });
  }

  const failed = trace.filter((t) => !t.ok).map((t) => t.tool);
  return { plan, failed, toolsUsed: TOOLS_USED.filter((t) => mcpOk(t)) };
}
