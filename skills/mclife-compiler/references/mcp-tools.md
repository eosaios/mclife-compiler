# 麦当劳中国官方 MCP Server 工具参考

**服务端点**：`https://mcp.mcd.cn`（根路径，非 `/mcp`）
**开放平台**：https://open.mcd.cn/mcp
**官方仓库**：https://github.com/M-China/mcd-mcp-server
**协议**：MCP Streamable HTTP
**限流**：每 Token 每分钟 600 次，超出返回 429

## 接入格式

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

必需请求头：
- `Content-Type: application/json`
- `Accept: application/json, text/event-stream`
- `Authorization: Bearer <MCP_TOKEN>`

服务端可能在 `initialize` 响应头返回 `Mcp-Session-Id`，后续请求需回带。
响应可能是 JSON，也可能是 SSE 帧（`text/event-stream`），客户端两种都要能解析。

## 本项目实际使用的工具

### 1. `now-time-info` — 当前时间信息

**为什么不可替代**：时段判定（早餐/午餐/下午茶/晚餐/夜宵）直接决定推荐哪类组合。
用服务端权威时间可避免客户端时钟偏差导致的错误推荐。

**入参**：无

**返回字段（宽松匹配）**：`hour` / `currentHour` / `time` / `currentTime` / `date` / `weekday`

**归一化时段**：

| 小时 | timeOfDay |
|------|-----------|
| 5–9 | `BREAKFAST` |
| 10–13 | `LUNCH` |
| 14–16 | `SNACK` |
| 17–21 | `DINNER` |
| 22–4 | `LATE_NIGHT` |

时段还会回写进饮食偏好（`BREAKFAST` / `LATE_NIGHT`）。

### 2. `list-nutrition-foods` — 餐品营养信息列表

**为什么不可替代**：这是唯一的真实营养数据来源。推荐组合的能量、蛋白质数值
全部来自该工具，本项目**不内置任何营养数据表**。

**入参**：无

**使用字段**：能量、蛋白质、脂肪、碳水化合物、钠

**推荐算法**（`pickNutritionPlan`）：

```
目标能量 = 320 + 疲劳度 × 45 + 饥饿度 × 30
每条目得分 = 能量密度 × 0.65 + 蛋白密度 × 0.35
偏好加权（仅在真实存在的条目里加权，绝不新增条目）：
  CHICKEN +0.18 / BEEF +0.18 / SPICY +0.12
  NO_SPICY −0.15（命中含"辣"的条目）
  VEG|LIGHT +0.15（沙拉/蔬菜/玉米/茶）
  FRIES +0.10
取 top-3，汇总能量与蛋白，计算与目标值的缺口
```

**降级**：返回空或失败时，不做任何营养推荐，报告标注未验证。

### 3. `campaign-calendar` — 活动日历

**为什么不可替代**：把「HAPPINESS_NOT_FOUND」锚定到**真实在售活动**上，
避免编造活动名称。

**使用字段**：活动名称、描述、开始/结束时间

**降级**：失败时不推荐活动。

### 4. `query-my-coupons` — 我的优惠券

**为什么不可替代**：判断用户预算是否可行的唯一依据。本项目按
**券使用门槛 ≤ 用户预算** 过滤，避免推荐用不上的券。

**使用字段**：券名称、面额/优惠金额、使用门槛、状态、有效期

### 5. `available-coupons` — 麦麦省可领券

**为什么不可替代**：识别「有券可用但用户还没领」这一真实省钱动作 ——
这是普通套餐推荐助手不会做的事。

### 6. `query-my-account` — 我的积分

**为什么不可替代**：识别即将过期积分，这是最容易白白浪费的资产。

**使用字段**：可用积分、累计积分、即将过期积分

### 7. `calculate-price` — 商品价格计算

**为什么不可替代**：官方计价，含优惠券抵扣与配送费，是**唯一可信的价格来源**。

**前置条件**：需先确定门店与具体商品。本项目默认不自动调用（避免误触发下单流程），
在报告中说明「未执行 calculate-price，价格以官方 App/小程序为准」。

### 8. `query-meals` — 门店在售餐品

需先有门店信息（`query-nearby-stores` / `delivery-query-stores`）。
本项目作为可选增强保留在 `TOOLS_USED` 中。

## 未使用的工具及原因

以下工具涉及**交易或账户写操作**，本项目一律不调用：

| Tool | 不调用的原因 |
|------|--------------|
| `create-order` / `mall-create-order` / `party-order-create` | 会产生真实订单与扣款 |
| `auto-bind-coupons` | 会自动领取优惠券，改变用户账户状态 |
| `draw-lottery` | 会消耗积分 |
| `cancel-order` | 修改已有订单 |
| `delivery-create-address` | 会写入用户地址 |
| `mall-order-create` | 同下单 |

**设计原则**：本项目只读。任何需要用户确认的写操作都不自动执行。

## 错误码处理

| HTTP | MCP code | 本项目处理 |
|------|----------|------------|
| 401 | `UNAUTHORIZED` | 提示重新申请 Token，不重试 |
| 429 | `RATE_LIMIT` | 提示降低频率，等待后重试 |
| — | `NO_TOKEN` | 降级为离线编译，报告顶部标注 |
| — | `TIMEOUT` | 默认 30s 超时，可通过 `--timeout` 调整 |
| — | `NETWORK` | 降级为离线编译 |
| — | `RPC_ERROR` | 记录到 `mcpTrace`，该维度不推荐 |

所有错误通过 `safeCall()` 包装成 `{ok:false, error:{code,message}}`，
**不抛裸异常**，保证单个工具失败不会中断整个编译流程。

## Token 安全

- 只从环境变量读取：`MCD_MCP_TOKEN` / `MCD_MCP_SERVER_TOKEN` / `MCP_TOKEN` / `MCD_TOKEN`
- 从不写入源码、日志、报告、Git
- `mcp-config.example.json` 只含 `${MCD_MCP_TOKEN}` 占位符
- 客户端日志只输出「已配置 / 未配置」，**绝不打印 Token 值**
