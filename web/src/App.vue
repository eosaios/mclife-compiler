<script setup lang="ts">
/**
 * McLife Compiler — 可视化分享卡片
 *
 * 设计取舍：
 *   核心编译逻辑（life-parse / compile-engine / mcd-resolver）全部在 Node 侧运行，
 *   因为 MCP Token 绝不能出现在浏览器里。本页面只负责「渲染 + 动画」。
 *
 * 使用方式：
 *   1. 在终端运行 `node scripts/mclife.mjs "你的状态" --format json`
 *   2. 把 JSON 粘贴到左侧输入框
 *   3. 点击「编译」，观看编译进度动画并生成分享卡片
 */
import { computed, ref } from 'vue'
import type { CompilePayload, Severity } from './types'

const raw = ref('')
const payload = ref<CompilePayload | null>(null)
const error = ref('')
const phase = ref(0) // 0=idle 1=compiling 2=done
const phaseText = ref('')

const COMPILE_PHASES = [
  'Loading Life Runtime...',
  'Parsing user input...',
  'Detecting life bugs...',
  'Resolving McDonald\'s resources...',
  'Linking happiness dependency...',
  'Recovery plan generated',
]

const demoPayload: CompilePayload = {
  input: '今天加班到凌晨，修了十几个 Bug，明天还要开会，预算只有 30 元。',
  state: {
    emotion: 'EXHAUSTED',
    fatigue: 8,
    hunger: null,
    budget: 30,
    prefs: [],
    scenario: 'OVERTIME_NIGHT',
    timeOfDay: 'LATE_NIGHT',
    timeInfoSource: 'mcp',
  },
  bugs: [
    { code: 'ENERGY_UNDERFLOW', severity: 'ERROR', title: '精力不足', message: 'Energy buffer underflow detected', fixHint: '补充高能量密度补给，避免空转' },
    { code: 'SLEEP_DEPENDENCY_STALE', severity: 'ERROR', title: '睡眠依赖过期', message: 'Sleep dependency is stale', fixHint: '优先补睡眠，短期靠食物托底' },
    { code: 'OVERTIME_OVERFLOW', severity: 'ERROR', title: '加班溢出', message: 'Workload exceeded recommended threshold', fixHint: '停止接单，先补能量再继续 build' },
    { code: 'REQUIREMENT_RECURSION', severity: 'WARN', title: '需求无限递归', message: 'Requirement recursion depth exceeded', fixHint: '把需求冻结，先完成当前 iteration' },
    { code: 'HAPPINESS_NOT_FOUND', severity: 'WARN', title: '快乐依赖缺失', message: 'Happiness dependency missing', fixHint: '注入一个即时愉悦因子' },
    { code: 'BUDGET_CONSTRAINT_ACTIVE', severity: 'INFO', title: '预算约束生效', message: 'Budget constraint active', fixHint: '优先使用可用优惠后再下单' },
  ],
  runtime: {
    score: 21,
    buildStatus: 'FAILED — recoverable',
    dimensions: [
      { key: 'ENERGY', label: '能量水位', value: 20, weight: 1 },
      { key: 'MOOD', label: '情绪稳定度', value: 22, weight: 1 },
    ],
    disclaimer: '运行状态评分为娱乐用途，不是医学或心理学评估。',
  },
  summary: '人生不一定能一次编译通过，但快乐可以持续集成。',
  plan: [
    {
      slot: '主食组合',
      title: '高能量密度组合（真实营养数据驱动）',
      lines: ['目标能量约 995 kcal，该组合提供 720 kcal', '蛋白质 32g，有助于饱腹感'],
      mcpSource: ['mcd-mcp::list-nutrition-foods'],
      why: '用能量缺口解释「为什么现在该吃这个」，是本项目的创意表达部分。',
      creative: '把生理信号翻译成工程指标。',
    },
    {
      slot: '预算与优惠',
      title: '预算 ¥30',
      lines: ['账户内有 2 张券的使用门槛不高于 ¥30'],
      mcpSource: ['mcd-mcp::query-my-coupons', 'mcd-mcp::available-coupons'],
      why: '按券门槛过滤，避免推荐用不上的券。',
    },
  ],
  mcpTrace: [
    { tool: 'now-time-info', ok: true, summary: 'LATE_NIGHT @23:00' },
    { tool: 'list-nutrition-foods', ok: true, summary: '48 条真实营养数据' },
    { tool: 'query-my-coupons', ok: true, summary: '3 张可用券' },
  ],
  failed: [],
  toolsUsed: [],
  disclaimer: '运行状态评分为娱乐用途，不是医学或心理学评估；餐品信息、价格、优惠与供应状态以麦当劳官方渠道实时结果为准。',
}

const scoreClass = computed(() => {
  const s = payload.value?.runtime.score ?? 0
  return s >= 75 ? 'ok' : s >= 55 ? 'warn' : 'fail'
})

const emotionLabel = computed(() => {
  const map: Record<string, string> = {
    EXHAUSTED: '电量见底', STRESSED: '压力负载高', BURNED_OUT: '燃尽待重启',
    HAPPY: '运行良好', SAD: '情绪低落', ANGRY: '错误风暴', NEUTRAL: '平稳运行',
  }
  return map[payload.value?.state.emotion ?? ''] ?? '平稳运行'
})

const sevIcon = (s: Severity) => ({ ERROR: '✖', WARN: '⚠', INFO: 'ℹ' }[s])

function loadDemo() {
  raw.value = JSON.stringify(demoPayload, null, 2)
  error.value = ''
}

function compile() {
  error.value = ''
  if (!raw.value.trim()) {
    error.value = '请先粘贴 JSON，或点击「加载示例」'
    return
  }
  let parsed: CompilePayload
  try {
    parsed = JSON.parse(raw.value)
  } catch (e) {
    error.value = `JSON 解析失败：${(e as Error).message}`
    return
  }
  if (!parsed.bugs || !parsed.runtime) {
    error.value = 'JSON 缺少 bugs 或 runtime 字段，请确认是 --format json 的完整输出'
    return
  }
  payload.value = parsed
  phase.value = 1
  phaseText.value = ''
  let i = 0
  const timer = setInterval(() => {
    phaseText.value = COMPILE_PHASES[i] ?? ''
    i++
    if (i > COMPILE_PHASES.length) {
      clearInterval(timer)
      phase.value = 2
    }
  }, 380)
}
</script>

<template>
  <div class="page">
    <!-- 输入面板 -->
    <section class="panel">
      <h1 class="brand">
        <span class="logo">🍔</span>
        McLife Compiler
        <small>麦麦人生编译器 · 可视化分享卡片</small>
      </h1>

      <p class="hint">
        核心编译在 Node 侧完成（MCP Token 不能进浏览器）。
        先运行 <code>node scripts/mclife.mjs "你的状态" --format json</code>，
        把 JSON 粘贴到这里渲染卡片。
      </p>

      <textarea
        v-model="raw"
        class="json-input"
        placeholder='粘贴 --format json 的输出，例如：{ "input": "...", "bugs": [...], "runtime": {...} }'
        spellcheck="false"
      />

      <div class="actions">
        <button class="btn primary" @click="compile">▶ 编译</button>
        <button class="btn" @click="loadDemo">加载示例</button>
      </div>

      <p v-if="error" class="error">{{ error }}</p>

      <p class="note">
        非麦当劳官方开发者作品 · 数据来源：麦当劳中国官方 MCP Server<br />
        价格、优惠与供应状态以官方渠道实时结果为准
      </p>
    </section>

    <!-- 输出面板 -->
    <section class="panel output">
      <div v-if="phase === 1" class="compiling">
        <pre class="term">{{ phaseText }}</pre>
        <div class="dots"><span></span><span></span><span></span></div>
      </div>

      <div v-else-if="!payload" class="empty">
        <div class="empty-art">🍔 🍟 🥤</div>
        <p>等待编译输入</p>
      </div>

      <div v-else class="card">
        <div class="titlebar">
          <span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>
          <span class="tb-name">mclife — build life</span>
        </div>

        <div class="hero">
          <div class="kicker">McLife Compiler · 人生编译报告</div>
          <div class="status" :class="scoreClass">BUILD {{ payload.runtime.buildStatus }}</div>
          <div class="score-row">
            <b>{{ payload.runtime.score }}</b>
            <span>/ 100 · 运行状态评分（娱乐用途）</span>
          </div>
          <div class="meter" :class="scoreClass"><i :style="{ width: payload.runtime.score + '%' }"></i></div>
        </div>

        <div class="stats">
          <div class="stat"><i>ENERGY</i><b>{{ 10 - (payload.state.fatigue ?? 3) }}/10</b></div>
          <div class="stat"><i>MOOD</i><b>{{ emotionLabel }}</b></div>
          <div class="stat"><i>HUNGER</i><b>{{ payload.state.hunger ?? 'UNKNOWN' }}</b></div>
          <div class="stat"><i>BUDGET</i><b>{{ payload.state.budget != null ? '¥' + payload.state.budget : 'DEFAULT' }}</b></div>
        </div>

        <div class="content">
          <p class="sec">Bug 清单 ({{ payload.bugs.length }})</p>
          <ul class="bugs">
            <li v-for="(b, i) in payload.bugs" :key="b.code" class="bug" :class="'bug-' + b.severity">
              <span class="bidx">{{ String(i + 1).padStart(2, '0') }}</span>
              <span class="bicon">{{ sevIcon(b.severity) }}</span>
              <span class="bcode">{{ b.code }}</span>
              <span class="btitle">{{ b.title }}</span>
              <span class="badge">{{ b.severity }}</span>
            </li>
          </ul>

          <template v-if="payload.plan?.length">
            <p class="sec">麦麦补给方案</p>
            <section v-for="b in payload.plan" :key="b.slot" class="block">
              <h3>{{ b.slot }}<small>{{ b.title }}</small></h3>
              <ul><li v-for="(l, i) in b.lines" :key="i">{{ l }}</li></ul>
              <p v-if="b.mcpSource?.length" class="src">[MCP] {{ b.mcpSource.join(', ') }}</p>
            </section>
          </template>

          <p v-if="payload.failed?.length" class="unverified">
            ⚠ 未验证：{{ payload.failed.join(', ') }} —— 上述结论缺少真实数据支撑，请以官方渠道为准
          </p>

          <div class="art">🍔 🍟 🥤</div>
          <p class="summary">{{ payload.summary }}</p>
        </div>

        <div class="footer">
          {{ payload.disclaimer }}<br />
          <b>非麦当劳官方开发者作品</b> · 实时价格与优惠以官方渠道为准
        </div>
      </div>
    </section>
  </div>
</template>

<style>
:root {
  --bg: #0b0f0c; --panel: #101613; --line: #1e2a23;
  --green: #35d07f; --yellow: #f5c542; --red: #ff5c5c; --cyan: #57c7ff;
  --text: #d7e5db; --dim: #6b8074;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: var(--bg); color: var(--text);
  font-family: 'SF Mono','JetBrains Mono',Menlo,Consolas,monospace;
  line-height: 1.6; min-height: 100vh;
}
.page {
  display: grid; grid-template-columns: 1fr 1fr; gap: 20px;
  max-width: 1400px; margin: 0 auto; padding: 24px 16px 48px;
}
.panel { min-width: 0; }
.brand { font-size: 20px; color: var(--green); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.brand .logo { font-size: 24px; }
.brand small { display: block; width: 100%; color: var(--dim); font-size: 11px; font-weight: 400; margin-top: 4px; }
.hint { color: var(--dim); font-size: 12px; margin: 14px 0; }
.hint code { color: var(--cyan); background: #0d120f; padding: 1px 5px; border-radius: 2px; }
.json-input {
  width: 100%; height: 260px; background: #0d120f; color: var(--text);
  border: 1px solid var(--line); border-radius: 4px; padding: 12px;
  font-family: inherit; font-size: 12px; resize: vertical;
}
.json-input:focus { outline: none; border-color: var(--green); }
.actions { display: flex; gap: 10px; margin-top: 12px; }
.btn {
  background: #0d120f; color: var(--text); border: 1px solid var(--line);
  padding: 8px 18px; border-radius: 3px; cursor: pointer; font-family: inherit; font-size: 13px;
}
.btn:hover { border-color: var(--green); }
.btn.primary { background: var(--green); color: #0b0f0c; border-color: var(--green); font-weight: 700; }
.error { color: var(--red); font-size: 12px; margin-top: 10px; }
.note { color: var(--dim); font-size: 10px; margin-top: 20px; line-height: 1.8; }

.empty, .compiling { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 60vh; color: var(--dim); }
.empty-art { font-size: 44px; margin-bottom: 12px; }
.term { color: var(--green); font-size: 13px; height: 20px; }
.dots span { display: inline-block; width: 6px; height: 6px; margin: 0 3px; background: var(--green); border-radius: 50%; animation: blink 1.2s infinite; }
.dots span:nth-child(2) { animation-delay: .2s; }
.dots span:nth-child(3) { animation-delay: .4s; }
@keyframes blink { 0%,60%,100% { opacity: .25 } 30% { opacity: 1 } }

.card { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,.5); }
.titlebar { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: #0d120f; border-bottom: 1px solid var(--line); font-size: 12px; color: var(--dim); }
.dot { width: 11px; height: 11px; border-radius: 50%; }
.dot.r{background:#ff5f56}.dot.y{background:#ffbd2e}.dot.g{background:#27c93f}
.tb-name { margin-left: 6px; color: var(--text); }
.hero { padding: 22px 18px 18px; border-bottom: 1px dashed var(--line); }
.kicker { color: var(--dim); font-size: 11px; letter-spacing: 2px; text-transform: uppercase; }
.status { font-size: 20px; font-weight: 700; margin: 10px 0 6px; }
.status.ok{color:var(--green)}.status.warn{color:var(--yellow)}.status.fail{color:var(--red)}
.score-row { display: flex; align-items: baseline; gap: 8px; }
.score-row b { font-size: 40px; color: var(--green); line-height: 1; }
.score-row span { color: var(--dim); font-size: 12px; }
.meter { height: 8px; background: #0a0e0b; border: 1px solid var(--line); border-radius: 2px; margin-top: 12px; overflow: hidden; }
.meter i { display: block; height: 100%; animation: fill 1.1s ease-out; background: linear-gradient(90deg,var(--green),#9be86e); }
.meter.warn i { background: linear-gradient(90deg,var(--yellow),#ffd97a); }
.meter.fail i { background: linear-gradient(90deg,var(--red),#ff9c6b); }
@keyframes fill { from { width: 0 } }
.stats { display: grid; grid-template-columns: repeat(4,1fr); gap: 1px; background: var(--line); border-bottom: 1px solid var(--line); }
.stat { background: var(--panel); padding: 12px 8px; text-align: center; }
.stat i { display: block; font-style: normal; font-size: 10px; color: var(--dim); margin-bottom: 6px; }
.stat b { font-size: 14px; }
.content { padding: 16px 18px 20px; }
.sec { color: var(--dim); font-size: 11px; letter-spacing: 2px; margin: 0 0 10px; text-transform: uppercase; }
.sec:not(:first-child) { margin-top: 20px; }
.bugs { list-style: none; display: flex; flex-direction: column; gap: 6px; }
.bug { display: flex; align-items: center; gap: 7px; padding: 8px 10px; background: #0d120f; border-left: 3px solid var(--line); border-radius: 2px; flex-wrap: wrap; }
.bug-ERROR{border-left-color:var(--red)}.bug-WARN{border-left-color:var(--yellow)}.bug-INFO{border-left-color:var(--cyan)}
.bidx { color: var(--dim); font-size: 11px; }
.bicon { font-size: 11px; }
.bcode { font-size: 12px; font-weight: 600; }
.btitle { color: var(--dim); font-size: 11px; }
.badge { margin-left: auto; font-size: 10px; padding: 1px 6px; border-radius: 2px; border: 1px solid currentColor; }
.bug-ERROR .badge{color:var(--red)}.bug-WARN .badge{color:var(--yellow)}.bug-INFO .badge{color:var(--cyan)}
.block { margin-bottom: 12px; padding: 12px; background: #0d120f; border: 1px solid var(--line); border-radius: 3px; }
.block h3 { font-size: 12px; color: var(--green); margin-bottom: 8px; display: flex; flex-direction: column; gap: 2px; }
.block h3 small { color: var(--dim); font-weight: 400; font-size: 10px; }
.block ul { list-style: none; }
.block li { font-size: 12px; padding: 2px 0 2px 12px; position: relative; }
.block li::before { content: '▸'; position: absolute; left: 0; color: var(--dim); }
.src { margin-top: 8px; font-size: 10px; color: var(--cyan); }
.unverified { margin-top: 14px; padding: 10px; border: 1px dashed var(--yellow); border-radius: 3px; color: var(--yellow); font-size: 11px; }
.art { text-align: center; padding: 16px 0 8px; font-size: 36px; letter-spacing: 4px; }
.summary { margin: 12px 0 0; padding: 14px; border: 1px dashed var(--green); border-radius: 3px; color: var(--green); text-align: center; font-size: 14px; }
.footer { padding: 14px 18px 18px; border-top: 1px solid var(--line); color: var(--dim); font-size: 10px; text-align: center; }
.footer b { color: var(--yellow); }

@media (max-width: 980px) {
  .page { grid-template-columns: 1fr; }
  .empty, .compiling { min-height: 30vh; }
}
@media (max-width: 420px) {
  .stats { grid-template-columns: repeat(2,1fr); }
  .score-row b { font-size: 32px; }
}
</style>
