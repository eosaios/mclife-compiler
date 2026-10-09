# workbuddy.md

本文件记录 McLife Compiler 项目在腾讯 WorkBuddy 中的真实开发对话上下文，
用于参与「麦当劳程序员创意开发大赛」的 WorkBuddy 专项奖励。

- **开发环境**：WorkBuddy（腾讯 AI Agent 智能体）
- **开发日期**：2026 年 10 月 9 日
- **开发者账号**：eosaios
- **项目地址**：https://github.com/eosaios/mclife-compiler

---

## 对话阶段一：MCP 能力调查（先查证，再动手）

**用户需求**：开发一个参加麦当劳创意开发大赛的原创开源项目，需要基于麦当劳中国官方 MCP Server。

**Agent 动作**：在写任何代码之前，先做能力调查。并行执行了三件事：

1. 抓取官方 MCP 仓库 https://github.com/M-China/mcd-mcp-server
2. 抓取参赛规则 https://github.com/M-China/mcd-developer-innovation-challenge/blob/main/activityGuidelines.md
3. 检查本地 WorkBuddy 连接器状态

**调查结论**：

- 本地 `list_installed_plugins` 返回的连接器中**没有 mcd-mcp**
- `~/.workbuddy/mcp.json` 中也没有 mcd-mcp 配置（只有一个已禁用的 lighthouse-ops）
- 官方 MCP Server 提供 **34 个工具**，覆盖麦乐送点餐、到店取餐、团餐、积分兑换、活动日历等场景
- 端点为 `https://mcp.mcd.cn`，Streamable HTTP 协议，需 `Authorization: Bearer <Token>`
- 限流 600 次/分钟；错误码 401（Token 无效）/ 429（限流）

**Agent 进一步验证**：直接用 curl 探测端点行为。

```bash
# 无 Token 时根路径返回 403（路由存在，仅缺鉴权）
curl -X POST https://mcp.mcd.cn -d '{...initialize...}'
# → HTTP 403 {"code":"0001","msg":"系统错误"}

# /mcp、/sse、/messages 等路径均返回 404
# → HTTP 404 {"error_msg":"404 Route Not Found"}
```

**关键发现**：官方文档写的是接入地址 `https://mcp.mcd.cn`，实测确认是**根路径**，
不是 `/mcp`。这个细节如果搞错，MCP 调用会直接 404。

---

## 对话阶段二：确定技术方案与安全边界

**用户要求**：
- 优先实现原生可安装的 WorkBuddy Skill，而非只做网页
- 真实 MCP 调用在主流程中必须具有不可替代的业务价值
- 不得虚构不存在的 MCP 工具、商品、价格、优惠或订单能力
- 不将 Token 写入源码、日志或 GitHub

**Agent 分析 34 个官方工具，按用途分成三类**：

**第一类 — 只读且高价值（选用）**：
- `now-time-info` 服务端权威时间
- `list-nutrition-foods` 真实营养数据
- `campaign-calendar` 当月真实活动
- `query-my-coupons` / `available-coupons` 券查询
- `query-my-account` 积分查询

**第二类 — 需前置上下文（保留但不默认调用）**：
- `calculate-price` 需先确定门店与商品，调用链过长
- `query-meals` 需先有门店

**第三类 — 有副作用（一律不调用）**：
- `create-order` / `cancel-order` / `mall-create-order` / `party-order-create` 下单类
- `auto-bind-coupons` 自动领券
- `draw-lottery` 抽奖扣积分
- `delivery-create-address` 写用户数据

**确定的设计原则**：

1. **不内置任何数据表** — 菜单、价格、营养、活动全部运行时从 MCP 拉
2. **严格只读** — 不下单、不领券、不扣款
3. **失败即标注，不回退假数据** — MCP 不可用时显示「未验证」

Agent 向用户说明了 Token 缺失的处理方式：Token 需要手机号登录申请，
Agent 无法代为完成，因此先实现完整功能，Token 由用户配置后即可验证真实 MCP 调用。

---

## 对话阶段三：架构设计与实现

**模块划分**（用户要求「把业务规则和输出格式组织成可维护的模块」）：

```
mcd-client.mjs      MCP 协议层 —— 零依赖 Streamable HTTP 客户端
life-parse.mjs      解析层 —— 自然语言 → LifeState
compile-engine.mjs  编译层 —— LifeState → Bug 清单 + 评分 + 日志
mcd-resolver.mjs    依赖层 —— 调用 MCP → 补给方案
report.mjs          渲染层 —— 终端 / Markdown / 分享卡片
mclife.mjs          CLI 主入口
```

**关键技术决策**：

**1. 手写 MCP 客户端而不引入 SDK**

理由：官方只提供配置示例，没有 npm SDK；手写实现让项目零依赖，
克隆下来就能跑，参赛评审体验最好。

实现要点：
- 双 Accept 头（`application/json, text/event-stream`）
- Session 管理：捕获 `initialize` 响应头的 `Mcp-Session-Id`，后续请求回带
- 双格式响应解析：服务端可能返回 JSON，也可能返回 SSE 帧
- 宽松字段匹配：官方返回字段名可能随版本变化，`pick()` 兼容多种命名

**2. 解析器采用可解释的词典 + 规则匹配**

不用 LLM 做状态抽取，而是用词典匹配 + 阈值规则。
每个字段都记录 `evidence`（命中了哪些原文关键词），报告里可解释「为什么判成这样」。
好处：可测试、可调试、无额外成本。

实现中发现并修正的两个真实问题：
- **疲劳度重复累加**：最初设计是所有命中的分数相加，
  导致「加班 加班 加班 通宵」得到 11 分。改为取最大值。
- **情绪未与疲劳联动**：说「加班到凌晨」时没有情绪词，情绪判为 NEUTRAL，
  但语义上明显是透支。加了保守推断：疲劳 ≥ 8 或深夜场景 → EXHAUSTED，
  并在 evidence 中标记 `inferred_from_fatigue_or_night_shift` 以示区分。

**3. Bug 库设计为可扩展字典**

`BUG_LIBRARY` 定义全部 Bug，新增 Bug 只需加一个条目 + 挂载到映射表或阈值规则，
不用改解析器和渲染器。

实现中补充了两条关联规则：
- `REQUIREMENT_RECURSION` → 追加 `HAPPINESS_NOT_FOUND`（需求反复变更会持续消耗愉悦感）
- `SLEEP_DEPENDENCY_STALE` → 追加 `HAPPINESS_NOT_FOUND`（睡眠依赖过期必然放大快乐缺失）

**4. 刻意保留 `HUNGRY_VALUE_UNDEFINED`**

用户没提饿不饿时，不追问，而是生成这个 Bug。
报告里显示「Hunger variable is undefined」——这是刻意的幽默设计，
也是本项目的记忆点之一。

**5. 安全渲染**

分享卡片是拼接的 HTML，所有用户可控内容都过 `escapeHtml()`。
单元测试中专门验证了 `<script>` 注入被转义。

---

## 对话阶段四：测试与 Bug 修复

Agent 编写了 46 项单元测试（`tests/test.mjs`），无需网络和 Token。

**测试过程中发现并修复的真实 bug**：

| # | 问题 | 根因 | 修复 |
|---|------|------|------|
| 1 | `SyntaxError: missing ) after template literal` | Markdown 渲染里反引号嵌套：`` M.push(`**输入**：`${rawInput}` `) `` | 改用字符串拼接 |
| 2 | 终端出现 `undefined[SUCCESS]` | `SEV_COLOR.green` 不存在，该对象只有 ERROR/WARN/INFO 键 | 改用 `C.green` |
| 3 | 日志出现 `BUILD BUILD FAILED` | `buildStatus` 值本身含 `BUILD ` 前缀，渲染层又加了一次 | `buildStatus` 不含前缀，统一由渲染层加 |
| 4 | 分数判定错误 | 修改 #3 时把 `buildStatus` 语义改成不含前缀 | 同步修正渲染层三处调用点 |

**测试断言本身的修正**（不是代码 bug，是测试写得不对）：

- 「终端报告不含 undefined」过严 —— 日志文案里合法出现
  `"BUDGET variable is undefined"`，这是故意写的文案。
  改为检测渲染层 bug 的特征模式 `/undefined\[/`
- 「Bug 库包含 5 个核心类型」少传了「饿死了」，没触发快乐缺失。
  补全输入后**真的暴露了一个逻辑缺口** → 促成上面的关联规则补充
- 「预算为 null 时不筛券」期望写反了。审查代码后确认
  `applicableCoupons` 返回空是**更安全**的行为（预算未知时无法判断券是否适用），
  保留代码，改测试期望

**最终结果**：46 项测试全部通过。

---

## 对话阶段五：Token 与环境相关操作

用户明确要求：环境相关操作（如登录、申请 Token）由用户委托其他 AI 或自行处理，
Agent 专注实现创意与核心逻辑。

Agent 交付的 Token 获取指引：

```
1. 打开 https://open.mcd.cn/mcp
2. 右上角「登录」→ 手机号验证
3. 登录后点右上角「控制台」
4. 点激活按钮，申请 MCP Token
5. 同意服务协议
6. 复制 Token
```

配置与验证：

```bash
export MCD_MCP_TOKEN=你的Token
node skills/mclife-compiler/scripts/mclife.mjs --check
```

Agent 已验证错误处理路径：使用伪造 Token 测试，
客户端正确识别并返回 `UNAUTHORIZED — MCP Token 无效或未配置`，
没有崩溃、没有重试风暴。

---

## 对话阶段六：参赛合规

Agent 从官方仓库下载 `CONTEST_DECLARATION.md` **原文**，
逐字复制，未做任何修改（符合参赛要求）。

必需文件清单核对：

| 文件 | 状态 |
|------|------|
| `README.md` | ✅ 创意价值 + 真实 MCP 集成 + 安装 + 使用示例 + 目标用户 + 演示说明 |
| `CONTEST_DECLARATION.md` | ✅ 官方原文逐字复制 |
| `MCP_INTEGRATION.md` | ✅ 6 个真实 Tool、完整调用流程图、业务价值、安全边界 |
| `mcp-config.example.json` | ✅ 仅 `${MCD_MCP_TOKEN}` 占位符 |
| `workbuddy.md` | ✅ 本文件 |
| 可运行源码 | ✅ 零依赖，`node tests/test.mjs` 与 `node scripts/mclife.mjs` 直接可跑 |

**合规检查**：

- ✅ 全仓库 Token 扫描：无泄漏（`grep` 验证）
- ✅ 每份报告都标注「非麦当劳官方开发者作品」
- ✅ 评分标注「娱乐用途，不是医学或心理学评估」
- ✅ 价格/优惠标注「以麦当劳官方渠道实时结果为准」
- ✅ 未使用麦当劳 Logo 或官方视觉素材（分享卡片用 🍔 🍟 🥤 字符 + 自制终端风格）
- ✅ `.gitignore` 屏蔽 `.env`、`mcp-config.json`
- ✅ 严格只读，不调用任何下单/领券/抽奖 Tool

---

## 对话阶段七：可选增强 —— Vue 3 分享卡片

按参赛要求，Web 页面为可选增强，不能替代 Skill 本体。

Agent 的决策：**先保证核心 Skill 可用，再做可视化**。

第一版分享卡片由 `report.mjs` 的 `renderShareCard()` 直接生成单文件 HTML ——
零依赖、零构建、可直接浏览器打开截图，覆盖了 90% 的分享需求。

Vue 3 + TypeScript + Vite 版本放在 `web/` 目录，
提供更流畅的编译进度动画和更好的移动端适配，
但**不影响 Skill 本体的独立可用性**。

---

## 项目最终形态

| 项 | 值 |
|----|----|
| 项目名称 | McLife Compiler · 麦麦人生编译器 |
| Slogan | 把人生的 Bug，编译成一顿麦当劳 |
| 形态 | 原生 WorkBuddy Skill + CLI |
| 运行时依赖 | 无（Node.js 标准库） |
| MCP 调用 | 6 个官方只读工具，每次编译最多 6 次 |
| 测试 | 46 项单元测试全绿 |
| 副作用 | 无，严格只读 |
| License | MIT |

**一句话总结这个项目的创意**：

> 别的 Skill 帮你点饭，McLife Compiler 帮你 debug。
> 它把「累」「饿」「没钱」「烦」翻译成 ERROR 和 WARN，
> 然后用麦当劳官方 MCP 的真实数据，把这些 Bug 编译成一顿具体的饭。
>
> 最重要的是 —— 它宁可告诉你「这段我查不到，别信我」，
> 也不会编一个价格出来。
