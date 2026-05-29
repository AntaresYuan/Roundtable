# Brainstorm Archive — Roundtable Architecture & Scope

> **Status:** historical record · do not edit to reflect current code.
> **When:** 2026-05-20 / 2026-05-21 / 2026-05-24
> **With:** Claude Opus 4.7 (cowork mode)
> **Team:** @袁晨杰 · @齐沛彤 · @Evan (a.k.a. @贾岱林 in later schedule sections — same person)
> **Source course:** AgentHub — Multi-Agent Collaboration Platform (字节跳动课题)
> **Related minutes:** [AgentHub 课题讲解 2026.5.20 飞书 minutes](https://bytedance.larkoffice.com/minutes/obcnqe7t4593x9cwy3ty56p5)

## How to use this file

This is the **upstream brainstorm** that produced the current `specs/`. It captures
team intent, rejected alternatives, and the reasoning behind load-bearing decisions
that the normalized specs no longer narrate. When in doubt about *why* a spec is
shaped the way it is, read this first.

- ⚠️ Where the spec has evolved beyond what is written here, the spec wins. See the
  "Delta vs current repo state" section at the bottom for the known drifts.
- 🔗 Per-topic mapping to current specs:

| Brainstorm theme | Current spec |
|---|---|
| 1. Group-chat UX (@mention, ownership, dep graph, side-conversations) | `specs/050-group-chat.md`, `specs/060-dependency-graph.md` |
| 2. Orchestrator behavior | `specs/010-orchestrator.md` |
| 3. Unified Agent Adapter interface | `specs/020-adapter-protocol.md` |
| 4. Context hand-off mechanism | `specs/030-handoff-card.md` |
| 5. Agent-friendly repo + AI collaboration norms | `specs/070-skills-system.md`, `rules/ai-collaboration.md`, `ai-logs/` |
| 6. 3-week × 3-person schedule | (no spec — historical only; see below) |
| 7. Risk list + Plan B | (no spec — TODO Week 3) |
| 8. 3-minute demo video script | (no spec — TODO Week 3) |

---

## Source brief (课题原文摘要)

课题：**AgentHub - 多 Agent 协作平台**。
平台采用 IM 聊天作为核心交互范式。用户像使用飞书/微信一样，通过新建对话、发送消息的方式与不同 AI Agent 进行交互。每个 Agent 就是一个"聊天对象"，用户可以：

- 新建对话：选择或指定要对话的 Agent（如 Claude Code、Codex、OpenCode 等）
- 多会话并行：同时开启多个对话窗口
- **群聊协作**：在一个对话中 @ 多个 Agent，由主 Agent（Orchestrator）自动协调分工
- 上下文连续：每个对话保持完整聊天历史，支持多轮迭代修改
- 产物内联：代码 Diff、网页预览卡片、文件附件等富媒体产物可直接在聊天流中预览和操作

平台同时接入市面主流 Agent 平台（Claude Code、Codex、OpenCode 等），通过统一的适配器层屏蔽 API 差异，并支持用户自建 Agent。所有 Agent 产出支持实时预览、代码二次编辑和一键部署发布。

**考察要点权重：** AI 协作能力 30% · 功能完整度 25% · 生成效果质量 20% · 代码理解度 15% · 创新与产品感 10%。

**交付物：** 产品设计文档 + 技术文档 + 可运行 Demo + AI 协作开发记录 + 3 分钟 Demo 视频。

---

## 确定决策 (Anchored decisions)

| 维度 | 决定 |
|---|---|
| **差异化主轴** | 群聊协作语义主打（@mention 路由、产物归属、依赖图、私聊旁观者）；AI 协作规范"扎实但不极致" |
| **深度集成 Agent** | Claude Code + OpenCode（通过 CLI/HTTP 适配器） |
| **演示型最小实现** | 用户自建 Agent (system prompt + MCP tools 挂载) + Codex CLI |
| **产物预览** | 混合路线：核心场景走 e2b 沙箱 live preview，长尾产物走静态渲染 (Markdown/Diff/PPT/Mermaid/HTML) |
| **技术栈** | Next.js 15 + LangGraph.js + Vercel AI SDK + CopilotKit + tRPC + Drizzle/Postgres |

**核心亮点（2026.5.24 团队共识）：** 封装好的工作流可视化，可自定义，目的是提升整体 vibecode 作品水平 — 帮助小白从开始就上手完善工作流，帮助重度使用者搭建自己的工作流。

---

# Theme 1 — Group-chat UX 详细设计

> Maps to: `specs/050-group-chat.md`, `specs/060-dependency-graph.md`

## (a) @mention 路由规则 — "谁该说话"

核心问题：群里有 Orchestrator + 多个子 Agent，用户发条消息，到底触发谁回复？

| 场景 | 规则设计 |
|---|---|
| 用户 @specific-agent | 死锁路由，无论 Orchestrator 在不在都直接送达 |
| 用户不 @ 任何人 | Orchestrator 接管（AutoGen `SelectorGroupChat` 风格 — LLM 看上下文 + agent 描述选下家），但 Orchestrator 默认沉默，不刷屏，只在内部决策 |
| 用户 @ 多个 agent | 并行触发 + 多气泡（视觉冲击力，能演示并发） |
| Agent A 在自己回复里 @ Agent B | 允许，但限套娃深度 ≤ 2（防止无限循环），Orchestrator 监听超深度自动 break |
| 用户想中途加新成员 | "邀请 Agent" 按钮 / Orchestrator 主动拉人 |

**坑要提前防：** 群里 Agent 数量 ≥ 4 时，无 @ 的消息怎么避免 selector 选错？
→ 在 Orchestrator prompt 里强制 reasoning + 当置信度低时反问用户 "是想让 @frontend 还是 @backend 来？"

## (b) 产物卡片归属 — "产物归谁"

核心问题：Agent 写出一段代码 / HTML / Markdown，怎么让用户一眼看到"这是谁的产出"？多 Agent 同时改一个文件该怎么处理？

| 维度 | 规则设计 |
|---|---|
| **视觉归属** | 每个 Agent 分配固定 hex 色（创建 Agent 时让用户选色，或自动哈希），产物卡片左上角 "头像 + 1px 颜色边框 + 角色标签" |
| **多版本管理** | 每次产物变更生成新版本（不是新卡片），版本卡片折叠在原卡片里，类似 Lovable 的 timeline 但更紧凑（默认展示最新版，点开"历史"看时间线） |
| **多 Agent 改同一文件** | 默认 "最后写的作为选择的版本"，但 diff 用 author 颜色染色 — 评委一眼能看出哪几行是哪个 Agent 改的（现有产品都没做这个） |
| **编辑权限** | 默认谁都能改谁的（简单），但 @reviewer 角色专门设计成"只 propose，不直接 commit"（演示 review 流程，加产品深度） |
| **聊天流缩略** | 缩略卡片（diff 前 3 行 + "+12 -3" 摘要 + agent 头像），点开右侧抽屉全屏 + Monaco 编辑器 + tab 切换 Preview/Code/Diff |

## (c) 依赖图触发条件 — "产物之间怎么联动"

核心问题：Backend Agent 改了 `/api/login`，怎么让 Frontend Agent 知道、并自动来更新调用方？
这是"多 Agent 真协作" vs "多个独立 Agent"的本质分水岭。

| 触发方式 | 使用强度 | 优劣 |
|---|---|---|
| **Agent 主动声明** | 高 | 产出时附 `depends-on: backend/api.ts` 元数据，改时自动通知。可控，但依赖 Agent 配合 |
| **不建图，靠 Orchestrator broadcast** | 高 | 简单粗暴：每次 artifact 变 Orchestrator 在群里说一句 "@frontend backend 改了你看看"。MVP 友好 |
| **LLM 后台分析** | ❌ 低 | 每次 artifact 变更跑一次轻量 LLM 扫描 imports/refs，自动建图。智能但 token 贵 + 容易错 |

**规则设计：** "Agent 主动声明" + "Orchestrator broadcast" 混合，弱化 "LLM 后台分析"。

- 在每个 Agent 的 system prompt / skill 里**强制要求声明依赖**：产出时输出 `<dependencies>` 块（结构化）
- Orchestrator 维护一个 in-memory 依赖图（节点=产物，边=依赖）
- 产物变更时，Orchestrator broadcast 到群聊："⚠️ @frontend backend/api.ts 改了 (3 行)，你的 LoginForm.tsx 可能需要同步" — 同时下游产物卡片上出现红色 badge "依赖已变更"
- 用户点 badge 上的 "让 frontend 同步" 按钮 → 触发 Frontend Agent 自动回到群聊处理
- UI 上一个折叠的侧边栏 mini graph（用 React Flow 或 dagre），节点可点
- **不做 LLM 自动分析**，太烧 token，3 周不值得

> 这块是真正的"创新点" — 现有任何产品都没把"产物依赖"做成一等公民。答辩时可以重点讲。

## (d) 私聊旁观者交互 — "用户看到多少"

核心问题：Coder 和 Reviewer 在群里讨论"这段代码要不要重构"，用户该不该看到、看到多少？

**默认折叠 + 一键展开：**
- 主流只显示用户对话 + 最终回复
- Agent 内部讨论折叠为 "💬 @frontend 与 @reviewer 讨论了 3 轮 ▸"
- 展开后，灰色背景的子对话流弹出，每条消息可见
- 子对话里有 "💬 插话" 按钮，用户可以打断 / 引导 — 这就是评委说的 **HITL（人机协同）** 入口
- 用户可以在展开后插话打断

> 这个交互能讲出 "把 multi-agent 从黑盒变成可观察 / 可干预系统" 的故事感，非常加分。

## 整体效果（demo 想象）

用户在群里发："帮我做个登录页面" → Orchestrator（皇冠图标，沉默）选下家 → Orchestrator 回复："这个需求拆成三块：UI / API / 测试。@frontend 你做 UI，@backend 你做 API，@tester 你写测试。先各自给方案，我汇总后再 push 实现。" → 三个 Agent 并行回复（三个气泡，分别染色）→ 用户看到："💬 @frontend 与 @backend 讨论了 2 轮（点开看）" 点开后看到他们在对齐 API 字段 → 5 秒后，三个产物卡片陆续出现：`LoginForm.tsx`（蓝色 frontend）、`/api/login.ts`（绿色 backend）、`login.test.ts`（紫色 tester）→ frontend 卡片上出现徽章 "depends-on: backend/api.ts"，依赖图侧边栏自动显示节点连线 → 用户点 frontend 卡片 → 右侧抽屉打开 → 切到 Preview tab → e2b 沙箱跑起来 → 看到登录页 live preview → 用户："把按钮改成蓝色"，Orchestrator 自动路由给 @frontend → frontend 改 → 卡片新版本 v2，diff 高亮变更行。

> 这个体验，Cursor / v0 / bolt / Coze 没有一个能完整复刻，是我们的护城河。

---

# Theme 2 — Orchestrator 行为设计

> Maps to: `specs/010-orchestrator.md`
> ⚠️ Spec evolved: brainstorm describes **6 stages**, spec now has **7 stages** (added `Review` between Monitor and Aggregate). Also: brainstorm role names are domain-based (`@frontend / @backend / @tester / @designer`), spec switched to SDLC-based (`@architect / @planner / @implementer / @reviewer / @fixer`).

## Orchestrator 是个什么样的"人"

一个"好的 PM"，核心价值观就一句：**能不出现就不出现，能少说就少说。**

## 工作阶段（脑爆版 6 阶段）

```
用户消息
  ↓
[1. 理解 Intake]   ← 分析意图，分类难度
  ↓
[2. 澄清 Clarify]  ← 不清楚才问，最多问 3 个
  ↓
[3. 规划 Plan]     ← 拆任务 + 决定派给谁 + 并行/串行
  ↓
[4. 分派 Dispatch] ← 在群里 @ Agent，附带 TodoList
  ↓
[5. 监督 Monitor]  ← 跟踪进度，处理失败/冲突
  ↓
[6. 汇总 Aggregate] ← 整合产出，向用户汇报
  ↓
回到 [1] 等用户下一句
```

> 当前 spec 在 Monitor 与 Aggregate 之间多了 `[7. Review]`。脑爆里的"冲突处理"已经被 Review 阶段吸收。

## 阶段 1：理解 (Intake)

用一个轻量 LLM 调用做意图分类，输出三个标签：

| 维度 | 取值 |
|---|---|
| 清晰度 | clear / ambiguous |
| 复杂度 | trivial / multi-step |
| 类型 | build / inspect / control |

**根据分类决定路径：**
- 清晰 + 简单 → 跳过澄清，直接派给最相关 Agent（或用户已 @ 的 Agent）
- 有歧义 → 进入 [2. 澄清]
- 信息咨询 / 状态查询 → PM 自己回答，不派单
- 流程调整（"停下"、"换个 agent"）→ PM 直接执行

## 阶段 2：澄清 (Clarify)

这是评委原话强调的能力。

**坑要防：** 菜鸟 PM 会问"你想用 React 还是 Vue？"这种实现细节，烦死人。**好 PM 只问目标导向问题。**

**三规则：**
1. 仅在歧义时反问
2. 最多 3 个问题
3. 必须给选项（不要开放式）

**特殊技巧：澄清问题作为结构化卡片展示**（不是纯文字），用户点选项即可回答 — 这就是 CopilotKit 的 generative UI 范式，视觉上比聊天问答更有产品感。

```
┌────── Orchestrator 反问 ───────┐
│ 在派活之前，我有两个问题：           │
│                                │
│ Q1. 这个登录页给谁用？             │
│  [○ 普通用户 ○ 企业管理员 ○ 其他]   │
│                                │
│ Q2. 登录方式？                    │
│  [○ 邮箱密码 ○ 手机验证码 ○ 都要]  │
│                                │
│       [跳过 提交]                │
└────────────────────────────────┘
```

## 阶段 3：规划 (Plan)

**拆解原则：**
- **按角色拆**（不是按文件拆）：与群里 Agent 角色对齐 — UI / API / 测试 / 设计稿
- 简单任务不拆：单文件 / 单角色能搞定的，直接派一个 Agent，PM 不出现
- 拆完输出"任务 + 依赖 + 派单"三件套

Orchestrator 在内部输出一份结构化 Plan（不直接 dump 给用户，但用户可以展开查看）：

```yaml
plan:
  - id: T1
    title: "登录 UI 组件"
    assignee: "@frontend"
    deps: [T2]
    parallel: false
  - id: T2
    title: "POST /api/login 后端"
    assignee: "@backend"
    deps: []
    parallel: true
  - id: T3
    title: "登录流程测试"
    assignee: "@tester"
    deps: [T1, T2]
    parallel: false
```

**并行 vs 串行：**
- 默认并行（无依赖）
- 有依赖的串行
- 这个判断由 Plan 阶段一次确定，后续 Monitor 按这个跑

## 阶段 4：分派 (Dispatch) — 关键产品体验

**坑要防：** Orchestrator 啰嗦地把 Plan 全 dump 在群里 → 用户被淹没。

**设计：** Orchestrator 用一条带 TodoList 的消息搞定一切（类似 Claude Code 的 TodoWrite）：

```
┌─── Orchestrator ──────────────────┐
│ 拆成三块，已派单：                    │
│                                   │
│ ☐ T2  @backend  写 /api/login   🚀│
│ ☐ T1  @frontend 登录 UI         ⏳│
│ ☐ T3  @tester   登录测试        ⏳│
│                                   │
│ [展开规划详情]                       │
└───────────────────────────────────┘
```

- TodoList 是**活的**：随着 Agent 完成，前面的 ☐ 变 ✓，状态徽章变化（⏳ 等待 / 🚀 进行中 / ✅ 完成 / ❌ 失败）
- 用户可以点 todo 上的箭头查看那个子任务的子对话（私聊旁观者入口）
- Orchestrator 派单完后就沉默，让子 Agent 在群里干活

## 阶段 5：监督 (Monitor)

**核心问题：** Agent 干活时 Orchestrator 在干嘛？

**设计：默默盯着，只在三种情况发言：**
1. **失败重试 / 降级**：某 Agent 失败 → Orchestrator 自动重试 1 次 → 还失败就 fallback（换个 Agent / 提示用户）
2. **进度异常**：某 Agent 卡住超过 60 秒 → Orchestrator 跳出来 "@frontend 进度怎么样？需要帮忙吗？"
3. **冲突检测**：两个 Agent 产出有冲突 → 进入冲突解决

**冲突处理（评委强调）：**
- **场景 1：同一文件两人改** → 自动尝试 git-style 3-way merge → 不能 merge 时 PM 跳出来给两个版本的 diff，让用户选 / 让 Orchestrator 自动决策
- **场景 2：跨文件不一致**（backend 改了字段名，frontend 没同步）→ 触发"依赖图"机制，Orchestrator ping 下游
- **场景 3：Agent 互相 @ 死循环** → 套娃深度超 2 时 Orchestrator 强制中断 + 总结

> 建议做"演示型"冲突处理：精心设计一个 demo 场景（前后端字段名冲突），让 Orchestrator 优雅地解决，答辩时很好的演示。

## 阶段 6：汇总 (Aggregate)

**坑要防：** 所有 Agent 干完后，Orchestrator 把一切重复一遍 → 用户烦。

**设计：**
- TodoList 全 ✓ 后，PM 发一条简短汇总：

```
┌─── PM ─────────────────────────┐
│ ✅ 三块都搞定了：                │
│   • LoginForm.tsx (frontend)   │
│   • /api/login.ts  (backend)   │
│   • login.test.ts  (tester)    │
│                                │
│ 测试已通过。要不要部署？           │
│                                │
│ [部署到 Vercel]  [继续修改]      │
└────────────────────────────────┘
```

- 不复述每个 Agent 干了啥（卡片里有）
- 给出下一步建议 + Quick Action 按钮（部署 / 修改）— 又是 generative UI 范式

## Orchestrator System Prompt 草稿

```
你是 AgentHub 群聊里的 PM (Project Manager)。

# 你的价值观（按优先级）
1. 能不说话就不说话。沉默 > 简短 > 详细。
2. 能不澄清就不澄清。只有真的有歧义才反问。
3. 能不拆就不拆。简单任务直接派给单个 Agent。
4. 永远给用户结构化输出 + Quick Actions，少给开放式问答。

# 你的工作流（5 阶段）
[Intake]    分析用户意图，分类清晰度/复杂度/类型
[Clarify]   仅在歧义时反问，最多 3 个问题，必须给选项
[Plan]      输出结构化 Plan (yaml)，按角色拆任务
[Dispatch]  一条 TodoList 消息派完所有单
[Monitor]   沉默盯着，只在失败/冲突/卡住时发言
[Aggregate] 简短汇总 + 下一步 Quick Action

# 群里的 Agent 你能派给
- @frontend: UI 组件、页面、样式
- @backend:  API、数据库、业务逻辑
- @tester:   单元测试、集成测试、e2e
- @designer: 设计稿、布局、视觉规范
- (用户自建 Agent 动态加入)

# 禁忌
- 不问"你要用 React 还是 Vue"这种实现细节
- 不在群里复述子 Agent 干的事
- 不打断子 Agent 干活，除非检测到失败/冲突
```

> ⚠️ 已 deprecated 的部分：5 阶段 → 7 阶段；`@frontend/@backend/@tester/@designer` → `@architect/@planner/@implementer/@reviewer/@fixer`。
> 当前 prompt 还没写到 `prompts/orchestrator.md`，写时按 spec 010 的最新角色模型来。

---

# Theme 3 — 统一 Agent 适配器接口设计

> Maps to: `specs/020-adapter-protocol.md` and `src/contracts/adapter.ts`

## 适配器层在整个架构中的位置

```
┌──────────────────────────────────────────────────┐
│           前端 (Next.js + CopilotKit)             │
│  群聊 UI / 产物卡片 / Diff / Sandbox iframe       │
└──────────────────────────────────────────────────┘
                       ↕ tRPC + SSE/WebSocket
┌──────────────────────────────────────────────────┐
│        Orchestrator 层 (LangGraph.js)            │
│  • Plan / Dispatch / Monitor / Aggregate         │
│  • Selector (LLM 选发言人 + @mention 路由)        │
│  • Dependency graph 维护                         │
│  • Conflict detection / merge                    │
└──────────────────────────────────────────────────┘
                       ↕ 统一 AgentEvent 流
┌──────────────────────────────────────────────────┐
│        ★ Agent Adapter 层（本节核心）★            │
│  ┌─────────┐┌────────┐┌────────┐┌──────────┐    │
│  │ Claude  ││Open    ││ Codex  ││ Custom   │    │
│  │ Code    ││Code    ││ CLI    ││ Agent    │    │
│  │ Adapter ││Adapter ││Adapter ││ Adapter  │    │
│  └─────────┘└────────┘└────────┘└──────────┘    │
└──────────────────────────────────────────────────┘
       ↓           ↓          ↓          ↓
    CLI 子进程   HTTP/SSE   CLI 子进程  Vercel AI SDK
    stream-json   REST     --json     + MCP tools
```

**适配器层的唯一职责：** 把 4 种不同的 Agent runtime 包装成一种 `AsyncIterable<AgentEvent>`，让 Orchestrator 不知道也不关心下游是 Claude Code 还是别的。

## 核心接口设计 (TS)

```ts
// === 1. Adapter (工厂) ===
export interface AgentAdapter {
  readonly id: string;              // "claude-code" | "opencode" | "codex" | "custom:<uuid>"
  readonly displayName: string;
  readonly avatar: string;
  readonly capabilities: AgentCapabilities;

  createSession(opts: SessionOpts): Promise<AgentSession>;
}

export interface AgentCapabilities {
  streaming: boolean;
  toolUse: boolean;
  fileEdits: boolean;
  persistentSessions: boolean;  // 支持 --resume
  mcp: boolean;                  // 支持挂载 MCP server
  multimodal: boolean;
}

// === 2. Session (一次对话) ===
export interface AgentSession {
  readonly id: string;
  readonly adapterId: string;
  readonly cwd: string;

  send(input: UserInput): AsyncIterable<AgentEvent>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
}

export interface SessionOpts {
  sessionId?: string;            // resume 用
  cwd: string;                   // workspace 路径（强隔离）
  systemPrompt?: string;
  mcpServers?: McpServerConfig[];
  allowedTools?: string[];
  agentMeta: { role: string; color: string };  // 染色给前端
}

// === 3. 核心事件流（最重要的部分）===
export type AgentEvent =
  // —— 思考过程 ——
  | { type: 'thinking_delta'; delta: string }
  // —— 文本输出 ——
  | { type: 'text_delta'; delta: string }
  // —— 工具调用 ——
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; output: unknown; isError?: boolean }
  // —— 文件变更（统一 unified diff 格式）——
  | { type: 'file_change'; path: string; kind: 'create' | 'edit' | 'delete'; diff: string }
  // —— 产物（一等公民）——
  | { type: 'artifact'; artifact: Artifact }
  // —— Agent 主动声明依赖（评委强调的关键点）——
  | { type: 'declare_dependency'; from: string; to: string; kind: DepKind }
  // —— 结束 ——
  | { type: 'done'; usage?: TokenUsage; finishReason?: string }
  // —— 错误 ——
  | { type: 'error'; message: string; recoverable: boolean };
```

**关键设计原则：**
1. **流式优先** — 所有事件都是流式 `AsyncIterable`，没有同步 `Promise<Reply>` 接口
2. **平坦事件** — 不嵌套，每条事件单独可序列化（方便走 SSE / WebSocket）
3. **discriminated union** — TS 类型守卫无脑，前端 `switch(event.type)` 全覆盖
4. **`declare_dependency` 是一等事件** — 不藏在 artifact 元数据里，给 Orchestrator 直接消费

## Artifact 类型设计（产物一等公民）

```ts
export type Artifact = {
  meta: ArtifactMeta;
  body: ArtifactBody;
};

export interface ArtifactMeta {
  id: string;
  agentId: string;          // 产物归属（视觉染色用）
  agentColor: string;
  version: number;
  parentVersion?: number;
  createdAt: Date;
  title: string;
  dependencies?: ArtifactDep[];
}

export type ArtifactBody =
  | { kind: 'code';      path: string; language: string; content: string }
  | { kind: 'diff';      oldContent: string; newContent: string; path: string }
  | { kind: 'web_app';   files: FileTree; entrypoint: string; sandboxUrl?: string }
  | { kind: 'markdown';  content: string }
  | { kind: 'mermaid';   content: string }
  | { kind: 'html';      content: string }
  | { kind: 'spec';      content: string; meta: { goal: string; acceptance: string[] } };

export interface ArtifactDep {
  artifactId: string;
  kind: 'imports' | 'calls' | 'extends' | 'references';
}
```

**前端怎么用：**

```ts
// 一个 ArtifactRenderer 按 kind 分发
function ArtifactRenderer({ artifact }: { artifact: Artifact }) {
  switch (artifact.body.kind) {
    case 'web_app': return <SandboxIframeCard a={artifact} />;  // e2b 沙箱
    case 'code':    return <CodeCard a={artifact} />;            // Monaco
    case 'diff':    return <DiffCard a={artifact} />;            // Monaco diff editor
    case 'markdown':return <MarkdownCard a={artifact} />;        // react-markdown
    case 'mermaid': return <MermaidCard a={artifact} />;
    case 'html':    return <HtmlCard a={artifact} />;            // 静态 iframe
    case 'spec':    return <SpecCard a={artifact} />;            // 结构化产品卡
  }
}
```

`web_app` 走沙箱，其他都走静态渲染，前端零分支判断逻辑。

## 4 个 Adapter 具体怎么实现

### 1. Claude Code Adapter（首选，2-3 天）

```ts
class ClaudeCodeAdapter implements AgentAdapter {
  id = 'claude-code';

  async createSession(opts: SessionOpts) {
    return new ClaudeCodeSession(opts);
  }
}

class ClaudeCodeSession implements AgentSession {
  private proc?: ChildProcess;

  async *send(input: UserInput) {
    this.proc = spawn('claude', [
      '-p',
      '--output-format', 'stream-json',
      '--input-format',  'stream-json',
      '--resume', this.id,
      '--cwd', this.cwd,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    this.proc.stdin.write(JSON.stringify({ type: 'user', content: input.content }) + '\n');

    const rl = readline.createInterface({ input: this.proc.stdout });
    for await (const line of rl) {
      const raw = JSON.parse(line);
      yield mapClaudeEventToAgentEvent(raw);  // ← 关键映射函数
    }
  }
}
```

**关键映射：** Claude Code 的 stream-json 事件 → 我们的 `AgentEvent`。`tool_use` 直接映射，text 块 → `text_delta`，Write/Edit tool result → 后处理生成 `file_change` 事件。

**坑要防：** stdio 缓冲死锁、TTY 检测、session 文件位置、auth 隔离。前面调研报告里 claude-code-router/Crystal 等开源项目都踩过，照着学。

### 2. OpenCode Adapter（最容易，1 天）

```ts
class OpenCodeAdapter implements AgentAdapter {
  id = 'opencode';

  async createSession(opts: SessionOpts) {
    // 启动或复用一个 opencode serve 实例
    const baseUrl = await ensureOpenCodeServer();
    const session = await fetch(`${baseUrl}/session`, { method: 'POST' }).then(r => r.json());
    return new OpenCodeSession(baseUrl, session.id, opts);
  }
}

class OpenCodeSession implements AgentSession {
  async *send(input: UserInput) {
    const res = await fetch(`${this.baseUrl}/session/${this.id}/message`, {
      method: 'POST',
      body: JSON.stringify({ content: input.content }),
    });
    // OpenCode 直接走 SSE，事件结构和我们的几乎一致
    for await (const event of parseSSE(res.body)) {
      yield mapOpenCodeEventToAgentEvent(event);
    }
  }
}
```

OpenCode 天然 HTTP server，比 CLI 简单一个量级，是验证适配器抽象通用性的**最佳"第二个 Agent"**。

### 3. Codex CLI Adapter（演示型，1 天）

类似 Claude Code 思路（spawn 子进程），但 `--json` 输出还不稳定。做"够演示就行"：能跑能截图就 OK，不深做。

### 4. Custom Agent Adapter（用户自建，2 天）

```ts
class CustomAgentAdapter implements AgentAdapter {
  constructor(private spec: AgentSpec) {}  // 用户在 UI 里填的 spec

  async createSession(opts: SessionOpts) {
    return new CustomAgentSession(this.spec, opts);
  }
}

class CustomAgentSession implements AgentSession {
  async *send(input: UserInput) {
    const result = await streamText({
      model: openai('gpt-4o'),  // 或火山方舟 Seed 2.0 Late
      system: this.spec.systemPrompt,
      messages: [...this.history, { role: 'user', content: input.content }],
      tools: buildToolsFromMCPServers(this.spec.mcpServers),
    });

    for await (const chunk of result.fullStream) {
      yield mapVercelAiSdkChunkToAgentEvent(chunk);
    }
  }
}
```

用 Vercel AI SDK 跑 + 用户挂载的 MCP servers（提供工具集）。这条路径最自由，但要自己实现 file edits / artifact production — 通过精心设计的 system prompt + 几个核心 MCP tools (filesystem / git) 解决。

---

# Theme 4 — 上下文 hand-off 机制

> Maps to: `specs/030-handoff-card.md` and `src/contracts/handoff.ts`

## 先把"上下文"拆开

| 维度 | 内容 |
|---|---|
| **用户意图** | 原始需求一句话 |
| **任务简报** | 当前 Agent 这次要干嘛 |
| **项目级上下文** | 用户钉的全局约束（"支持中英文"、"部署到 Vercel"） |
| **群成员快照** | 群里其他人都是谁、在干嘛 |
| **上一手** | 上一个 Agent 干了什么 + 关键产物 + 未决问题 |
| **相关产物** | 你可能需要看的产物（引用，不内嵌内容） |
| **全历史 ref** | 兜底，可回查的 ID |

不同场景下 hand-off 时，要传的子集不同。

## 3 种 hand-off 场景

### 场景 1：群聊内 PM 派单（最高频）

```
用户: "做个登录页"
  ↓
PM 拆解 → @frontend 拿到 piece 1，@backend 拿到 piece 2
```

@frontend 需要拿到：
- 用户原始需求
- PM 的整体 plan（这样它知道自己是大拼图的一块）
- 其他 Agent 的角色和它们在做什么（避免重复 / 冲突）
- 项目级 Pin 消息
- **不需要：其他 Agent 的具体代码内容**

### 场景 2：群聊内 Agent A → Agent B（评委强调的 "hand off"）

```
@frontend: "我需要 /api/login，字段是 { email, password }，@backend 你看看"
  ↓
@backend 被 ping
```

@backend 需要拿到：
- 上面所有（场景 1 的）
- frontend 刚才说的具体要求
- frontend 的产物（看 `LoginForm.tsx` 里调用 API 的代码片段，知道字段名期待）
- **不需要 frontend 的全部内部讨论历史**（节省 token）

### 场景 3：新 Agent 中途加入（"拉群"）

群聊已经聊了 30 轮，用户："@security 审一下我们做的"

@security 需要拿到：
- 一份浓缩摘要（用户原始需求 / 关键决策 / 当前进度）
- 所有产物列表（不一定要看代码内容，但要知道有什么）
- Pin 消息
- ❌ **不需要：30 轮历史的逐字记录**

### 场景 4（P2 加分项）：跨会话 hand-off

从对话 A 把上下文带到对话 B。3 周内做"演示型"即可（"导出上下文 → 导入"按钮），不深做。

## 设计：HandoffCard（结构化交接卡）

```ts
interface HandoffCard {
  id: string;
  from: AgentId | 'orchestrator' | 'user';
  to: AgentId;
  scenario: 'dispatch' | 'agent_handoff' | 'join_group' | 'cross_chat';

  // —— 浓缩的 context（必传） ——
  userIntent: string;            // 用户原始意图（一句话）
  taskBrief: string;             // 这个 Agent 这次要干嘛

  // —— 项目级（必传） ——
  pinnedMessages: PinnedMessage[];  // 用户钉的全局约束
  rolesInGroup: AgentRoleSnapshot[]; // 群里其他人都是谁、在干嘛

  // —— 上一手（按需）——
  previousAgent?: {
    summary: string;             // 上一个 Agent 干了什么（LLM 生成）
    keyOutputs: ArtifactRef[];   // 上一个 Agent 的产物引用
    openQuestions: string[];     // 留给你的未决问题
  };

  // —— 产物上下文（按需）——
  relevantArtifacts: ArtifactRef[];  // 你可能需要看的产物

  // —— 兜底 ——
  fullHistoryRef: string;        // 全历史的链接/ID，需要时可回查

  createdAt: Date;
  generatedBy: 'orchestrator';   // 谁生成的（一般是 PM）
}
```

**Orchestrator 负责生成 HandoffCard：** 每次派单 / 路由前，PM 调火山方舟生成一张卡，注入到下一个 Agent 的 system message。

**HandoffCard 的核心价值：**
1. **结构化 > 自由文本**：LLM 容易解析，token 紧凑
2. **可视化**：在群聊 UI 上显示成一张卡片（不只是消息）
3. **可干预**：用户能展开看 / 编辑 / 增删
4. **可追溯**：每次 hand-off 都留档，可在产品里展示"交接历史"

## UI 上长什么样

群聊里 hand-off 发生时，出现一张可折叠卡片：

```
┌─── 🔄 PM → @backend ────────────────────────┐
│                                            │
│ 任务: 写 POST /api/login 后端 API           │
│                                            │
│ 📌 全局约束 (来自 user pinned)              │
│   • 支持中英文                              │
│   • 项目要部署到 Vercel                     │
│                                            │
│ 💬 上手 @frontend 已完成                    │
│   • 摘要: 写了 LoginForm.tsx                │
│   • 期待字段: { email, password }           │
│   • 未决: 错误提示文案谁写？                │
│                                            │
│ 📎 相关产物                                 │
│   [LoginForm.tsx v1] (frontend)            │
│                                            │
│ [✎ 编辑]  [展开全历史]                      │
└────────────────────────────────────────────┘
```

**关键交互：**
- 默认折叠为一行 "🔄 hand-off 给 @backend"，点击展开
- `[✎ 编辑]` 按钮 → 用户可以加 / 删 / 改任何一项，再 dispatch
- `[展开全历史]` → 跳到完整历史回查
- 进入 @backend 的子任务后，HandoffCard 永远固定在该子任务顶部（pinned），@backend 可以反复回查

> 这个 UI 把"看不见的 context transfer"变成可视、可干预的产品对象 — 答辩时这是核武器，直接对应评委说的"hand-off 平滑迁移"加分项。

## 技术实现要点（LangGraph 落地）

```ts
// 1. State 里维护 handoff 历史
interface RoundtableState {
  messages: Message[];
  artifacts: Map<string, Artifact>;
  pinnedMessages: PinnedMessage[];
  handoffs: HandoffCard[];   // ← 累积历史
  activeAgents: AgentId[];
}

// 2. Orchestrator 派单时，生成 HandoffCard
async function dispatchNode(state: RoundtableState) {
  const card = await generateHandoffCard({
    from: 'orchestrator',
    to: '@frontend',
    state,
    model: huoshan('seed-2.0-late'),  // 用便宜的模型生成
  });

  return new Command({
    goto: 'frontend_agent',
    update: {
      handoffs: [...state.handoffs, card],
      currentHandoff: card,  // 当前 active 的 hand-off
    },
  });
}

// 3. 子 Agent 节点启动时，从 HandoffCard 构造 system message
async function frontendAgentNode(state: RoundtableState) {
  const card = state.currentHandoff;
  const systemPrompt = buildSystemPromptFromHandoff(FRONTEND_BASE_PROMPT, card);

  const session = await claudeCodeAdapter.createSession({
    cwd: state.cwd,
    systemPrompt,
    metadata: { role: 'frontend', color: '#3b82f6' },
  });

  // ... 调 Claude Code, 流式 yield 事件
}
```

**关键设计：** HandoffCard 不污染 LangGraph 主 message stream，作为独立 state 字段；子 Agent 拿到它只是在自己的 system prompt 里看见，不会把它当成"用户输入"回复。

## Token 控制策略

群聊变长之后 HandoffCard 会越来越多，要控制：

1. 每次 hand-off 只看最近 N 张 HandoffCard（默认 N=3）
2. 超过 N 的旧卡片：保留 `userIntent` + `keyOutputs` 引用，丢 `previousAgent.summary` 等细节
3. **产物引用而非内嵌**：HandoffCard 里只放 `ArtifactRef`（id + 摘要），不放完整代码。需要看代码时 Agent 自己用 Read tool 去拿
4. Pin 消息有数量上限（10 条），超过强制用户取消旧的

---

# Theme 5 — Agent 友好仓库 + AI 协作规范

> Maps to: `AGENTS.md`, `CLAUDE.md`, `specs/070-skills-system.md`, `rules/`, `ai-logs/`, `skills/`, `examples/adapter-template/`

## 7 个支柱（我们 GitHub repo 的骨架）

```
roundtable/
├── AGENTS.md                ← 任何 agent 进来第一份读这个
├── CLAUDE.md                ← Claude Code 专用约定
├── .cursor/rules/           ← Cursor 用户专用规则
│   ├── 00-general.mdc
│   ├── typescript.mdc
│   └── nextjs.mdc
├── specs/                   ← ⭐ 产品 + 技术 spec（命门）
│   ├── 000-overview.md
│   ├── 010-orchestrator.md
│   ├── 020-adapter-protocol.md
│   ├── 030-handoff-card.md
│   └── ...
├── skills/                  ← ⭐ Anthropic Skills 格式的可复用流程
│   ├── add-agent-adapter/
│   │   ├── SKILL.md
│   │   └── template/
│   ├── write-orchestrator-prompt/
│   └── debug-stream-json/
├── rules/                   ← 团队协作约定
│   ├── ai-collaboration.md  ← ⭐ 团队怎么和 AI 协作的元规则
│   ├── commit-message.md
│   ├── pr-checklist.md
│   └── code-review.md
├── ai-logs/                 ← ⭐ AI 协作的活档案（评分关键）
│   ├── decisions/           ← 决策记录（ADR 风格）
│   ├── handoffs.jsonl       ← 产品运行时自动产出
│   ├── incidents.md         ← AI 翻车记录 + 学到了什么
│   └── prompt-history/      ← 重要 prompt 的快照
├── examples/                ← 给 agent 抄的标杆实现
│   └── adapter-template/
└── src/...
```

## 支柱 1：AGENTS.md（入口）

这是任何 AI agent 进来读的第一份文件，必须**短、扫得清、有指路**。少说项目介绍（README 已经有），多说"如果你想干 X，去看 Y"的 lookup table。

## 支柱 2：specs/ — 产品 + 技术 spec

每个 spec 用统一模板（这是 spec 的 spec）：

```
# Spec NNN: <title>

## Goal
## Non-goals
## Background
## Design
## Acceptance criteria
## Open questions
## Changelog
```

**为啥这件事重要：** 评委一翻 `specs/` 文件夹，立刻看到 **结构化、可追溯、有 acceptance、有决策**。这就是"严肃工程"的样子，而不是堆代码。

**实操建议：** 写 7-10 个核心 spec，覆盖 Orchestrator / Adapter / HandoffCard / Artifact / Group chat / Dependency graph / Skills 系统。每个 200-400 字即可，不用长。

## 支柱 3：skills/ — Anthropic Skills 格式（关键差异化）

借 Anthropic Skills 标准格式（`SKILL.md` + 资源文件），让我们的"协作规范"直接可被 Claude Code 等 Agent 复用。

**为啥用 Anthropic Skills 格式：**
1. 行业标准（Anthropic 出品，Claude Code 原生识别）
2. **可被 Claude Code 自动发现**：我们仓库里写的 skill，Claude Code 在工作时自动会用到
3. **复用到产品里**：Roundtable 产品的子 Agent 也可以读这些 skill — **同一份 skill 同时服务"开发团队"和"产品运行时"**，这个点答辩可以重锤

**3 周内最少做的 skill：**
- `add-agent-adapter` — 加新 Coding Agent
- `write-orchestrator-prompt` — 调 PM 提示词
- `debug-stream-json` — 调试 Claude Code 协议
- `generate-handoff-card` — 生成交接卡（产品运行时也用）
- `release-checklist` — 发版前要做什么

## 支柱 4：ai-logs/ — AI 协作活档案（评委原话要求）

这是评委最直接看到 "你们怎么和 AI 协作" 的地方。两类内容：

### (a) 手动维护的 `decisions/`（ADR 风格）

```
ai-logs/decisions/
├── ADR-001-choose-langgraph-over-autogen.md
├── ADR-002-claude-code-cli-vs-api.md
├── ADR-003-handoff-card-format.md
└── ADR-007-pm-cannot-create-new-agents.md
```

每个 ADR 包含一个关键字段 **"AI assistance"** — 直接展示团队怎么用 AI 帮决策，对应评委要的 "AI 协作记录"。

### (b) 自动产出的 `handoffs.jsonl`

产品运行时每次 Agent hand-off 自动写入：

```json
{"ts":"...","from":"@frontend","to":"@backend","card_id":"...","user_intent":"...","summary":"..."}
```

这是产品的"飞行记录" — 答辩时 demo 视频里可以瞬间打开看，让评委看到"我们的多 Agent 协作不仅 demo 跑通了，**每一次都被记录下来，是可审计的**"。

## 支柱 5：rules/ai-collaboration.md（团队元规则）

这是最值得抠的一份文件。

> 这一份就值 10 分 — 它直接证明团队有系统地和 AI 协作，而不是"反正能跑就行"。

## Meta 层（隐藏亮点）：产品自身 enforce 同一套

Roundtable 产品里，每个用户对话对应一个 workspace。Roundtable 自动在每个 workspace 初始化时：
- 生成 `AGENTS.md`（动态填充：群里有谁、能力、当前任务）
- 创建 `ai-logs/handoffs.jsonl`（产品运行时自动写）
- 把仓库根的 `skills/` 复制（或软链）到 workspace `.claude/skills/`，让 Claude Code Adapter 自动发现

**答辩故事：**
> 我们不只是把 AgentHub 仓库做成 agent-friendly 的，我们让 Roundtable 创建的**每个用户项目**也自动 agent-friendly。同一套 skills 既是我们团队的开发约定，也是产品里 Agent 的工作手册。**开发和运行时共享同一份规范。**

## P0 / P1 / P2 分配（3 周内）

| 优先级 | 必做项 |
|---|---|
| **P0** (Week 1) | AGENTS.md / CLAUDE.md / specs 7-10 份骨架 / ai-logs 目录 / 至少 1 个 ADR / 至少 1 个 skill |
| **P1** (Week 2) | rules/ai-collaboration.md / 4 个核心 skill 完整 / handoffs.jsonl 产品运行时写入 / 6 个 ADR |
| **P2** (Week 3) | 产品 workspace 自动初始化 / incidents.md 填满 demo 故事 / prompt-history 快照 / release-checklist skill |

> **关键节奏：** 第 1 周 day 1 就把骨架建好（空文件 / 模板），别等最后一周补 — 评委看 git log 一眼能看出来是补的还是真做的。

---

# Theme 6 — 3 周 × 3 人详细排期

> ⚠️ 历史排期记录 — 与真实进度可能已经偏离。当前进度看 `git log` 和 issue tracker。
> 名字对应：**@Evan = @贾岱林**（同一个人，D1-D7 用前者，D8 之后用后者）。

## Week 1（5/20 – 5/26）

### @袁晨杰 — 产品 + 交付层
- D1-D2：写 PRD（产品设计文档骨架）+ 群聊 UX 详细 wireframe + AGENTS.md / specs/ 框架
- D3-D4：Next.js 布局 + 会话列表 + 单聊页面 + 消息气泡 + 流式渲染
- D5：单聊抛光（toolbar、状态、loading），Day 5 milestone 合体
- D6-D7：群聊 UI scaffold（@mention input、群成员侧栏）+ tool use 卡片标准化设计

### @Evan — 架构 + 合约层
- D1：ADR-001/002（技术选型记录）+ Monorepo 结构 + CI / pre-commit hook + 类型生成管线
- D2-D3：AgentEvent / Artifact / HandoffCard 三大 schema 冻结（Contracts 合约层）+ LangGraph hello world
- D4：Adapter interface 定义 + Vercel AI SDK 火山方舟 client + Function Calling 标准化
- D5：把 Claude Code Adapter 接到 LangGraph 节点，Day 5 milestone 合体
- D6-D7：Orchestrator 节点 scaffold（先放 mock 后续 Y 填 prompt）+ Selector 接入框架

### @齐沛彤 — 后端 + 数据
- D1：Repo 初始化 + Docker compose（Postgres + Redis）+ next-auth
- D2-D3：Drizzle schema（users / chats / messages / artifacts / handoffs / sessions / pinned_messages）+ tRPC routes
- D4-D5：Claude Code Adapter 主体（spawn + stream-json 解析）+ Workspace per-chat 隔离 + Day 5 milestone 合体
- D6-D7：OpenCode serve 模式跑通 + OpenCode Adapter 起步

## Week 2（5/27 – 6/2）— 群聊核心 + Handoff + 产物

### @袁晨杰 — UI 大爆发周
- D8-D9：群聊气泡（按 Agent 染色）+ TodoList 卡片（动态更新）+ @mention autocomplete
- D10：群聊 e2e 联调，Day 10 milestone
- D11-D12：HandoffCard UI（折叠/展开/编辑）+ Quick Action 按钮 + 产物卡片骨架
- D13-D14：Artifact 分发器（按 kind 路由到 Monaco / Markdown / Diff / Mermaid / Sandbox iframe）+ Day 14 milestone
- **Bonus：** 搭 Eval 仓库骨架
  - `evals/orchestrator/` 目录建好
  - 写 30-50 条 intake-classification 测试用例（手工标注）
  - 写一个最小 runner（CI 跑通即可）

### @贾岱林 — Orchestrator + 第二 Adapter
- D8：Orchestrator Intake + Clarify 节点 + 反问卡片 schema（generative UI）
- D9：Orchestrator Plan + Dispatch 节点 + TodoList 结构化输出
- D10：Day 10 milestone（群聊 + 两个 Agent + Orchestrator 6 阶段 mock 跑通）
- D11-D12：OpenCode Adapter 完成 + 验证 Adapter interface 通用性（这是 Contracts 治理的兑现）+ Custom Agent runtime
- D13-D14：MCP server 内置 3 个 default + 自建 Agent UI 后端 + Day 14 milestone

### @齐沛彤 — Proactive 协作 + HandoffCard 系统
- D8-D9：Selector 节点核心逻辑（无 @ 时智能选发言人，置信度低时回退反问）— 上次的 Proactive 协作层经验直接复用
- D10：Day 10 milestone
- D11-D12：HandoffCard 生成 prompt + GapDetector 风格的产物/决策提取（recall 经验复用）+ Postgres checkpointer
- D13-D14：`file_change` → Artifact 事件 watcher + e2b sandbox 集成 + Day 14 milestone

## Week 3（6/3 – 6/10）— 差异化 + 演示 + 收尾

### @袁晨杰 — 差异化 UI + dogfood 抛光
- D15-D16：产物归属染色（边框/头像/diff 多人颜色）+ 依赖图 mini view（React Flow）
- D17：私聊旁观者（折叠/展开/插话交互）+ HITL 中断卡片
- D18：整体抛光 + dogfood 一轮
- **Bonus D15-D18：** 维护 Eval + 调 prompt 用 Eval 报告做依据
  - 每次调完 Orchestrator prompt 跑一遍 → 留报告到 `evals/reports/YYYY-MM-DD-vN.md`
  - 每份报告记录："改了什么 prompt、哪些 case 分数升了、哪些 case 退化了" — 这是答辩黄金素材
- D19：Day 19 freeze
- D20-D21：Demo 视频 storyboard + 录屏 + 后期 + 答辩 PPT
- **Bonus：** 整理 AI PM 方法论文档（散落经验沉淀）
  - `/docs/methodology/ai-pm-playbook.md`
  - 内容大纲：AI 产品 PRD 范式 / Prompt 防幻觉模式 / Eval-driven 迭代 / AI 协作开发协议 / 多 Agent UX 设计原则
  - 这份文档本身是 Roundtable 交付物的一部分，标记为"团队方法论沉淀"

### @贾岱林 — Codex + 冲突解决 + 合约稳定
- D15-D16：Codex CLI Adapter（演示型）+ HITL `interrupt()` 接入
- D17：冲突检测（同文件 diff 冲突）演示场景 + Orchestrator prompt 终调
- D18：全链路类型烟雾测试（Contracts 治理收官）
- D19：Day 19 freeze
- D20-D21：技术文档（架构图 + 接口规范）+ CI lint for spec

### @齐沛彤 — 主动介入 + 跨会话 + 联调
- D15-D16：Orchestrator 依赖图后端逻辑 + 主动 broadcast（依赖变化 ping 下游）+ `ai-logs/handoffs.jsonl` 自动写入
- D17：跨会话 hand-off（演示型导出/导入）+ Pin 消息系统
- D18：系统联调（全程联调担当）+ 准备 demo 数据
- D19：Day 19 freeze
- D20-D21：后端文档 + 部署说明 + 答辩 backup 数据

---

# Theme 7 — 风险清单 + Plan B

> **TODO Week 3** — 脑爆里只列了标题，没展开。需要补的内容（建议在 Week 3 D17-D18 期间填）：
> - **风险：Codex CLI 接不上怎么办** → Plan B: 用 Custom Agent + GPT/Claude 模型模拟，标注为"demo 型"
> - **风险：e2b 超预算怎么办** → Plan B: 静态 iframe 渲染 + 文件树视图作为 fallback（spec 040 已经有 fallback 策略）
> - **风险：群聊协作做不出来怎么办** → Plan B: 演示型脚本化群聊（预录关键场景，保证 demo 不翻车）
> - **风险：Claude Code stream-json 协议变了** → Plan B: 已建 `skills/debug-stream-json` 应对
> - **风险：火山方舟模型不可用** → Plan B: OpenAI / Anthropic 官方 API 备份
> - **风险：Orchestrator prompt 调不稳** → Plan B: Eval 框架兜底，回退到上一个稳定版本

---

# Theme 8 — 3 分钟 Demo 视频脚本

> **TODO Week 3** — 脑爆里只列了标题，没展开。需要在 Week 3 D20-D21 之前完成 storyboard。
>
> **5 秒抓住评委的开场建议**（脑爆方向）：直接放整体效果想象里的那个登录页场景 — 用户一句"帮我做个登录页面" → 三个染色气泡并行 → 三个产物卡同时落地 → 依赖图自动连线 → 用户改"按钮蓝色" → 自动路由 → v2 diff 高亮。整套流程在 30 秒内完成，视觉冲击最大。

---

# Delta vs current repo state

> Maintained whenever the brainstorm diverges from `specs/` or `src/`. Update on
> material spec changes.

## Already evolved beyond the brainstorm (spec wins)

1. **Orchestrator state machine: 6 → 7 stages.** `specs/010-orchestrator.md` adds an explicit `Review` stage between `Monitor` and `Aggregate`. The brainstorm's "conflict handling" responsibilities are mostly absorbed into Review.
2. **Role model: domain-based → SDLC-based.** Brainstorm uses `@frontend / @backend / @tester / @designer`. Spec 010 now uses `@architect / @planner / @implementer / @reviewer / @fixer`. The shift is intentional: roles describe *what kind of work* the agent does, not *which area of the stack*, so the same adapter can play different roles in different chats. UI mocks, demo scripts, and Orchestrator system prompts must adopt the new names.
3. **Product positioning.** `specs/000-overview.md` reframed Roundtable as a "consumer-friendly vibe coding workbench" with an explicit target-user list (non-code founders, designers, students, vibe coders). The brainstorm was tool-builder-centric; the spec leans more user-friendly.
4. **Gemini CLI added to the adapter matrix** (`specs/020-adapter-protocol.md` capabilities table). Brainstorm only covered Claude Code / OpenCode / Codex / Custom.
5. **Workspace isolation hardened.** Spec 020 now has explicit isolation rules (reject absolute paths outside `cwd`, store session files under `.roundtable/sessions/...`, truncate command output). Brainstorm only mentioned "workspace per chat".
6. **Cross-chat handoff scope locked to demo-only** in spec 030. Brainstorm called it P2; spec confirms.

## Still missing (not yet in repo)

1. **Eval framework** (`evals/orchestrator/`). Brainstorm bonus item for Week 2; no scaffolding yet. Recommend an ADR + spec when work starts.
2. **Volcano Engine (火山方舟) Seed 2.0 Late model selection** for cheap context-generation calls. Mentioned in brainstorm but no ADR pins the model choice.
3. **Risk register & Plan B** (Theme 7). Stub only — fill in Week 3.
4. **Demo video script & storyboard** (Theme 8). Stub only — fill in Week 3.
5. **AI PM methodology doc** (`docs/methodology/ai-pm-playbook.md`). Bonus deliverable proposed by @袁晨杰 in Week 3; not started.
6. **Selector node** (LLM-driven speaker selection when no `@` in user message). Mentioned across themes 1 & 2; not in `src/orchestrator/nodes/` yet — when implemented, also add the low-confidence-fallback-to-clarify path described in spec 050 (a).
7. **Conflict-handling demo scenario** (backend renames field; frontend stale). Mentioned in Theme 2 as a high-value answer-defense moment. Not yet scripted.
8. **Custom Agent UI for user-built agents** (system prompt + MCP tools mounting). Brainstorm proposes it; no UI scaffolding.

## Naming reconciliation

- **@Evan == @贾岱林**, same teammate, two name forms across the brainstorm. Treat them as equivalent in any future schedule reference.

## Source of truth ordering (when this file conflicts with reality)

1. The code (`src/`) — ground truth of what exists.
2. The specs (`specs/`) — current intended design.
3. The ADRs (`ai-logs/decisions/`) — load-bearing decisions, must be checked when changing course.
4. **This file** — useful for *why* and *what was rejected*; do not treat as current spec.

## Changelog

- 2026-05-27 — archived from cowork sessions on 2026-05-20 / 21 / 24; added Delta section.
