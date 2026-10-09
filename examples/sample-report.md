# McLife Compiler · 人生编译报告

> 把你的人生状态当成一次构建来编译，把 Bug 编译成一顿麦当劳。

## 编译状态

```
BUILD FAILED — recoverable
runtime score : 21/100   (娱乐用途，非医学/心理学评估)
energy        : 2/10
mood          : 电量见底
scenario      : 深夜加班
hunger        : UNKNOWN
budget        : ¥30
detected at   : DINNER（来源：MCP now-time-info）
```

## 编译日志

```text
21:45:21 [INFO]  Loading Life Runtime...
21:45:21 [INFO]  Runtime version: human/1.0.0 (kernel: OVERTIME_NIGHT)
21:45:21 [INFO]  Detected mood=EXHAUSTED energy=2/10 hunger=UNKNOWN
21:45:21 [INFO]  Server time resolved via mcd-mcp::now-time-info -> DINNER
21:45:21 [INFO]  Budget constraint: ¥30
21:45:21 [ERROR] Energy buffer underflow detected  (life://energy-underflow)
21:45:21 [ERROR] Sleep dependency is stale, cache miss on recovery  (life://sleep-dependency-stale)
21:45:21 [ERROR] Workload exceeded recommended threshold  (life://overtime-overflow)
21:45:21 [WARN] Hunger variable is undefined, using safe default  (life://hungry-value-undefined)
21:45:21 [WARN] Happiness dependency missing, falling back to default joy  (life://happiness-not-found)
21:45:21 [INFO] Budget constraint active, optimizing for cost  (life://budget-constraint-active)
21:45:21 [INFO]  Resolving McDonald's resources via mcd-mcp...
21:45:21 [SUCCESS] mcp.now-time-info -> DINNER @21:00 2026-10-09                                    
21:45:21 [SUCCESS] mcp.list-nutrition-foods -> 160 条真实营养数据                                                 
21:45:21 [SUCCESS] mcp.campaign-calendar -> 30 个活动（2026年10月7日 往期回顾 等）                                   
21:45:21 [SUCCESS] mcp.query-my-coupons -> 账户当前无已持有券                                                   
21:45:21 [SUCCESS] mcp.available-coupons -> 9 张可领券                                                      
21:45:21 [SUCCESS] mcp.query-my-account -> 可用积分 0 麦享会积分                                                
21:45:21 [INFO]  Linking happiness dependency...
21:45:21 [SUCCESS] Recovery plan generated

BUILD FAILED — recoverable
runtime score: 21/100 (娱乐用途)  |  电量见底 · 深夜加班
```

## 今日 Bug 清单 (6)

| # | 级别 | Bug Code | 含义 | 编译器信息 |
|---|------|----------|------|------------|
| 1 | ERROR | `ENERGY_UNDERFLOW` | 精力不足 | Energy buffer underflow detected |
| 2 | ERROR | `SLEEP_DEPENDENCY_STALE` | 睡眠依赖过期 | Sleep dependency is stale, cache miss on recovery |
| 3 | ERROR | `OVERTIME_OVERFLOW` | 加班溢出 | Workload exceeded recommended threshold |
| 4 | WARN | `HUNGRY_VALUE_UNDEFINED` | 饥饿值未定义 | Hunger variable is undefined, using safe default |
| 5 | WARN | `HAPPINESS_NOT_FOUND` | 快乐依赖缺失 | Happiness dependency missing, falling back to default joy |
| 6 | INFO | `BUDGET_CONSTRAINT_ACTIVE` | 预算约束生效 | Budget constraint active, optimizing for cost |

- **`ENERGY_UNDERFLOW`** → 补充高能量密度补给，避免空转
- **`SLEEP_DEPENDENCY_STALE`** → 优先补睡眠，短期靠食物托底
- **`OVERTIME_OVERFLOW`** → 停止接单，先补能量再继续 build
- **`HUNGRY_VALUE_UNDEFINED`** → 按常规补给量处理
- **`HAPPINESS_NOT_FOUND`** → 注入一个即时愉悦因子（甜品/饮料）
- **`BUDGET_CONSTRAINT_ACTIVE`** → 优先使用可用优惠后再下单

## 麦麦补给方案

### 主食组合 · 高能量密度组合（真实营养数据驱动）

- 主料：专“薯鱼”你 — 463 kcal / 蛋白质 18g（命中你的 LATE_NIGHT 偏好）
- 搭配：大薯条（379 kcal · LATE_NIGHT）、小薯条（210 kcal · LATE_NIGHT）
- 合计 1052 kcal / 蛋白 27g / 脂肪 42g / 钠 988mg

> `[MCP]` 本节数据来自：mcd-mcp::list-nutrition-foods
> **理由**：目标能量约 860 kcal（按你的疲劳度与饥饿度推算，上限 1100 kcal），该组合提供 1052 kcal，已在合理区间内（不超目标 25%，即 1075 kcal）。 官方营养表共 160 条，本次全部从中选取，未引入任何表外条目。
> `[AI]` 用「能量缺口 / 蛋白质密度」这些工程指标解释「为什么现在该吃这个」，是本项目的创意表达部分。

### 预算与优惠 · 预算 ¥30

- 账户当前没有已持有的优惠券（真实查询结果）。
- 另有 9 张券当前可领取 —— 这是最直接的省钱动作，例：麦旋风任选、巧克力味厚松饼猪柳蛋套餐
- 未执行 calculate-price（需先确定门店与具体商品），实时价格请以官方 App/小程序为准。

> `[MCP]` 本节数据来自：mcd-mcp::available-coupons
> **理由**：本项目不编造实时价格。

### 快乐依赖 · HAPPINESS_NOT_FOUND 修复方案

- 当月真实活动中可关注：
-   · 超值𝟗.𝟗元早餐两件套陪你开工啦😋 —— 早八的快乐，一堡一咖已就位🍔☕ 𝟏𝟎月𝟖日至𝟏𝟎月𝟐𝟏日 🍔周一至周五早餐堡轮流上（2026年10月7日 往期回顾）
-   · 麦当劳 X PEACEMINUSONE —— GD同款联名复古棒球帽 任意餐品消费加39.9元即可得 经典红黄配色搭配复古轮廓，MV同款灵感重现 （2026年10月8日 往期回顾）
-   · 麦咖啡一早现磨🥳元气早餐震撼来袭！ —— ☕甄选 2024IIAC 国际咖啡品鉴大赛“金奖“咖啡豆 🥪多款人气早餐主食随心挑选，满足你的多种（2026年10月8日 往期回顾）

> `[MCP]` 本节数据来自：mcd-mcp::campaign-calendar
> **理由**：活动信息来自官方活动日历的真实返回，而非编造。
> `[AI]` 把「吃点好的」翻译成「注入一个即时愉悦因子」，是编译器隐喻的落点。

### 时段策略 · 当前时段：DINNER

- 晚餐时段：适合正餐组合，堂食/取餐柜取餐更快。

> `[MCP]` 本节数据来自：mcd-mcp::now-time-info
> **理由**：时段判定使用 MCP 服务端返回的时间（2026-10-09 21:00），避免客户端时钟偏差。

### 积分路径 · 账户积分状态

- 可用积分 0 麦享会积分，累计获得 384.6。
- 已有 384.6 积分过期 —— 这就是「依赖版本过期」的代价。

> `[MCP]` 本节数据来自：mcd-mcp::query-my-account
> **理由**：过期积分是最容易白白浪费的资产；本项目不会自动兑换或抽奖。
> `[AI]` 把「积分过期」类比成「依赖版本过期」。

## MCP 调用记录

| Tool | 结果 | 说明 |
|------|------|------|

成功调用 0 个工具。

## 运行状态评分

| 维度 | 得分 |
|------|------|
| 能量水位 (ENERGY) | 20 |
| 情绪稳定度 (MOOD) | 22 |

> 运行状态评分为娱乐用途，不是医学或心理学评估。

## 总结

> 别怕 timeout，先把能量依赖装上。

---

运行状态评分为娱乐用途，不是医学或心理学评估；餐品信息、价格、优惠与供应状态以麦当劳官方渠道实时结果为准。

本报告由 [McLife Compiler](https://github.com/eosaios/mclife-compiler) 生成，为**非麦当劳官方开发者作品**。
数据来源：麦当劳中国官方 MCP Server（https://mcp.mcd.cn）。实时价格、优惠与供应状态以麦当劳官方渠道为准。

