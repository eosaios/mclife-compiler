# 环境相关操作指引（需人工完成）

本文件列出 McLife Compiler 上手所需的**环境类操作**。这些步骤涉及手机号验证登录，
需要你本人或其他具备浏览器操作能力的 AI 完成。项目代码已全部就绪，配置完 Token 即可验证真实 MCP 调用。

---

## 一、申请麦当劳 MCP Token（必做）

### 操作步骤

1. 打开 https://open.mcd.cn/mcp
2. 点击右上角 **【登录】** 按钮
3. 跳转登录页，使用**手机号验证**登录
4. 登录成功返回首页，右上角「登录」变为 **【控制台】**
5. 点击「控制台」打开弹窗，点击 **【激活】** 按钮申请 MCP Token
6. 阅读并 **同意服务协议**
7. 申请成功后 **一键复制** Token

### 可直接交给其他 AI 的提示词

```
帮我申请麦当劳中国 MCP Server 的 Token。

背景：我要开发一个基于麦当劳 MCP 的参赛项目，需要一个可用的 MCP Token。

步骤：
1. 打开 https://open.mcd.cn/mcp
2. 右上角点【登录】，用手机号完成验证登录（我会提供验证码）
3. 登录后点右上角【控制台】
4. 点【激活】按钮，申请 MCP Token
5. 阅读并同意服务协议
6. 把申请到的 Token 原样输出给我

注意：
- Token 是敏感凭据，只输出一次，不要写入任何文件或代码仓库
- 如果遇到验证码/短信验证，停下来让我输入
```

---

## 二、在 WorkBuddy 中配置 MCP 连接器（必做）

### 操作步骤

1. 打开 WorkBuddy
2. 左侧边栏【专家·技能·连接器】→ 选中 **【连接器】** 页签
3. 右上角 **【自定义连接器】** → **【配置 MCP】**
4. 填入以下 JSON（**把 `YOUR_MCP_TOKEN` 替换为真实 Token**）：

```json
{
  "mcpServers": {
    "mcd-mcp": {
      "type": "streamablehttp",
      "url": "https://mcp.mcd.cn",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_TOKEN"
      }
    }
  }
}
```

5. 点击 **【保存】**
6. 回到【自定义连接器】，将 mcd-mcp **【启用】**

> ⚠️ 注意：端点是 `https://mcp.mcd.cn` **根路径**，不是 `/mcp`。填错会直接 404。

### 备选：命令行配置

也可以直接写入 `~/.workbuddy/mcp.json`：

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

写完后需要重启 WorkBuddy 或在连接器管理页右上角
「自定义连接器」入口点击**【信任】**才会生效。

---

## 三、验证连接是否成功

```bash
export MCD_MCP_TOKEN=你的Token

cd mclife-compiler

# 探活：打印服务端信息 + 全部可用工具
node skills/mclife-compiler/scripts/mclife.mjs --check
```

**期望输出**：

```
── McLife MCP 探活 ──
endpoint : https://mcp.mcd.cn
token    : 已配置 (MCD_MCP_TOKEN)
server   : ✅ {"name":"...","version":"..."}
tools    : ✅ 34 个

  list-nutrition-foods
    获取麦当劳常见餐品的营养成分数据...
  now-time-info
    返回当前的完整时间信息...
  ...
```

**失败排查**：

| 现象 | 原因 | 处理 |
|------|------|------|
| `token : ❌ 未配置` | 环境变量未设置 | `export MCD_MCP_TOKEN=xxx` |
| `UNAUTHORIZED` | Token 无效或过期 | 重新申请 |
| `404 Route Not Found` | 端点路径填错 | 用根路径，不要加 `/mcp` |
| `RATE_LIMIT` | 超过 600 次/分钟 | 降低频率，稍后重试 |
| `TIMEOUT` | 网络问题 | 检查网络代理 |

---

## 四、配置 Token 环境变量（持久化）

### macOS zsh（写入 ~/.zshrc）

```bash
echo 'export MCD_MCP_TOKEN=你的Token' >> ~/.zshrc
source ~/.zshrc
```

### 临时（仅当前终端）

```bash
export MCD_MCP_TOKEN=你的Token
```

> 🔒 **安全提醒**：
> - 不要把 Token 写进任何提交到 Git 的文件
> - 项目的 `.gitignore` 已屏蔽 `.env` 和 `mcp-config.json`
> - 项目代码只从环境变量读取 Token，**永不硬编码**
> - 如果 Token 泄露，立即到 https://open.mcd.cn/mcp 重新申请

---

## 五、真实 MCP 效果验证

配置完成后，跑一次真实编译：

```bash
node skills/mclife-compiler/scripts/mclife.mjs \
  "今天加班到凌晨，修了十几个 Bug，明天还要开会，预算只有 30 元。" \
  --format md --out real-report.md
```

打开 `real-report.md`，检查：

1. **编译日志**里 `[SUCCESS] mcp.xxx` 行 —— 证明工具真实调用成功
2. **主食组合** 里的能量/蛋白质数值 —— 应是 MCP 返回的真实营养数据
3. **预算与优惠** 里的券 —— 应是你账户里的真实优惠券
4. **快乐依赖** 里的活动 —— 应是当月真实活动
5. **MCP 调用记录** 表 —— 逐条列出每个工具的成功/失败
6. 报告底部**未验证声明** —— 失败的工具会在这里列出

### 对比演示（评审加分项）

```bash
# 有 Token：真实数据
MCD_MCP_TOKEN=你的Token node .../mclife.mjs "累死了" --format json

# 无 Token：优雅降级
env -u MCD_MCP_TOKEN node .../mclife.mjs "累死了" --format json
```

两次输出的差异就是本项目的核心主张：
**没有真实数据时，它会说「未验证」，而不是编一个价格出来。**

---

## 六、发布与推广（可选）

仓库已发布并完成报名。Star 数是排名依据，以下是合规的推广方式：

- ✅ 在掘金/CSDN/知乎/V2EX 发技术文章，介绍 MCP 集成思路
- ✅ 在 GitHub 主页写清项目价值，让访问者愿意点 Star
- ✅ 在自己的技术社区分享「生活状态编译器」这个概念
- ❌ 不要刷 Star（官方明确禁止，判定为作弊取消资格）
- ❌ 不要用多个账号重复报名

---

## 七、部署 Vue 分享卡片（可选）

核心 Skill 不依赖前端，以下仅用于生成分享链接：

```bash
cd web
npm install
npm run build     # 产物在 web/dist/
npm run dev       # 本地预览 http://localhost:5173
```

> 核心编译逻辑全部在 Node 侧运行，**MCP Token 绝不能出现在浏览器里**。
> Web 页面只负责渲染 JSON 结果 + 编译进度动画。

---

## 需要我做什么

如果你希望我代劳，把 Token 通过环境变量配置好，然后告诉我，我可以立刻：

1. 跑一次真实 MCP 编译，把真实返回的数据展示给你
2. 用真实数据重新生成一份示例报告，替换仓库里的示例
3. 验证 6 个 MCP 工具在真实 Token 下的完整返回字段
