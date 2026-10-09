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
detected at   : 未知
```

## 编译日志

```text
21:00:08 [INFO]  Loading Life Runtime...
21:00:08 [INFO]  Runtime version: human/1.0.0 (kernel: OVERTIME_NIGHT)
21:00:08 [INFO]  Detected mood=EXHAUSTED energy=2/10 hunger=UNKNOWN
21:00:08 [WARN]  now-time-info unavailable, time slot inferred locally (降低置信度)
21:00:08 [INFO]  Budget constraint: ¥30
21:00:08 [ERROR] Energy buffer underflow detected  (life://energy-underflow)
21:00:08 [ERROR] Sleep dependency is stale, cache miss on recovery  (life://sleep-dependency-stale)
21:00:08 [ERROR] Workload exceeded recommended threshold  (life://overtime-overflow)
21:00:08 [WARN] Hunger variable is undefined, using safe default  (life://hungry-value-undefined)
21:00:08 [WARN] Happiness dependency missing, falling back to default joy  (life://happiness-not-found)
21:00:08 [INFO] Budget constraint active, optimizing for cost  (life://budget-constraint-active)
21:00:08 [INFO]  Resolving McDonald's resources via mcd-mcp...
21:00:08 [FAIL] mcp.(skipped) -> 未配置 MCD_MCP_TOKEN，本次为离线编译                                   
21:00:08 [INFO]  Linking happiness dependency...
21:00:08 [SUCCESS] Recovery plan generated

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

### 主食组合 · 营养数据不可用

- list-nutrition-foods 未返回可用数据，本次不做营养维度推荐。

> **理由**：不编造营养数据。

### 预算与优惠 · 预算 ¥30

- 未能获取账户优惠券信息（需有效 Token）。
- 未执行 calculate-price（需先确定门店与具体商品），价格请以官方 App/小程序为准。

> **理由**：本项目不编造实时价格。

### 快乐依赖 · HAPPINESS_NOT_FOUND 修复方案

- 活动日历不可用，无法给出真实活动推荐。

> **理由**：不编造活动。
> `[AI]` 把「吃点好的」翻译成「注入一个即时愉悦因子」，是编译器隐喻的落点。

### 时段策略 · 当前时段：本地推断（MCP 时间不可用）

- 按常规时段处理。

> **理由**：MCP 时间调用失败，此处为本地推断，置信度较低。

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

