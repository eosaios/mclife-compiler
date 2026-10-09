# 参赛提交指南（踩坑记录）

本文件记录提交参赛申请时遇到的实际问题与正确做法，供后续提交参考。

---

## 一、官方审核机制（实测）

官方回复原文：

> 您的作品未通过审核，失败原因：您的 GitHub 项目无法访问，
> 您可以公开项目，或检查 issue 是否符合标准格式，并重新 issue。

关键词：**重新 issue** —— 官方允许且预期参赛者发现问题后重新提交。

官方另一条成功回复：

> 您的作品已成功参赛，您可以通过官方项目的 `RANKING.md` 查看排名

排行榜文件：https://github.com/M-China/mcd-developer-innovation-challenge/blob/main/RANKING.md

**实测审核时延**：提交 Issue → 收到自动回复约 **53 分钟**（21:06 提交，21:59 回复）。

---

## 二、第一次被拒的原因（Issue #109）

**不是仓库公开性问题。** 实测核查结果：

| 检查项 | 结果 |
|--------|------|
| `visibility` | `public` |
| `private` | `false` |
| 匿名访问 `https://github.com/eosaios/mclife-compiler` | HTTP 200 |
| 匿名访问 5 个必需文件（raw.githubusercontent.com） | 全部 HTTP 200 |

真实原因有两条：

### 原因 1：提交时机过早（主因）

时间线：

| 事件 | 北京时间 |
|------|----------|
| 仓库创建 | 21:05:10 |
| Issue 提交 | 21:06:35（仓库创建后仅 **85 秒**） |
| 官方自动审核 | 21:59:23 |

仓库在提交 Issue 时**刚创建 85 秒**，只有 1 个 commit、0 个 Star。
GitHub 对新仓库的页面渲染、raw 接口、搜索索引都有缓存延迟，
官方审核脚本在 21:59 抓取时很可能拿到 404 或空响应。

**教训：新仓库建好后至少等 30~60 分钟，让 GitHub 索引生效，再提 Issue。**

### 原因 2：Issue 正文超出官方示例格式（次因）

官方规定的格式只有 4 行：

```text
【参赛申请】
项目名称：{项目名称}
项目地址：{项目 GitHub 仓库地址}
项目简介：{项目简介}
```

第一次提交写了 **770 字**，包含：
- 6 个工具的列表（带 `·` 前缀）
- 多段换行
- 斜杠符号 `/`
- emoji

而**同一参赛者的成功案例**（#45 被拒 → #46 通过）显示：
被拒的 #45 **正文完全为空**，重新提交的 #46 正文与官方示例逐字对齐，无任何多余内容。

因此推断：官方审核脚本对正文做**严格格式匹配**，多余内容会导致解析失败。
官方 README 也明确提示：

> ⚠️ **重要：Issue 内容请勿超过 1000 字，且请勿携带图片等内容，以免报名失败。**

**教训：严格按官方示例格式写，4 行，不加任何修饰。**

---

## 三、正确的提交姿势

### 提交前自检清单

```bash
# 1. 确认公开
gh repo view <owner>/<repo> --json visibility,isPrivate
#    → visibility=PUBLIC, isPrivate=false

# 2. 匿名确认仓库页可访问（关键！不要用登录态测）
curl -s -o /dev/null -w "%{http_code}\n" https://github.com/<owner>/<repo>
#    → 200

# 3. 匿名确认所有必需文件可访问
for f in README.md CONTEST_DECLARATION.md MCP_INTEGRATION.md \
         mcp-config.example.json workbuddy.md; do
  printf "%-26s %s\n" "$f" \
    "$(curl -s -o /dev/null -w '%{http_code}' \
      https://raw.githubusercontent.com/<owner>/<repo>/main/$f)"
done
#    → 全部 200

# 4. 确认仓库已稳定（创建 > 1 小时，有多个 commit）
gh api repos/<owner>/<repo>/commits --jq 'length'
```

四项全绿再提交。

### Issue 正文模板（照抄，不要改）

```text
【参赛申请】
项目名称：你的项目名
项目地址：https://github.com/owner/repo
项目简介：一句话说清项目做什么
```

**要求**：
- 4 行，不多不少
- 不带 markdown 语法（无 `-`、`*`、`#`、`` ` ``）
- 不带 emoji
- 总字数 < 1000
- 简介控制在 1~2 句

### 命令

```bash
printf '【参赛申请】\n项目名称：%s\n项目地址：%s\n项目简介：%s\n' \
  "McLife Compiler · 麦麦人生编译器" \
  "https://github.com/eosaios/mclife-compiler" \
  "把人生状态当代码编译，生成Bug清单和麦麦补给方案，基于麦当劳官方MCP真实数据。" \
  > /tmp/apply.txt

gh issue create \
  --repo M-China/mcd-developer-innovation-challenge \
  --title "【参赛申请】McLife Compiler · 麦麦人生编译器" \
  --body-file /tmp/apply.txt
```

---

## 四、时间节点

| 事项 | 北京时间 |
|------|----------|
| 活动开始 | 2026-10-09 10:30 |
| 报名截止 | **2026-10-25 23:59** |
| 排行榜数据截止 | 2026-10-26 00:00 |
| 获奖信息提交截止 | 2026-11-14 |

**排名依据**：GitHub 公开 Star 数。**Star = 0 不进排行榜**，前 100 名进榜。