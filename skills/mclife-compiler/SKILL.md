---
name: mclife-compiler
description: >
  McLife Compiler（麦麦人生编译器）—— 把人生的 Bug，编译成一顿麦当劳。
  当用户说「帮我编译一下今天的人生」「今天加班好累，给我 Debug 一下」
  「我只有 25 元，编译一份快乐」「帮我生成今天的麦麦人生报告」
  「今天emo了，吃点什么好」「加班到凌晨，想吃点什么」时使用本技能。
  本技能基于麦当劳中国官方 MCP Server（https://mcp.mcd.cn）真实数据，
  把用户的生活状态编译成 Bug 清单 + 编译日志 + 麦麦补给方案 + 可分享报告。
  严格不编造实时价格、优惠、库存与营养信息。
version: 1.0.0
display_name: 麦麦人生编译器
display_name_en: McLife Compiler
author: eosaios
license: MIT
keywords: [mcd, mcd-mcp, 麦当劳, 麦当劳MCP, 程序员, 编译器, bug, debug, 生活记录, 情绪, 加班, 报告, 分享卡片, workbuddy, skill]
allowed-tools: Bash(node:*) Bash(python3:*)
---

# McLife Compiler · 麦麦人生编译器

> 把人生的 Bug，编译成一顿麦当劳。

## 这个 Skill 做什么

用户用自然语言描述今天的生活状态，Skill 会：

1. **解析人生代码** — 提取情绪、疲劳、饥饿、饮食偏好、预算、当前情景
2. **编译人生** — 生成编译器风格日志 + Bug 清单 + 运行状态评分（娱乐用途）
3. **解析麦麦依赖** — 调用麦当劳中国官方 MCP Server 真实工具
4. **输出编译报告** — 终端日志 / Markdown / 可截图分享卡片

## 核心执行命令

**主流程必须通过脚本执行，不要手工拼接报告。** 脚本已经封装了 MCP 调用、
降级逻辑和全部输出格式。

```bash
# 终端风格报告（默认）
node scripts/mclife.mjs "<用户原话>"

# Markdown 报告
node scripts/mclife.mjs "<用户原话>" --format md --out report.md

# 可截图分享卡片（浏览器打开后全页截图）
node scripts/mclife.mjs "<用户原话>" --format card --out card.html

# 结构化 JSON（用于二次加工）
node scripts/mclife.mjs "<用户原话>" --format json
```

### 追问补齐参数

```bash
# 用户被追问后明确给了预算和偏好（--pref 大小写/中文别名均可）
node scripts/mclife.mjs "<用户原话>" --budget 35 --pref spicy,light
node scripts/mclife.mjs "<用户原话>" --budget 40 --pref salad,清淡

# MCP 探活（首次使用或排错时先跑这个）
node scripts/mclife.mjs --check

# 列出 MCP Server 当前真实提供的全部工具
node scripts/mclife.mjs --tools
```

## 执行流程（Agent 必须按此顺序）

### Step 0 — 环境检查（仅首次或报错时）

运行 `node scripts/mclife.mjs --check`。

- 若提示 `token: ❌ 未配置` → 告知用户需要在 https://open.mcd.cn/mcp 申请 Token，
  然后 `export MCD_MCP_TOKEN=xxx`。**不要伪造 Token 继续跑。**
- 若提示 `UNAUTHORIZED` → Token 无效或过期，引导重新申请。
- 若提示 `RATE_LIMIT` → 降低频率，等待后重试。

Token 未配置时**仍可运行**（会走离线降级），但必须在回复中明确说明：
「当前未连接麦当劳 MCP，报告中餐品/价格/优惠部分为未验证状态。」

### Step 1 — 解析用户状态

把用户原话**原样**传给脚本，不要自己先改写或总结——解析器依赖原文关键词
（"加班到凌晨"、"预算只有 30 元"、"想吃辣"）。

从脚本 JSON 输出中检查 `state`：

- `budget === null` → 若用户未提预算，**简短追问一次**：「今天预算多少？」
  追问后仍无答案则用脚本默认值 ¥50，并在回复中说明用了默认值。
- `hunger === null` → 不追问，脚本会标记 `HUNGER_VALUE_UNDEFINED`（这是刻意设计的 Bug 项）。
- `prefs.length === 0` → 不追问，交给 MCP 营养数据自行匹配。

### Step 2 — 生成报告并直接展示

把终端输出**原样**呈现给用户。不要改写日志文案、不要删掉 `[FAIL]` 行、
不要美化掉「未验证」声明。这些是本项目可信度的一部分。

### Step 3 — 按需追问（多轮）

- 用户说「换个预算」→ 重新执行，带 `--budget`
- 用户说「要辣的」→ 重新执行，带 `--pref spicy`
- 用户说「给我份报告」→ 用 `--format md --out`
- 用户说「我要截图」→ 用 `--format card --out`，然后告诉用户用浏览器打开截图

### Step 4 — 补充说明

- 用户问「这个价格准不准」→ 强调价格来自 MCP `calculate-price` 或需官方渠道确认。
- 用户问「营养建议专业吗」→ 强调评分仅娱乐用途，不是医学/营养建议。

## 真实使用的 MCP 工具

本 Skill 实际调用以下麦当劳中国官方 MCP 工具，每个都有明确的不可替代用途：

| Tool | 用途 | 缺失时的降级 |
|------|------|--------------|
| `now-time-info` | 服务端权威时间，判定早/午/晚/夜宵时段 | 本地推断，报告标注置信度低 |
| `list-nutrition-foods` | 真实营养成分（能量/蛋白/脂肪/钠），驱动高能量组合选择 | 不做营养推荐，报告标注未验证 |
| `campaign-calendar` | 当月真实营销活动 | 不给活动推荐，不编造 |
| `query-my-coupons` | 账户真实持有券，判断预算可行性 | 标注需有效 Token |
| `available-coupons` | 当前可领券，识别「有券没领」省钱动作 | 同上 |
| `query-my-account` | 积分余额，识别即将过期积分 | 不显示积分部分 |
| `calculate-price` | 官方计价（含券与配送费），唯一可信价格来源 | 明确告知价格以官方渠道为准 |

**严禁**：编造菜品名称、实时价格、优惠活动、库存、营养数据。
没有 MCP 数据就不给该项建议。

## 信息来源标注规范

报告中每个补给块都必须区分三类信息：

- `[MCP]` — 来自麦当劳 MCP 的真实数据（附工具名）
- `[AI]` — 编译器隐喻、创意表达、推理
- 未验证 — MCP 调用失败，明确写出并指向官方渠道

## 合规要求（硬性）

1. 每次输出都要保留：**「非麦当劳官方开发者作品」** + **「数据来源：麦当劳中国官方 MCP Server」**
2. 运行状态评分必须标注：**「娱乐用途，不是医学或心理学评估」**
3. 餐品、价格、优惠、供应状态必须标注：**「以麦当劳官方渠道实时结果为准」**
4. 不得复制或使用麦当劳官方 Logo、商标、官方视觉素材。分享卡片只用像素字符装饰（🍔 🍟 🥤）和自制终端风格。
5. 不得暗示与麦当劳存在官方合作关系。
6. Token 只从环境变量读取，**绝不写入代码、日志、报告或提交到 GitHub**。
7. 不自动创建订单、不自动领券、不自动扣款。涉及交易的 Tool 一律只读。

## 触发语

- 「帮我编译一下今天的人生」
- 「今天加班好累，给我 Debug 一下」
- 「我只有 25 元，编译一份快乐」
- 「帮我生成今天的麦麦人生报告」
- 「今天 emo 了，吃点什么好」
- 「Bug 修完了，奖励自己一顿」
- 「今天状态怎么样，帮我看看」

## 演示建议

现场演示用这条，能同时触发加班 Bug、预算约束、快乐缺失三种元素：

> 今天加班到凌晨，修了十几个 Bug，明天还要开会，预算只有 30 元。

## 目录结构

```
mclife-compiler/
├── SKILL.md              本文件
├── scripts/
│   ├── mclife.mjs        CLI 主入口
│   ├── mcd-client.mjs    MCP Streamable HTTP 客户端
│   ├── life-parse.mjs    人生状态解析器
│   ├── compile-engine.mjs 编译引擎 + Bug 库
│   ├── mcd-resolver.mjs  麦麦依赖解析（MCP 调用）
│   └── report.mjs        三种报告渲染
├── references/
│   ├── bug-library.md    完整 Bug 类型库与触发规则
│   └── mcp-tools.md      MCP 工具清单与字段映射
└── assets/
    └── share-card-demo.html  分享卡片样式示例
```

## 参考文档

需要更深入的信息时再读取：

- `references/bug-library.md` — 全部 Bug 类型、触发条件、修复建议文案
- `references/mcp-tools.md` — MCP 工具参数、返回字段、错误码处理
