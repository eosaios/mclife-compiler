# Bug 类型库

所有 Bug 都是**生活状态的娱乐化工程隐喻**，不是医学或心理学诊断。

## 严重度分级

| 级别 | 含义 | 视觉 |
|------|------|------|
| `ERROR` | 阻断性问题，必须处理 | 红色 ✖ |
| `WARN` | 降级运行，可延后处理 | 黄色 ⚠ |
| `INFO` | 优化提示 | 青色 ℹ |

## 完整清单

### ERROR 级

#### `OVERTIME_OVERFLOW` — 加班溢出
- **编译器信息**：`Workload exceeded recommended threshold`
- **触发条件**：情绪 STRESSED/EXHAUSTED；情景 OVERTIME_NIGHT；或疲劳度 ≥ 7
- **关键词**：加班、996、007、连轴转、高强度、肝到、熬夜
- **修复建议**：停止接单，先补能量再继续 build
- **隐喻来源**：整数溢出（int overflow）—— 工作量超出容器容量

#### `ENERGY_UNDERFLOW` — 精力不足
- **编译器信息**：`Energy buffer underflow detected`
- **触发条件**：情绪 EXHAUSTED/BURNED_OUT；疲劳度 ≥ 8；饥饿度 ≥ 8
- **关键词**：累、疲、透支、扛不住、精疲力尽、饿死了
- **修复建议**：补充高能量密度补给，避免空转
- **隐喻来源**：无符号整数下溢——精力被借走且未归还

#### `DEADLINE_EXCEPTION` — 截止日期异常
- **编译器信息**：`Deadline buffer exhausted, throwing unhandled exception`
- **触发条件**：情景 MEETING / DEADLINE
- **关键词**：deadline、ddl、截止、上线、交付、赶工、开会、汇报
- **修复建议**：把交付拆小，先交一个能跑的版本
- **隐喻来源**：未捕获异常——到点才发现自己没处理

#### `SLEEP_DEPENDENCY_STALE` — 睡眠依赖过期
- **编译器信息**：`Sleep dependency is stale, cache miss on recovery`
- **触发条件**：疲劳 ≥ 8；情景 OVERTIME_NIGHT；偏好含 LATE_NIGHT；情绪 EXHAUSTED
- **关键词**：通宵、熬夜、整夜、没睡、夜宵、深夜
- **修复建议**：优先补睡眠，短期靠食物托底
- **隐喻来源**：依赖版本过期——缓存里的睡眠已经失效

### WARN 级

#### `HAPPINESS_NOT_FOUND` — 快乐依赖缺失
- **编译器信息**：`Happiness dependency missing, falling back to default joy`
- **触发条件**：情绪 STRESSED/SAD/ANGRY/BURNED_OUT；或关联规则触发
- **关联规则**：`REQUIREMENT_RECURSION` 或 `SLEEP_DEPENDENCY_STALE` 存在时必定触发
- **修复建议**：注入一个即时愉悦因子（甜品/饮料）
- **隐喻来源**：模块解析失败——import 不到 happiness 包

#### `REQUIREMENT_RECURSION` — 需求无限递归
- **编译器信息**：`Requirement change recursion depth exceeded`
- **触发条件**：情景 DEADLINE
- **关键词**：改需求、需求变更、需求又变了
- **修复建议**：把需求冻结，先完成当前 iteration
- **隐喻来源**：无限递归——需求改了又改，栈溢出

#### `MEETING_MEMORY_LEAK` — 会议内存泄漏
- **编译器信息**：`Context memory leaked during synchronous meetings`
- **触发条件**：情景 MEETING；情绪 ANGRY
- **关键词**：开会、会议、评审、面谈
- **修复建议**：清理无用上下文，保留有效结论
- **隐喻来源**：内存泄漏——开了五小时会，内存全被上下文占满

#### `BUG_FIX_LOOP` — 修 Bug 死循环
- **编译器信息**：`Detected recursive bug-fix loop in current iteration`
- **触发条件**：情景 DEBUG_DAY
- **关键词**：bug、debug、报错、线上问题、故障、排查、修复
- **修复建议**：跳出循环，先吃饭再回来看代码
- **隐喻来源**：死循环——同一个 bug 修了十几次

#### `HUNGRY_VALUE_UNDEFINED` — 饥饿值未定义
- **编译器信息**：`Hunger variable is undefined, using safe default`
- **触发条件**：用户输入中没有饥饿相关表达
- **修复建议**：按常规补给量处理
- **设计意图**：**刻意保留的 Bug 项**。让用户看到「你连自己饿不饿都没定义」，
  这是本项目的幽默点之一，不做追问。

### INFO 级

#### `BUDGET_CONSTRAINT_ACTIVE` — 预算约束生效
- **触发条件**：预算 ≤ 30 元
- **修复建议**：优先使用可用优惠后再下单
- **业务价值**：驱动 MCP `query-my-coupons` / `available-coupons` 调用

#### `LONELY_MODE_NO_PAIR` — 单人模式无搭档
- **触发条件**：情景 LONELY
- **关键词**：一个人、孤独、单身、没人
- **修复建议**：单人份即最优解，无需拼单

#### `WEATHER_DEPENDENCY_DEGRADED` — 天气依赖降级
- **触发条件**：情景 RAINY
- **关键词**：下雨、暴雨、台风、降温
- **修复建议**：到店取餐，不受配送影响

#### `TEAM_MODE_BUNDLE_OPTIMIZED` — 团队模式已合并
- **触发条件**：情景 TEAM
- **关键词**：团队、同事、项目组、多人
- **修复建议**：走多人套餐，摊薄单价

## Bug 选择算法

```
1. 情绪映射：EMOTION_BUG_MAP 取出该情绪对应的 2 个 Bug
2. 情景映射：SCENARIO_BUG_MAP 取出该情景对应的 1-2 个 Bug
3. 阈值触发：疲劳、饥饿、预算、偏好满足条件时追加
4. 关联规则：
   - REQUIREMENT_RECURSION → 追加 HAPPINESS_NOT_FOUND
   - SLEEP_DEPENDENCY_STALE  → 追加 HAPPINESS_NOT_FOUND
5. 去重 + 排序：按 ERROR → WARN → INFO，同级保持触发顺序
6. 兜底：若结果为空，追加 HAPPINESS_NOT_FOUND（保证报告永远有内容）
```

实现见 `scripts/compile-engine.mjs` 的 `detectBugs()`。

## 扩展方式

新增 Bug 类型只需两步：

1. 在 `BUG_LIBRARY` 中添加条目（code / severity / title / message / fixHint）
2. 在 `EMOTION_BUG_MAP`、`SCENARIO_BUG_MAP` 或 `detectBugs()` 的阈值规则中挂载

无需改动解析器和渲染器。
