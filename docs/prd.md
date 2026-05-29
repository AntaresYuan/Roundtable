# Roundtable — Product Requirements Document / 产品需求文档

> **Draft v1 · 2026-05-27 · Owner: @AntaresYuan**
>
> **Reading guide / 阅读说明：** 每个章节的小标题是双语；正文之前有一段中文摘要（`> 中文`），方便评委快速扫读；正文保留英文，因为里面密集引用 `specs/` 和 `ADR-NNN`，保持英文术语和链接的精度。表格和 wireframe 不翻译。

## TL;DR (one-page) / 一页摘要

> **中文 TL;DR：** Roundtable 是一个以 IM 群聊为交互范式的多 Agent 协作平台。用户像在飞书/微信里一样，一对一或者拉群跟 Coding Agent（Claude Code、OpenCode、Codex、用户自建）干活，群里由一个主 Agent（Orchestrator / PM）协调分工。**护城河押注在"群聊语义"上**：`@mention` 路由、按 Agent 染色的产物归属、可见且可编辑的 HandoffCard（上下文交接卡）、可观察的私聊旁观、产物之间的依赖图变更徽章——这五件事现有 Cursor / v0 / Bolt / Coze 都没完整复刻。我们深度集成 Claude Code + OpenCode，演示型 Codex CLI，以及用户用 Vercel AI SDK + MCP tools 自建 Agent。产物用一个统一 `<ArtifactRenderer>` 分发，`web_app` 走 e2b 沙箱 live preview，其余（code / diff / markdown / mermaid / html / spec）走静态渲染。产品面向"想用 AI 造东西但不想当工程师"的人，但同时保留 spec / ADR / HandoffCard / prompt 的完整审计链路，让有经验的开发者也能维护下去。课题交付物：本 PRD、技术文档、可运行 Demo、AI 协作开发记录（`ai-logs/`）、3 分钟 Demo 视频。

Roundtable is an IM-style multi-agent collaboration platform. Users build software by chatting with Coding Agents (Claude Code, OpenCode, Codex, or user-built) the way they chat with teammates in 飞书 or 微信 — one-on-one for focused tasks, or in a group where an Orchestrator (PM) coordinates several agents around a shared workspace.

The platform's load-bearing bet is **group-chat semantics for agents**:

- `@mention` routing with explicit and implicit dispatch.
- Per-agent artifact ownership (color, version chain, multi-author diff coloring).
- **Hand-offs are visible product objects** (`HandoffCard`), not opaque message-passing.
- Side-conversations between agents collapse by default but stay observable.
- Artifact dependencies are first-class: when an upstream changes, downstream cards surface a badge.

We deeply integrate two Coding Agents (Claude Code + OpenCode) plus a demo-grade Codex CLI adapter and a user-built Custom Agent path (Vercel AI SDK + MCP tools). Artifacts render through a single dispatcher — `web_app` runs in an e2b sandbox; everything else (code, diff, markdown, mermaid, html, spec) renders statically.

The product surface is designed for non-engineer builders without sacrificing the audit trail that experienced developers need. Specs, ADRs, hand-offs, and prompts are all persisted as inspectable artifacts.

Grade-relevant deliverables: this PRD, a technical document, a runnable demo, an AI collaboration record (`ai-logs/`), and a 3-minute demo video.

Spec index lives in [§ 8](#8-spec-backlink-index--spec-索引).

---

## 1. Target users / 目标用户

> **中文：** Roundtable 是给"想用 AI 造东西、但不想从第一天就当工程师"的人做的。四类典型用户：(1) 没编程背景的创业者验证产品想法；(2) 做内部工具的设计师 / 运营；(3) 边做边学的学生 / 创作者；(4) 已经在用 Cursor / Claude Code 的资深 vibe coder，但需要更好的协作、review 和维护能力。用户不需要读终端日志就能看懂在发生什么——所有 agent 决策都暴露为任务卡、产物、Diff、预览、Review 评论、下一步按钮，而不是 scrollback。

Roundtable is built for people who want to build with AI but do not want to operate like professional software engineers from day one. (See [`specs/000-overview.md`](../specs/000-overview.md) § Target users for the canonical list.)

| Persona | What they bring | What they need from Roundtable |
|---|---|---|
| **Non-code founder** validating a product idea | Strong intuition for the user problem; little or no coding background | A way to ship a working waitlist / landing / dashboard prototype this week, with reviewable code and a one-click deploy |
| **Designer or operator** building an internal tool | Visual sense, knows the workflow they want to support | A way to iterate UI in chat, see live previews, and hand off review to a separate "reviewer" voice rather than self-critique |
| **Student or creator** learning by making | Curiosity, willingness to break things | Multiple agent personalities to learn from; observable side-conversations so they see *how* agents reason about code |
| **Experienced vibe coder** | Already uses Cursor / Claude Code / v0 | Better orchestration, review, and maintenance than a single CLI can provide; specs and artifacts that survive past the first demo |

The user should be able to understand what's happening without reading raw terminal output. Roundtable exposes agent decisions as task cards, artifacts, diffs, previews, review comments, and next-step buttons — never as scrollback.

## 2. Jobs to be done / 用户要解决的问题

> **中文：** 我们瞄准 6 个 JTBD：(1) **一段对话从想法到能部署的原型** — 非程序员创始人不想纠结 Vue/React；(2) **不用自己管的多 AI 协调** — 任务横跨 UI/API/test/review 时；(3) **局部迭代不用重新解释整个项目** — 选中产物 → 说一句 → 看 Diff；(4) **看见并能编辑 agent 之间传递的上下文** — 被早期多 Agent 工具的静默上下文丢失坑过的高级用户；(5) **知道改这里会影响哪里** — 迭代到第二个版本之后；(6) **用自己已经信任的 Agent** — 已经吃 Claude Code 安利的人不想换。其中 (2)(4)(5) 是现有产品的空白，见 § 7。

The product is designed to nail these JTBDs:

1. **"Get me from idea to a working, deployable prototype in one chat session."** — Non-code founder; expects to skip Vue-vs-React decisions and see a previewable artifact in minutes.
2. **"Coordinate multiple AI specialists without managing them myself."** — Any user with a task that crosses UI / API / test / review.
3. **"Iterate on a specific piece without re-explaining the whole project."** — User selects an artifact, asks for a change, gets a versioned diff while the rest of the project stays put.
4. **"See and edit the context one agent passes to another."** — Power user who got burned by silent context loss in earlier multi-agent tools.
5. **"Know what depends on what, so I'm not surprised when I change something."** — Anyone iterating past the first ship.
6. **"Bring my own Coding Agent."** — Builder who already trusts a specific CLI; should not be forced to abandon it.

JTBDs 2, 4, and 5 are where Cursor / v0 / Bolt / Coze leave a gap (see [§ 7](#7-differentiation--差异化)).

## 3. Core experience / 核心体验

> **中文：** 五项能力构成主循环：**单聊**（1v1）、**群聊**（多 Agent + Orchestrator）、**产物预览与归属**、**HandoffCard**（可见的上下文交接）、**依赖变更徽章**。每项能力都有对应 spec 兜底（spec 010 / 020 / 030 / 040 / 050 / 060），下面的 5 个小节就按这五项展开。

Five capabilities make up the main loop. Each links to its authoritative spec.

### 3.1 Single chat — 1v1 with one Coding Agent / 单聊

> **中文：** 最简单的模式。用户挑一个 Agent（Claude Code / OpenCode / Codex / 自建），直接聊。Agent 跑在独立 workspace 里。输出按 thinking → text → tool 调用 → 文件变更 → 产物 → done 流式回来。当 Orchestrator 判定任务是 `complexity: single_agent` 时也走这条路——PM 在视觉上保持沉默，直接分派给单个 agent。

(See [`specs/000-overview.md`](../specs/000-overview.md), [`specs/020-adapter-protocol.md`](../specs/020-adapter-protocol.md).)

The simplest mode. User picks one agent (Claude Code, OpenCode, Codex, or a custom one they built) and chats. The agent runs in an isolated workspace at `workspaces/<chatId>/`. Output streams in: thinking → text → tool calls → file changes → artifacts → done.

Single chat is the fallback when the Orchestrator decides a task is `complexity: single_agent` — it dispatches directly to one agent without inserting itself in the visible chat.

### 3.2 Group chat — multi-agent with Orchestrator / 群聊

> **中文：** 用户开一个群，里面有多个 Agent，Orchestrator (PM) 永远在场但**默认沉默**。路由规则：明确 `@`某个 → 直送；不 `@` → PM Selector 选发言人（LLM 看上下文 + 置信度）；`@` 多个 → 并行触发多气泡；Agent 互相 `@` → 允许，深度 ≤ 2，PM 在超限时强制中断。PM 每轮跑 7 阶段（Intake → Clarify → Plan → Dispatch → Monitor → Review → Aggregate），Clarify 仅在歧义高时触发且只用结构化选项卡片，Review 对所有改代码任务都强制。Agent 之间的对话默认折叠成 `💬 talked 3 turns ▸`，可展开，可插话——这是评委强调的 HITL 入口。

(See [`specs/010-orchestrator.md`](../specs/010-orchestrator.md), [`specs/050-group-chat.md`](../specs/050-group-chat.md).)

User opens a group with multiple agents. The Orchestrator (PM) is always present but stays silent unless speaking adds value. Default routing:

- User `@specific-agent` → direct delivery, PM stays out.
- User says nothing about who → PM Selector picks the next speaker (LLM reads context + agent descriptions + confidence threshold).
- User `@`s multiple agents → parallel dispatch, multiple reply bubbles.
- Agent A `@`s Agent B → allowed, depth-2 limit; PM force-breaks at overflow.

The PM runs a 7-stage loop per turn: **Intake → Clarify → Plan → Dispatch → Monitor → Review → Aggregate**. Clarify is gated (only when ambiguity > threshold, max 3 questions, always as structured cards). Plan emits role-based tasks. Dispatch produces one live `TodoList` card. Review is mandatory for code-writing tasks before Aggregate.

Side-conversations between agents collapse into a single chip (`💬 @A and @B talked 3 turns ▸`) that expands inline. Every sub-thread offers an `Interject` button — the HITL entry point.

### 3.3 Artifact preview + ownership / 产物预览与归属

> **中文：** 7 种产物（code / diff / web_app / markdown / mermaid / html / spec）走一个统一 `<ArtifactRenderer>` 分发。每张产物卡片显示 owner 的颜色边框 + 头像 + 角色 tag。两个 Agent 改同一文件时，**Diff 按作者染色**——这一点现有任何产品都没做。版本是链表（`parentVersion`），不是新卡片，旧版本在 timeline 抽屉里。`web_app` 走 e2b 沙箱 live preview，URL 签名 + 时间受限；e2b 不可用或超预算时降级到 entrypoint 的 code view。

(See [`specs/040-artifact-types.md`](../specs/040-artifact-types.md), [`specs/050-group-chat.md`](../specs/050-group-chat.md) § (b).)

Seven artifact kinds render through a single `<ArtifactRenderer>`:

| Kind | Renderer | Live? |
|---|---|---|
| `code` | Monaco editor | static |
| `diff` | Monaco diff viewer, per-author colored | static |
| `web_app` | e2b sandbox `<iframe>` | **live** |
| `markdown` | `react-markdown` + GFM | static |
| `mermaid` | `mermaid` client lib | static |
| `html` | sandboxed `<iframe>` | static |
| `spec` | structured card (goal + acceptance checklist) | static |

Every artifact carries `agentId` + `agentColor`. Cards show a 1-pixel colored left border, the owner's avatar, and the role tag. When two agents edit the same artifact, the diff lines are colored per author — a feature no shipping product has today. Versions are a chain (`parentVersion`), not new cards; old versions live in a timeline drawer.

`web_app` runs in an e2b sandbox with a signed, time-bound URL. If e2b is unavailable or over quota, it degrades to a code view of the entrypoint.

### 3.4 HandoffCard — visible context transfer / 上下文交接卡

> **中文：** Agent 之间的每一次上下文交接都产出一张结构化 HandoffCard，字段包括 `userIntent` / `taskBrief` / `pinnedMessages` / `rolesInGroup` / 上一手摘要 / 相关产物引用（不内嵌）/ 全历史指针。在群里默认折叠成 `🔄 hand-off → @backend` 一行，点开看全部字段，`[✎ Edit]` 可以编辑后再 dispatch——"PM 给下一个 agent 传了错上下文" 这个失败模式从静默失败变成 5 秒钟用户可修复。支持 4 种场景：`dispatch`（PM→agent）、`agent_handoff`（agent→agent）、`join_group`（中途拉新 agent）、`cross_chat`（跨会话，仅 demo）。每次发生都写一行 `ai-logs/handoffs.jsonl`——产品有飞行记录仪。

(See [`specs/030-handoff-card.md`](../specs/030-handoff-card.md), [`ai-logs/decisions/ADR-003-handoff-card-format.md`](../ai-logs/decisions/ADR-003-handoff-card-format.md).)

Every cross-agent context transfer produces a `HandoffCard`. The card carries: `userIntent`, `taskBrief`, `pinnedMessages`, `rolesInGroup`, optional `previousAgent` summary + key outputs + open questions, `relevantArtifacts` (refs, not inlined), and a `fullHistoryRef` for fallback.

In the chat, the card renders as a collapsed one-liner (`🔄 hand-off → @backend`). Expand to inspect every field. `[✎ Edit]` lets the user mutate any field and re-dispatch — the failure mode "the PM passed wrong context to the next agent" becomes a 5-second user fix instead of a silent failure.

Four scenarios are supported: `dispatch` (PM to agent), `agent_handoff` (agent to agent), `join_group` (new agent invited mid-conversation), `cross_chat` (export from chat A, import to chat B — demo-grade only this sprint).

Every emission is appended to `ai-logs/handoffs.jsonl`. The product has a flight recorder.

### 3.5 Dependency-changed badge / 依赖变更徽章

> **中文：** Agent 在产物里主动声明上游依赖；Orchestrator 维护一个内存 + Postgres 的依赖图。上游产物涨版本时，下游卡片自动出现红色徽章 **⚠️ dependency changed**，一键 `[Ask @owner to sync]` 自动生成预填的 HandoffCard 召回下游 Agent。侧边栏一个可折叠的 mini-graph（React Flow）显示活的依赖图，点节点跳产物。环依赖在 v1 渲染红边 + 提示。**这一项是把 Roundtable 从"多 Agent 并行"升级到"多 Agent 协作"的分水岭**——Cursor / v0 / Bolt / Coze 都没把产物依赖做成一等公民。

(See [`specs/060-dependency-graph.md`](../specs/060-dependency-graph.md).)

Artifacts declare their upstream dependencies. The Orchestrator maintains an in-memory + Postgres-backed graph. When an upstream artifact bumps version, downstream cards surface a red badge: **⚠️ dependency changed**. One-click action: `[Ask @<owner> to sync]` — produces a HandoffCard pre-filled with the upstream change summary, the downstream owner agent comes back into the chat.

A collapsible sidebar mini-graph (React Flow) shows the live dependency picture; clicking a node deep-links to the artifact. Cycle warnings render in red with a tooltip.

This is the single feature that makes Roundtable a multi-agent **collaboration** platform rather than a parallel-execution platform. No shipping product (Cursor / v0 / Bolt / Coze) has first-class artifact dependencies.

## 4. User stories with wireframes / 用户故事 + 草图

> **中文：** 三个故事覆盖三种典型路径。**Story A**（非程序员创始人在一段对话内做出可部署的 waitlist）演示 Orchestrator 7 阶段 + 单 TodoList 分派 + 私聊折叠 + 强制 Review + Quick Action 部署。**Story B**（设计师改按钮颜色看 live preview）演示单 Agent 直分派 + 内联 Diff 卡 + e2b 沙箱预览 + 产物版本链 + 轻量 Reviewer pass。**Story C**（30 轮后用户中途请 @security）演示 `join_group` HandoffCard + Pin 消息 + 产物引用而非内嵌 + 用户在 Agent 启动前编辑上下文。**Wireframe 是 ASCII 草图，到 W3 抛光时可能升级到 Figma 截图**。

### Story A — Non-code founder ships a waitlist page (single → group) / 创始人做 waitlist

**Persona:** First-time founder validating a B2B SaaS waitlist concept. No code background.
**Persona（中文）：** 第一次创业的 B2B SaaS 创始人，没编程背景，要在一段对话里做出能部署的 waitlist 落地页（带邮箱抓取 + 一个能跑的 API + 一个通过的测试）。

```
┌─ Roundtable ────────────────────────────────────────────────────────────┐
│ Chats          │ # waitlist-mvp                                          │
│ ● waitlist-mvp │ ─────────────────────────────────────────────────────── │
│ ○ side-tool    │                                                         │
│                │  You:  Build me a waitlist landing page that captures   │
│                │        email + company size. Should look modern.        │
│                │                                                         │
│                │  👑 PM (silent — picking team)                          │
│                │                                                         │
│                │  👑 PM:                                                 │
│                │  ┌──────────────────────────────────────────────┐       │
│                │  │  Splitting into 3 tasks. Dispatched:         │       │
│                │  │  ☐ T2  @implementer  POST /api/waitlist  🚀  │       │
│                │  │  ☐ T1  @implementer  Landing UI          ⏳  │       │
│                │  │  ☐ T3  @reviewer     Diff review         ⏳  │       │
│                │  │  [Show plan]                                 │       │
│                │  └──────────────────────────────────────────────┘       │
│                │                                                         │
│                │  🟦 @implementer wrote LandingPage.tsx        v1  ▸   │
│                │  🟩 @implementer wrote /api/waitlist.ts       v1  ▸   │
│                │                                                         │
│                │  💬 @implementer and @reviewer talked 2 turns  ▸        │
│                │                                                         │
│                │  🟪 @reviewer  ReviewCard                        ▸     │
│                │                                                         │
│                │  👑 PM:                                                 │
│                │  ✅ Three artifacts shipped. Review left one nit.       │
│                │  [Preview]  [Fix review note]  [Deploy to Vercel]       │
│                └─────────────────────────────────────────────────────────┘
```

**What this story exercises:** Orchestrator 7-stage loop, single-`TodoList` dispatch, side-conversation collapse, mandatory review pass, Quick Actions in Aggregate. Implementations: issues #2, #5, #6, #4, #14, #12, #11.
**中文：** 演示 7 阶段循环 + 一条 TodoList 派完所有单 + 私聊折叠 + 强制 Review + Aggregate 给 Quick Action。涉及 issue #2 / #5 / #6 / #4 / #14 / #12 / #11。

### Story B — Designer iterates with a live preview and reviewer pass / 设计师改按钮颜色

**Persona:** Product designer building a feedback widget. Has design instincts but doesn't want to write the integration code.
**Persona（中文）：** 在做 feedback widget 的产品设计师。视觉直觉好，不想自己写集成代码。要把 submit 按钮换成品牌蓝并立刻在 live preview 里验证，整个过程不需要重新解释项目。

```
┌─ Roundtable ────────────────────────────────────────────────────────────┐
│ # feedback-widget · Group: @implementer, @reviewer                       │
│ ─────────────────────────────────────────────────────────────────────── │
│                                                                          │
│  [v1 FeedbackWidget — sandbox preview]                                   │
│  ┌──────────────────────────────────────────────┐                        │
│  │  ╭─ feedback widget mock ─────────╮          │                        │
│  │  │  How was your experience?      │          │   ▸ Open in drawer    │
│  │  │  [submit]      ← green button  │          │   ▸ View code         │
│  │  ╰────────────────────────────────╯          │                        │
│  └──────────────────────────────────────────────┘                        │
│                                                                          │
│  You:  Make the submit button blue, same hex as our brand (#3b82f6).    │
│                                                                          │
│  👑 PM:  routing → @implementer  (no clarify needed)                    │
│                                                                          │
│  🟦 @implementer  edited FeedbackWidget.tsx                             │
│  ┌──────────────────────────────────────────────┐                        │
│  │  Diff · 2 lines · +1 -1                      │                        │
│  │  - className="bg-green-500 text-white …"     │                        │
│  │  + className="bg-[#3b82f6] text-white …"     │                        │
│  │                                              │                        │
│  │  [Preview v2]  [Apply]  [Discard]            │                        │
│  └──────────────────────────────────────────────┘                        │
│                                                                          │
│  [v2 FeedbackWidget — sandbox preview, button now blue]                  │
│  🟪 @reviewer:  ✓ Color matches brand token. No regressions.            │
└──────────────────────────────────────────────────────────────────────────┘
```

**What this story exercises:** single-agent direct dispatch (no PM noise), inline diff card, e2b sandbox preview, artifact versioning, lightweight reviewer pass. Implementations: issues #3, #12, #15, #42.
**中文：** 演示单 Agent 直分派（PM 不刷屏）+ 内联 Diff 卡 + e2b 沙箱预览 + 产物版本链 + 轻量 Reviewer pass。涉及 issue #3 / #12 / #15 / #42。

### Story C — Mid-project, user invites @security to audit / 中途请 @security 加入

**Persona:** Experienced vibe coder, 30+ turns into building a login flow. Wants a security review without restarting context.
**Persona（中文）：** 资深 vibe coder，已经在登录流程上聊了 30 多轮。想拉一个新的 @security agent 做安全审计，但不想把 30 轮历史再讲一遍。

```
┌─ Roundtable ────────────────────────────────────────────────────────────┐
│ # login-flow · Group: @architect, @implementer, @reviewer                │
│ ─────────────────────────────────────────────────────────────────────── │
│                                                                          │
│  …(30 turns of history above)…                                           │
│                                                                          │
│  You:  @security audit the login flow we built.                          │
│                                                                          │
│  👑 PM:                                                                  │
│  Adding @security to the group.                                          │
│  Building hand-off context — 1 sec…                                      │
│                                                                          │
│  ┌─ 🔄 PM → @security  (join_group) ─────────────────┐                   │
│  │                                                    │                  │
│  │  Task:  Security audit the auth flow we just      │                  │
│  │         shipped. Focus on session token storage.  │                  │
│  │                                                    │                  │
│  │  📌 Pinned constraints                            │                  │
│  │     • Deploy target: Vercel + Postgres            │                  │
│  │     • Must support i18n                           │                  │
│  │                                                    │                  │
│  │  💬 Project summary (built by PM, editable)       │                  │
│  │     30 turns of work. Built: LoginForm.tsx,       │                  │
│  │     /api/login.ts, login.test.ts. Reviewer        │                  │
│  │     already cleared. No deploy yet.               │                  │
│  │                                                    │                  │
│  │  📎 Relevant artifacts (refs only)                │                  │
│  │     [LoginForm.tsx v3] [api/login.ts v2]          │                  │
│  │     [session-store.ts v1]                         │                  │
│  │                                                    │                  │
│  │  [✎ Edit hand-off]   [Expand full history]        │                  │
│  └───────────────────────────────────────────────────┘                  │
│                                                                          │
│  🟧 @security:  Found 2 issues. Drafting ReviewCard…                    │
└──────────────────────────────────────────────────────────────────────────┘
```

**What this story exercises:** `join_group` HandoffCard scenario, pinned messages, artifact references (not inlined), user can edit context before agent runs. Implementations: issues #13, #39, #44.
**中文：** 演示 `join_group` HandoffCard + Pin 消息 + 产物引用而非内嵌 + 用户在 Agent 启动前编辑上下文。涉及 issue #13 / #39 / #44。

## 5. Out of scope / 非目标

> **中文：** 明确不做的事：通用 LLM 助手 / 节点编排画布 / 模型路由服务 / 一次性网站生成器 / PM 自动生成新 Agent（ADR-007）/ 跨会话 hand-off 的生产级 / 用户编写 skills 的市场。这一节是给评委一个清晰的边界，避免被反问"为啥不做 X"时被动。

(See [`specs/000-overview.md`](../specs/000-overview.md) § Non-goals for the canonical list.)

- **Generic LLM chat client.** Roundtable is opinionated about coding workflows. No general assistant mode.
- **Workflow builder / node-graph editor.** Coordination comes from chat + Orchestrator, not a canvas.
- **Model routing service.** Agents bring their own model; we orchestrate them.
- **One-shot website generator.** We optimize for projects that survive past their first demo; specs, diffs, dependencies, reviews are all preserved.
- **Dynamic agent spawning.** PM may suggest new agents via Quick Action, but cannot instantiate without user confirmation. (ADR-007.)
- **Cross-chat hand-off in production.** Demo-grade only this sprint; revisit after submission.
- **Marketplace for user-authored skills.** v1 ships built-in skills; sharing is a later question.

## 6. Success metrics / 成功指标

> **中文：** 按课题评分维度（**AI 协作 30% / 功能完整 25% / 生成质量 20% / 代码理解 15% / 创新与产品感 10%**）逐项给出可验证的交付标准。工程目标按 spec 验收条件落地：D5 单聊端到端、D10 双 Adapter 群聊、D14 HandoffCard live + ≥ 4 种产物类型、所有 system prompt < 8k token（spec 030 守门）、用户停止时 `interrupt()` 1 秒内传播（spec 010）、多作者 Diff ≥ 2 种染色。

This sprint's success bar (3 weeks, 3-person team) is judged on the course rubric — 30% AI collaboration capability, 25% functional completeness, 20% output quality, 15% code understanding (defense Q&A), 10% innovation and product sense.

| Dimension | Target | How we'll know |
|---|---|---|
| **Functional completeness** | All five core capabilities (§ 3) demonstrably work in the 3-min demo video | Issue #19 storyboard, Day 19 freeze validates each capability against its spec acceptance criteria |
| **Output quality (UI + artifact preview)** | Group chat + handoff + dep-changed badge + live sandbox preview all land in one ≤ 30s demo beat | Story A is the canonical sequence; ≥ 60fps render budget; no fallback paths visible in the demo cut |
| **AI collaboration record** | ≥ 8 ADRs each with an "AI assistance" field; full `ai-logs/handoffs.jsonl` from a real run; ≥ 3 incidents documented in `incidents.md`; `ai-pm-playbook.md` shipped | Grader can open `ai-logs/` and trace any decision back through the AI exchange that shaped it |
| **Code understanding (defense Q&A)** | Each team member can answer architecture questions for their layer in ≤ 30s | Walk-the-stack rehearsal Day 20; each layer's owner explains contracts → adapter → orchestrator → UI |
| **Innovation and product sense** | HandoffCard + Dependency badge + Multi-author diff coloring + Skills-as-spec dual-purpose: four things no shipping product has | Differentiation table (§ 7) is the proof; Story C is the demo of editable context transfer |

Engineering targets (from spec acceptance criteria):

- Single-chat happy path runs end-to-end on Day 5.
- Group chat with two adapters runs end-to-end on Day 10.
- HandoffCard live + ≥ 4 artifact kinds rendering on Day 14.
- All system prompts ≤ 8k tokens before user input (spec 030 token guard).
- `interrupt()` propagates to every active session within 1s of user stop (spec 010).
- Multi-author diff renders ≥ 2 distinct author colors (spec 040 / 050).

## 7. Differentiation / 差异化

> **中文：** Cursor 强在 IDE 内深度编辑但单 Agent 无群协作；v0 一次性生成强但不支持迭代和 review；Bolt 全栈预览强但没分角色 review；Coze 是节点画布而非 chat-first 而且没产物依赖。Roundtable 的护城河（现有产品没一个完整复刻的 4 件事）：**多作者 Diff 染色 / HandoffCard 一等公民 / 产物依赖图 / Skills 双用（开发 + 运行时）**。

(See also [`specs/000-overview.md`](../specs/000-overview.md) § Product stance.)

| Tool | What it nails | What it lacks for our user | Where Roundtable wins |
|---|---|---|---|
| **Cursor** | IDE-grade in-context edits; deep file understanding | Single-agent loop; no group coordination; no visible hand-off; built for engineers who already read code | Multi-agent group with PM coordination; non-engineer-friendly chat surface; visible hand-offs |
| **v0 (Vercel)** | One-shot UI gen from a prompt; great first-shot fidelity | One-shot, not iterative; no project maintenance; no review pass; single model | Project lifetime support (specs, versions, dep graph); review-mandatory loop; multi-CLI orchestration |
| **Bolt** | Full-stack web in browser; e2b-style live preview | Single agent; no observable reasoning; no review separation | Group chat + reviewer role; observable side-conversations; per-agent artifact ownership |
| **Coze** | Workflow canvas + bots; reusable nodes | Node-graph editor (not chat-first); no per-artifact dependency graph; weak handoff semantics | Chat-first IM metaphor; first-class HandoffCard + dependency badge; SDLC role model |
| **Roundtable** | (us) | (not for high-frequency single-file refactor work — Cursor is faster) | Group-chat semantics for agents; visible & editable hand-offs; artifact dependency graph; skills as dual-purpose dev+runtime convention |

The four things no shipping product has, all of which Roundtable ships:

1. **Multi-author diff coloring** — when two agents edit the same file, each author's lines are colored distinctly.
2. **HandoffCard as a UI surface** — the context one agent passes to another is inspectable and editable.
3. **First-class artifact dependency graph** — declared by agents, visualized in a sidebar, broadcasts on change.
4. **Skills-as-spec dual-purpose** — the same `skills/` files guide our team's Claude Code AND the product's runtime agents.

## 8. Spec backlink index / Spec 索引

> **中文：** 每项能力到 spec 和 ADR 的映射表，方便审阅时直接跳。

| Capability | Spec | ADR(s) |
|---|---|---|
| Product overview / 产品总览 | [`specs/000-overview.md`](../specs/000-overview.md) | — |
| Orchestrator state machine / Orchestrator 状态机 | [`specs/010-orchestrator.md`](../specs/010-orchestrator.md) | [ADR-001](../ai-logs/decisions/ADR-001-choose-langgraph-over-autogen.md) |
| Agent adapter protocol / Adapter 协议 | [`specs/020-adapter-protocol.md`](../specs/020-adapter-protocol.md) | [ADR-002](../ai-logs/decisions/ADR-002-claude-code-cli-vs-api.md) |
| HandoffCard / 上下文交接卡 | [`specs/030-handoff-card.md`](../specs/030-handoff-card.md) | [ADR-003](../ai-logs/decisions/ADR-003-handoff-card-format.md) |
| Artifact types & rendering / 产物类型与渲染 | [`specs/040-artifact-types.md`](../specs/040-artifact-types.md) | — |
| Group chat routing / 群聊路由 | [`specs/050-group-chat.md`](../specs/050-group-chat.md) | — |
| Dependency graph / 依赖图 | [`specs/060-dependency-graph.md`](../specs/060-dependency-graph.md) | — |
| Skills system / Skills 系统 | [`specs/070-skills-system.md`](../specs/070-skills-system.md) | — |
| Why PM cannot self-spawn agents / PM 不能自动生成 Agent | — | [ADR-007](../ai-logs/decisions/ADR-007-pm-cannot-create-new-agents.md) |
| Original brainstorm (history, not spec) / 脑爆档案 | [`ai-logs/brainstorms/2026-05-21-roundtable-architecture.md`](../ai-logs/brainstorms/2026-05-21-roundtable-architecture.md) | — |

## Changelog / 修订记录

- 2026-05-27 — initial draft (@AntaresYuan, with Claude Opus 4.7). Bilingual treatment added in v1.1.  / 初稿（@袁晨杰 + Claude Opus 4.7）；v1.1 加入双语处理。Sources: brainstorm archive + specs 000/010/020/030/040/050/060/070 + ADR-001/002/003/007.
