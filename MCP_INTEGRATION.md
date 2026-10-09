# MCP_INTEGRATION.md

本文件说明 McLife Compiler 实际使用的麦当劳中国官方 MCP Server、Tool、调用流程与业务价值。

- **服务端点**：`https://mcp.mcd.cn`
- **开放平台**：https://open.mcd.cn/mcp
- **官方文档仓库**：https://github.com/M-China/mcd-mcp-server
- **协议**：MCP Streamable HTTP
- **鉴权**：请求头 `Authorization: Bearer <MCP_TOKEN>`
- **限流**：每 Token 每分钟 600 次，超出返回 HTTP 429

## 一、为什么这个项目必须用真实 MCP

一个普通的「麦当劳套餐推荐助手」只需要一份静态菜单就够了。
但 McLife Compiler 的核心承诺是**不编造任何实时信息**——实时价格、可用优惠、
营养数据、当月活动都必须来自麦当劳官方 MCP。

因此本项目**不内置任何菜单数据、价格表、营养表或活动信息**。
所有餐品相关结论都是运行时从 MCP 拉取的实时数据。MCP 不可用时，
项目会显式降级并标注「未验证」，而不是回退到硬编码的假数据。

这构成了 MCP 在本项目中的**不可替代业务价值**：
去掉 MCP，这个项目只剩一个会说话的编译器皮肤；有了 MCP，它才能给出可信的补给建议。

## 二、实际使用的 Tool

本项目调用以下 8 个官方 Tool。

### 2.1 `now-time-info` — 获取当前时间信息

| 项 | 说明 |
|----|------|
| 入参 | 无 |
| 使用返回字段 | `hour` / `currentHour` / `time` / `currentTime` / `date` / `weekday` |
| 调用时机 | 编译流程第 1 步，先于所有推荐逻辑 |
| 频次 | 每次编译 1 次 |

**业务价值**：时段（早餐/午餐/下午茶/晚餐/夜宵）直接决定推荐哪类组合。
例如深夜 23 点与上午 8 点应给出完全不同的建议。使用**服务端权威时间**
而非客户端本地时间，可避免用户设备时间不准导致的错误推荐。

代码位置：`scripts/mcd-resolver.mjs` → `normalizeTimeInfo()`

### 2.2 `list-nutrition-foods` — 餐品营养信息列表

| 项 | 说明 |
|----|------|
| 入参 | 无 |
| 使用返回字段 | 能量、蛋白质、脂肪、碳水化合物、钠 |
| 调用时机 | 时段判定之后 |
| 频次 | 每次编译 1 次 |

**业务价值**：这是项目**唯一**的营养数据来源。本项目不内置营养表。

推荐算法：

```
目标能量(kcal) = 320 + 疲劳度 × 45 + 饥饿度 × 30

对每条真实餐品打分：
  基础分 = 能量密度 × 0.65 + 蛋白密度 × 0.35
  偏好加权（只在真实存在的条目里加权，绝不新增条目）：
    CHICKEN  +0.18    BEEF    +0.18
    SPICY    +0.12    NO_SPICY −0.15（命中含"辣"的条目时）
    VEG|LIGHT +0.15   FRIES   +0.10

取 Top-3，汇总能量/蛋白/脂肪/钠，计算与目标能量的缺口 gap
```

举例：用户「加班到凌晨，饿死了」→ 疲劳度 9、饥饿度 9
→ 目标能量 = 320 + 405 + 270 = **995 kcal**，报告会明确指出所选组合的缺口。

**降级行为**：Tool 返回空或失败时，报告的「主食组合」块直接标注
「营养数据不可用，本次不做营养维度推荐」，**不推荐任何具体餐品**。

代码位置：`scripts/mcd-resolver.mjs` → `pickNutritionPlan()`

### 2.3 `campaign-calendar` — 活动日历查询

| 项 | 说明 |
|----|------|
| 入参 | 无 |
| 使用返回字段 | 活动名称、描述、开始/结束时间 |
| 业务价值 | 把「快乐依赖缺失」锚定到**当月真实在售活动** |

**业务价值**：`HAPPINESS_NOT_FOUND` 这个 Bug 的修复方案需要一个真实落点。
普通助手会说「去吃个汉堡吧」，本项目会给出当月麦当劳官方活动中的真实选项，
让「注入快乐依赖」这个编译器隐喻有真实数据支撑。

**降级行为**：失败时不推荐任何活动，不编造活动名称。

### 2.4 `query-my-coupons` — 我的优惠券查询

| 项 | 说明 |
|----|------|
| 使用返回字段 | 券名称、面额/优惠金额、使用门槛、状态、有效期 |
| 业务价值 | 判断预算可行性的唯一依据 |

**业务价值**：本项目按**券使用门槛 ≤ 用户预算**过滤，
避免推荐「有券但用不上」的无意义信息。这需要读取用户真实账户，
静态菜单数据无法做到。

**降级行为**：401 时明确提示 Token 无效；其他失败时标注需有效 Token。

### 2.5 `available-coupons` — 麦麦省券列表查询

| 项 | 说明 |
|----|------|
| 使用返回字段 | 券名称、面额、门槛、有效期 |
| 业务价值 | 识别「有券可用但用户还没领」这一真实省钱动作 |

**业务价值**：这是本项目区别于普通推荐助手的关键一点 ——
不只是告诉用户「你可以点这些」，而是告诉用户「**先去领这张券，能省 X**」。
这个能力必须查询用户账户的实时可领券列表。

### 2.6 `query-my-account` — 我的积分查询

| 项 | 说明 |
|----|------|
| 使用返回字段 | 可用积分、累计积分、即将过期积分 |
| 业务价值 | 识别即将过期积分 |

**业务价值**：过期积分是最容易被白白浪费的资产。检测到即将过期积分时，
报告会单独提示「注意使用」。本项目**不会自动兑换**。

### 2.7 `calculate-price` — 商品价格计算

| 项 | 说明 |
|----|------|
| 前置条件 | 需先确定门店与具体商品 |
| 使用返回字段 | 商品金额、优惠金额、配送费、应付总价 |
| 业务价值 | **唯一可信的价格来源** |

**为什么默认不调用**：该 Tool 需要门店与明确商品列表，完整调用链会拉长
（需要 `query-nearby-stores` → `query-meals` → 组装商品 → `calculate-price`）。
本项目定位是「编译诊断报告」而非「点单助手」，因此默认不执行，
在报告中明确说明「未执行 calculate-price，价格以官方 App/小程序为准」。

**这是刻意的设计选择**：与其给一个基于不完整上下文的估算价格，
不如明确说明价格需官方渠道确认。代码中已保留该 Tool 的接入位置，
用户若要扩展点单能力可直接启用。

### 2.8 `query-meals` — 门店在售餐品列表

保留在 `TOOLS_USED` 常量中作为可选增强。需先通过
`query-nearby-stores` 或 `delivery-query-stores` 获取门店。

## 三、明确不调用的 Tool（安全边界）

以下 Tool 会产生**真实交易或账户写操作**，本项目一律不调用：

| Tool | 副作用 | 不调用的原因 |
|------|--------|--------------|
| `create-order` | 创建订单 | 会产生真实订单 |
| `mall-create-order` | 积分兑换下单 | 会扣减积分 |
| `party-order-create` | 主题活动下单 | 会产生真实订单 |
| `auto-bind-coupons` | 自动领券 | 会改变账户状态 |
| `draw-lottery` | 积分抽奖 | 会消耗积分 |
| `cancel-order` | 取消订单 | 修改已有订单 |
| `delivery-create-address` | 新增地址 | 写入用户数据 |
| `mall-order-list` 等查询类 | 只读 | 可用但非必需 |

**设计原则：本项目只读。** 任何需要用户确认的写操作都不自动执行。

## 四、完整调用流程

```
用户自然语言输入
      │
      ▼
[本地] 人生代码解析器 (life-parse.mjs)
      │  提取：情绪 / 疲劳 / 饥饿 / 预算 / 偏好 / 情景
      ▼
[MCP] ① now-time-info ────────────► 服务端权威时间
      │                              → 判定时段 → 回写早餐/夜宵偏好
      ▼
[MCP] ② list-nutrition-foods ─────► 真实营养数据（N 条）
      │                              → 按疲劳/饥饿算目标能量
      │                              → 偏好加权 → Top-3 组合 + 缺口
      ▼
[MCP] ③ campaign-calendar ────────► 当月真实活动
      │                              → 修复 HAPPINESS_NOT_FOUND
      ▼
[MCP] ④ query-my-coupons ─────────► 账户持有券
      │                              → 按门槛 ≤ 预算过滤
      ▼
[MCP] ⑤ available-coupons ────────► 当前可领券
      │                              → 识别「有券没领」省钱动作
      ▼
[MCP] ⑥ query-my-account ──────────► 积分余额
      │                              → 提示即将过期积分
      ▼
[本地] 编译引擎 (compile-engine.mjs)
      │  Bug 检测 → 运行状态评分 → 生成编译日志
      ▼
[本地] 方案组装 (buildPlan)
      │  逐块标注 [MCP] 来源 / [AI] 创意 / 未验证
      ▼
[本地] 报告渲染 (report.mjs)
         终端日志 / Markdown / 分享卡片 HTML
```

每次编译最多 **6 次** MCP 调用，远低于官方 600 次/分钟的限流。

## 五、客户端实现

`scripts/mcd-client.mjs` 是一个零依赖的 Streamable HTTP 客户端。

### 协议实现要点

1. **双 Accept 头**：`application/json, text/event-stream`
2. **Session 管理**：捕获 `initialize` 响应头中的 `Mcp-Session-Id`，后续请求回带
3. **双格式响应解析**：服务端可能返回 JSON，也可能返回 SSE 帧（`data: {...}`），
   客户端解析 SSE 分块并按 `id` 匹配 JSON-RPC 响应
4. **生命周期**：`initialize` → `notifications/initialized` → `tools/list` / `tools/call`
5. **宽松字段匹配**：官方返回字段名可能随版本变化，
   `pick()` / `toArray()` 对多种命名做了兼容处理

### 错误处理

所有调用通过 `safeCall()` 包装为 `{ok:true, data}` 或
`{ok:false, error:{code, message}}`，**不抛裸异常**。
单个 Tool 失败不会中断编译流程，对应维度降级并在报告中标注。

| 情况 | code | 处理 |
|------|------|------|
| 未配置 Token | `NO_TOKEN` | 离线编译，报告顶部标注 |
| Token 无效/过期 | `UNAUTHORIZED` | 提示重新申请，不重试 |
| 触发限流 | `RATE_LIMIT` | 提示降低频率 |
| 请求超时 | `TIMEOUT` | 默认 30s，对应维度降级 |
| 网络不可达 | `NETWORK` | 离线编译 |
| JSON-RPC 错误 | `RPC_ERROR` | 该维度不推荐，记录到 trace |

### Token 安全

- Token **只从环境变量读取**：`MCD_MCP_TOKEN` / `MCD_MCP_SERVER_TOKEN` / `MCP_TOKEN` / `MCD_TOKEN`
- **绝不**写入源码、日志、报告、Git
- `--check` 只输出「已配置 / 未配置」，**不打印 Token 值**
- `mcp-config.example.json` 只含 `${MCD_MCP_TOKEN}` 占位符

## 六、可验证性

用户可以自行验证本项目的 MCP 调用真实性：

```bash
# 1. 配置 Token
export MCD_MCP_TOKEN=你的Token

# 2. 探活，查看服务端真实信息与全部工具清单
node skills/mclife-compiler/scripts/mclife.mjs --check

# 3. 导出 MCP 真实返回的原始 JSON
node skills/mclife-compiler/scripts/mclife.mjs "今天加班到凌晨" --format json | less

# 4. 直接查看官方工具的完整 schema
node skills/mclife-compiler/scripts/mclife.mjs --tools
```

每份报告底部都有 **MCP 调用记录表**，逐条列出工具名、成功/失败、返回摘要。
失败项会被归入「未验证声明」，明确告知用户哪些结论缺少真实数据支撑。

## 七、官方参考

- MCP Server 仓库：https://github.com/M-China/mcd-mcp-server
- MCP 服务规则：https://cdn.mcd.cn/cms/pages/MCPServerRules.html
- 开放平台：https://open.mcd.cn/mcp

---

本项目为**非麦当劳官方开发者作品**，与麦当劳及其关联公司无任何官方合作关系。
麦当劳及 McDonald's 商标归其权利人所有。
