# 🍔 McLife Compiler · 麦麦人生编译器

> **把人生的 Bug，编译成一顿麦当劳。**

一个基于**麦当劳中国官方 MCP Server** 的开源 AI Skill。
你用自然语言描述今天的生活状态，它把这些状态编译成一份程序员风格的诊断报告 ——
Bug 清单、编译日志、运行状态评分，以及一份来自麦当劳官方 MCP 真实数据的补给方案。

```
$ mclife "今天加班到凌晨，修了十几个 Bug，明天还要开会，预算只有 30 元。"

# 以下输出全部来自麦当劳官方 MCP Server 真实调用（2026-10-09 21:41）

  21:41:08 [INFO]  Loading Life Runtime...
  21:41:08 [INFO]  Runtime version: human/1.0.0 (kernel: OVERTIME_NIGHT)
  21:41:08 [INFO]  Detected mood=EXHAUSTED energy=2/10 hunger=UNKNOWN
  21:41:08 [INFO]  Server time resolved via mcd-mcp::now-time-info -> DINNER
  21:41:08 [ERROR] Energy buffer underflow detected  (life://energy-underflow)
  20:53:42 [ERROR] Sleep dependency is stale  (life://sleep-dependency-stale)
  20:53:42 [ERROR] Workload exceeded recommended threshold  (life://overtime-overflow)
  20:53:42 [INFO]  Resolving McDonald's resources via mcd-mcp...
  21:41:08 [SUCCESS] mcp.now-time-info -> DINNER @21:00 2026-10-09
  21:41:08 [SUCCESS] mcp.list-nutrition-foods -> 160 条真实营养数据
  21:41:08 [SUCCESS] mcp.campaign-calendar -> 30 个活动（2026年10月7日 往期回顾 等）
  21:41:08 [SUCCESS] mcp.query-my-coupons -> 账户当前无已持有券
  21:41:08 [SUCCESS] mcp.available-coupons -> 9 张可领券
  21:41:08 [SUCCESS] mcp.query-my-account -> 可用积分 0 麦享会积分
  20:53:42 [INFO]  Linking happiness dependency...
  20:53:42 [SUCCESS] Recovery plan generated

  BUILD FAILED — recoverable
  runtime score: 21/100 (娱乐用途)  |  电量见底 · 深夜加班

  今日 Bug 清单 (5)
  ✖  1. ENERGY_UNDERFLOW  精力不足
  ✖  2. SLEEP_DEPENDENCY_STALE  睡眠依赖过期
  ✖  3. OVERTIME_OVERFLOW  加班溢出
  ⚠  4. HUNGRY_VALUE_UNDEFINED  饥饿值未定义
  ⚠  5. HAPPINESS_NOT_FOUND  快乐依赖缺失
  ℹ  6. BUDGET_CONSTRAINT_ACTIVE  预算约束生效

  人生不一定能一次编译通过，但快乐可以持续集成。
```

---

## 这是什么

**不是**一个套餐推荐助手。

普通助手会说：「你今天很累，建议点个巨无霸套餐。」
McLife Compiler 会说：

> `BUILD FAILED — recoverable`
> `ENERGY_UNDERFLOW` — Energy buffer underflow detected
> fix: 补充高能量密度补给，避免空转

然后**用麦当劳官方 MCP 的真实营养数据**算出你缺多少能量，
**用你账户里真实的券**判断你的预算能不能用上券，
**用当月真实的活动**给你一个能立刻注入的快乐依赖。

### 核心差异

| | 普通推荐助手 | McLife Compiler |
|---|---|---|
| 输出 | 「建议点 A 套餐」 | 一份编译诊断报告 |
| 数据来源 | 静态菜单 / 模型记忆 | 麦当劳官方 MCP 实时数据 |
| 缺数据时 | 猜一个 / 用内置表 | **明确标注「未验证」，绝不编造** |
| 预算判断 | 不知道你有什么券 | 查你账户真实持有的券，按门槛过滤 |
| 可解释性 | 「因为好吃」 | 「目标能量 995 kcal，该组合提供 720 kcal，缺口 275 kcal」 |
| 副作用 | 可能直接下单 | **严格只读，不下单不领券不扣款** |

---

## 快速开始

### 环境要求

- Node.js ≥ 18（无任何 npm 依赖，纯标准库）
- 麦当劳 MCP Token（[申请地址](https://open.mcd.cn/mcp)）

### 安装 Token

```bash
# 1. 前往 https://open.mcd.cn/mcp
#    右上角登录（手机号验证）→ 控制台 → 激活 → 同意服务协议 → 复制 MCP Token

# 2. 配置环境变量
export MCD_MCP_TOKEN=你的Token
```

### 作为 WorkBuddy Skill 使用（推荐）

```bash
# 克隆到 WorkBuddy 技能目录
git clone https://github.com/eosaios/mclife-compiler.git \
  ~/.workbuddy/skills/mclife-compiler

# 验证 MCP 连接
node ~/.workbuddy/skills/mclife-compiler/scripts/mclife.mjs --check
```

重启 WorkBuddy 后即可用自然语言触发：

```
帮我编译一下今天的人生
今天加班好累，给我 Debug 一下
我只有 25 元，编译一份快乐
帮我生成今天的麦麦人生报告
今天 emo 了，吃点什么好
```

### 作为 CLI 使用

```bash
cd mclife-compiler/skills/mclife-compiler

# 终端报告
node scripts/mclife.mjs "今天加班到凌晨，预算只有 30 元"

# Markdown 报告
node scripts/mclife.mjs "累死了" --format md --out report.md

# 分享卡片（浏览器打开后全页截图）
node scripts/mclife.mjs "累死了" --format card --out card.html

# 结构化 JSON
node scripts/mclife.mjs "累死了" --format json

# 追问补齐参数
node scripts/mclife.mjs "想吃辣" --budget 35 --pref spicy,light

# MCP 探活 / 查看官方真实工具清单
node scripts/mclife.mjs --check
node scripts/mclife.mjs --tools
```

### 在其他 MCP Client 中接入

把 `mcp-config.example.json` 内容加到你的 MCP 配置里：

```json
{
  "mcpServers": {
    "mcd-mcp": {
      "type": "streamablehttp",
      "url": "https://mcp.mcd.cn",
      "headers": {
        "Authorization": "Bearer ${MCD_MCP_TOKEN}"
      }
    }
  }
}
```

---

## 使用示例

### 输入

```
今天加班到凌晨，修了十几个 Bug，明天还要开会，预算只有 30 元。
```

### 解析出的状态

| 字段 | 值 | 来源 |
|------|-----|------|
| emotion | `EXHAUSTED` | 疲劳度 ≥ 8 推断 |
| fatigue | 8/10 | 「加班到凌晨」 |
| hunger | `UNKNOWN` | 未提及 → 触发 `HUNGRY_VALUE_UNDEFINED` |
| budget | ¥30 | 「预算只有 30 元」 |
| scenario | `OVERTIME_NIGHT` | 「加班到凌晨」 |

### 检出的 Bug

| # | 级别 | Code | 含义 |
|---|------|------|------|
| 1 | ERROR | `ENERGY_UNDERFLOW` | 精力不足 |
| 2 | ERROR | `SLEEP_DEPENDENCY_STALE` | 睡眠依赖过期 |
| 3 | ERROR | `OVERTIME_OVERFLOW` | 加班溢出 |
| 4 | WARN | `HUNGRY_VALUE_UNDEFINED` | 饥饿值未定义 |
| 5 | WARN | `HAPPINESS_NOT_FOUND` | 快乐依赖缺失 |
| 6 | INFO | `BUDGET_CONSTRAINT_ACTIVE` | 预算约束生效 |

### 麦麦补给方案（MCP 真实数据）

```
── 主食组合 · 高能量密度组合（真实营养数据驱动）
   主料：专"薯鱼"你 — 463 kcal / 蛋白质 18g（命中你的 LATE_NIGHT 偏好）
   搭配：大薯条（379 kcal · LATE_NIGHT）、中薯条（289 kcal · LATE_NIGHT）
   合计 1131 kcal / 蛋白 28g / 脂肪 45g / 钠 1033mg
   [MCP] mcd-mcp::list-nutrition-foods
   理由: 目标能量约 920 kcal，该组合提供 1131 kcal，已在合理区间内。
         官方营养表共 160 条，本次全部从中选取，未引入任何表外条目。

── 预算与优惠 · 预算 ¥30
   账户当前没有已持有的优惠券（真实查询结果）。
   另有 9 张券当前可领取 —— 这是最直接的省钱动作
── 快乐依赖 · HAPPINESS_NOT_FOUND 修复方案
   当月真实活动中可关注：超值9.9元早餐两件套陪你开工啦😋、麦当劳 X PEACEMINUSONE...
── 时段策略 · 当前时段：DINNER
   晚餐时段：适合正餐组合，堂食/取餐柜取餐更快。
── 积分路径 · 账户积分状态
   可用积分 0 麦享会积分，累计获得 384.6。
   已有 384.6 积分过期 —— 这就是「依赖版本过期」的代价。
```

> 每一块都标注了 `[MCP]` 数据来源和 `[AI]` 创意部分。
> 失败的调用会进入「未验证声明」，明确告知哪些结论缺少真实数据支撑。

---

## Bug 类型库

| Code | 级别 | 触发条件 |
|------|------|----------|
| `OVERTIME_OVERFLOW` | ERROR | 加班 / 疲劳度 ≥ 7 |
| `ENERGY_UNDERFLOW` | ERROR | 累 / 疲劳度 ≥ 8 / 饥饿度 ≥ 8 |
| `DEADLINE_EXCEPTION` | ERROR | deadline / 开会 / 交付冲刺 |
| `SLEEP_DEPENDENCY_STALE` | ERROR | 通宵 / 熬夜 / 夜宵 |
| `HAPPINESS_NOT_FOUND` | WARN | 负面情绪 / 需求递归 / 睡眠过期 |
| `REQUIREMENT_RECURSION` | WARN | 改需求 / 交付冲刺 |
| `MEETING_MEMORY_LEAK` | WARN | 开会 / 情绪 ANGRY |
| `BUG_FIX_LOOP` | WARN | debug / 排查 |
| `HUNGRY_VALUE_UNDEFINED` | WARN | 没提饿不饿（**刻意保留的幽默项**） |
| `BUDGET_CONSTRAINT_ACTIVE` | INFO | 预算 ≤ 30 元 |
| `LONELY_MODE_NO_PAIR` | INFO | 一个人 |
| `WEATHER_DEPENDENCY_DEGRADED` | INFO | 下雨 / 降温 |
| `TEAM_MODE_BUNDLE_OPTIMIZED` | INFO | 团队 / 多人 |

完整说明见 [`skills/mclife-compiler/references/bug-library.md`](skills/mclife-compiler/references/bug-library.md)。

---

## MCP 集成

本项目调用 **6 个**麦当劳官方 MCP 工具，每次编译最多 6 次调用
（官方限流 600 次/分钟）：

| Tool | 业务价值 |
|------|----------|
| `now-time-info` | 服务端权威时间，判定时段，避免客户端时钟偏差 |
| `list-nutrition-foods` | **唯一营养数据来源**，项目不内置营养表 |
| `campaign-calendar` | 把「快乐依赖缺失」锚定到当月真实活动 |
| `query-my-coupons` | 按券门槛 ≤ 预算过滤，判断预算可行性 |
| `available-coupons` | 识别「有券没领」这一真实省钱动作 |
| `query-my-account` | 识别即将过期积分 |

**明确不调用**任何下单、领券、抽奖、取消订单等写操作 Tool ——
本项目严格只读，不产生任何交易。

**绝不编造**：项目不内置菜单、价格、营养或活动数据。
MCP 不可用时显式标注「未验证」并指向官方渠道。

详见 [`MCP_INTEGRATION.md`](MCP_INTEGRATION.md)。

---

## 项目结构

```
mclife-compiler/
├── README.md
├── CONTEST_DECLARATION.md      参赛声明（官方原文）
├── MCP_INTEGRATION.md          MCP 集成说明
├── mcp-config.example.json     脱敏配置示例
├── workbuddy.md                WorkBuddy 开发对话记录
├── LICENSE
├── skills/mclife-compiler/
│   ├── SKILL.md                Skill 主文件
│   ├── scripts/
│   │   ├── mclife.mjs          CLI 主入口
│   │   ├── mcd-client.mjs      MCP Streamable HTTP 客户端
│   │   ├── life-parse.mjs      人生状态解析器
│   │   ├── compile-engine.mjs  编译引擎 + Bug 库
│   │   ├── mcd-resolver.mjs    麦麦依赖解析（MCP 调用）
│   │   └── report.mjs          三种报告渲染
│   └── references/
│       ├── bug-library.md      Bug 类型库
│       └── mcp-tools.md        MCP 工具参考
├── web/                        Vue 3 + TS + Vite 分享卡片（可选增强）
├── examples/                   示例输出
└── tests/
    └── test.mjs                46 项单元测试
```

---

## 开发与测试

```bash
# 单元测试（无需网络、无需 Token）
node tests/test.mjs

# 输出示例
✓ 通过 59  失败 0
```

测试覆盖：预算解析（阿拉伯/中文数字/缺失）、疲劳阈值、情绪联动推断、
Bug 检出与排序、**官方三种返回格式解析**、**偏好优先级（含「不辣」互斥消歧）**、
**能量缺口控制（不超目标 125%）**、券门槛过滤、报告渲染、XSS 转义、
空输入与超长输入边界。

其中 13 项是从**真实 MCP 返回样本**中提取的回归测试 —— 包括官方自定义表格格式
`[160]{productName,energyKcal,...}`、Markdown 活动/券格式、`availablePoint` 积分字段。

**技术栈**：Node.js 标准库，零运行时依赖。MCP 客户端为手写实现
（Streamable HTTP + SSE 解析 + Session 管理 + 三种返回格式归一化），
不引入第三方 MCP SDK。

---

## 目标用户

- **程序员** — 用熟悉的编译器隐喻理解今天的状态，报告可直接截图发朋友圈/群
- **加班狗** — 「今天加班到凌晨」→ 拿到一份扎心的 Bug 清单和一份补给方案
- **选择困难症** — 「我只有 25 元」→ 按真实券和预算给出可执行结论
- **麦当劳用户** — 想知道账户里有哪些券快过期了

---

## 演示说明

现场演示建议用这条输入，能同时触发加班 Bug、预算约束、快乐缺失三种元素：

> 今天加班到凌晨，修了十几个 Bug，明天还要开会，预算只有 30 元。

**演示脚本**：

1. 展示 `--check`，证明 MCP 真实连通（打印服务端信息 + 工具清单）
2. 运行上述输入，展示终端报告
3. 指出 `--tools` 输出的官方工具数量，说明本项目用了哪几个
4. 展示报告中每项建议的 `[MCP]` 来源标注
5. 故意 unset Token 再跑一次，展示**优雅降级** —— 明确显示「未验证」而不是编造数据
6. 生成 `--format card` 分享卡片，全页截图

第 5 步是本项目最有说服力的部分：**它证明了不联网时项目不会瞎编。**

---

## 隐私

- Token 只从环境变量读取，**不写入代码、日志、报告、Git**
- 本项目**不采集、不存储、不上传**任何用户数据
- 所有 MCP 调用均为只读查询

---

## 致谢与免责

- 感谢[麦当劳中国](https://open.mcd.cn/mcp)开放 MCP Server，让开发者能构建这样的应用
- MCP Server 官方仓库：https://github.com/M-China/mcd-mcp-server

**本项目为非麦当劳官方开发者作品**，与麦当劳及其关联公司无任何官方合作关系。
麦当劳、McDonald's、巨无霸等商标归其权利人所有，本项目不使用其 Logo 或官方视觉素材。

运行状态评分为**娱乐用途**，不是医学或心理学评估。
餐品信息、价格、优惠与供应状态以麦当劳官方渠道实时结果为准。

## License

MIT
