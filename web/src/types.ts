/**
 * types.ts — 与 Skill 核心引擎共享的数据结构
 * 字段与 skills/mclife-compiler/scripts/mclife.mjs --format json 的输出保持一致。
 */

export type Severity = 'ERROR' | 'WARN' | 'INFO'

export interface Bug {
  code: string
  severity: Severity
  title: string
  message: string
  fixHint: string
}

export interface RuntimeDimension {
  key: string
  label: string
  value: number
  weight: number
}

export interface Runtime {
  score: number
  buildStatus: string
  dimensions: RuntimeDimension[]
  disclaimer: string
}

export interface PlanBlock {
  slot: string
  title: string
  lines: string[]
  mcpSource?: string[] | null
  why?: string
  creative?: string
}

export interface McpTrace {
  tool: string
  ok: boolean
  summary?: string
}

export interface LifeState {
  emotion: string
  fatigue: number
  hunger: number | null
  budget: number | null
  prefs: string[]
  scenario: string
  timeOfDay: string | null
  timeInfoSource?: 'mcp' | 'local'
}

export interface CompilePayload {
  input: string
  state: LifeState
  bugs: Bug[]
  runtime: Runtime
  summary: string
  plan: PlanBlock[]
  mcpTrace: McpTrace[]
  failed: string[]
  toolsUsed: string[]
  disclaimer: string
}
