# 🟦 Roundtable / 圆桌

> **IM 式多 Agent 协作平台** —— 像拉群一样把多个 Coding Agent 请到一张圆桌：PM Agent 理解意图、拆解任务、按工作流分派与聚合；每一次 Agent 交接都是一张**可见可编辑的 HandoffCard**，产物带 owner 与版本，依赖关系可视化。
>
> **一句话押注**：把"群聊语义"搬给 Agent —— `@` 路由、产物归属、可见交接、依赖图，这四件 Cursor / v0 / Bolt / Coze 没一个完整做的事。

> 🏆 **字节跳动 AgentHub 课题 · 多 Agent 协作平台**

<p>
🎬 <b>Demo 视频</b>：【上传后贴链接，脚本见 <code>docs/demo/video-plan.md</code>】 ·
✅ <b>测试</b>：orchestrator 114 + 适配器套件全绿，CI 主干绿 ·
🧩 <b>技术栈</b>：Next.js 15 · LangGraph.js · tRPC · Drizzle/Postgres · 多 Provider ·
🤖 <a href="#七-agent-友好--ai-协作开发记录">Agent 友好仓库</a>
</p>

> 📄 本文件是飞书提交文档的**母版**，整体复制进飞书后调排版即可；`【】` 为需手填占位。

---

## 目录

- [一、项目介绍（一眼看懂）](#一项目介绍一眼看懂)
- [二、Demo 视频](#二demo-视频)
- [三、快速开始](#三快速开始)
- [四、产品介绍（详细）](#四产品介绍详细)
- [五、技术架构（详细）](#五技术架构详细)
- [六、仓库结构](#六仓库结构)
- [七、🤖 Agent 友好 / AI 协作开发记录](#七-agent-友好--ai-协作开发记录)
- [八、评分维度自评 & 证据索引](#八评分维度自评--证据索引)
- [九、团队分工](#九团队分工)
- [十、关键决策 & 可改进点](#十关键决策--可改进点)
- [十一、致谢 / 引用与依赖 / AI 使用声明](#十一致谢--引用与依赖--ai-使用声明)

---

## 一、项目介绍（一眼看懂）

**字节跳动 AgentHub 课题**：开发一个**多 Agent 协作平台**，以 IM 聊天为核心交互范式——用户像用飞书/微信一样，通过新建对话、发消息与不同 AI Agent 交互。课题原文要求：

> 平台采用 IM 聊天作为核心交互范式，每个 Agent 是一个"聊天对象"。支持：新建对话选择 Agent、多会话并行、**群聊协作（@ 多个 Agent 由 Orchestrator 自动协调分工）**、上下文连续、产物内联预览。平台**同时接入市面主流 Agent 平台（Claude Code、Codex、OpenCode 等）**，通过统一适配器层屏蔽差异，并支持用户自建 Agent。
> **考察权重**：AI 协作能力 30% · 功能完整度 25% · 生成效果质量 20% · 代码理解度 15% · 创新与产品感 10%。
> **交付物**：产品设计文档 + 技术文档 + 可运行 Demo + AI 协作开发记录 + 3 分钟 Demo 视频。

我们打造的产品叫 **Roundtable（圆桌）**。

**一句话核心亮点**：它不是"多个 Agent 各干各的"，而是把**"一个团队怎么协作"**这件事做成产品——分工、交接、依赖、质检如何**不在聊天记录里失传**。单 Agent 工具解决"一个人干活"，Roundtable 解决"一个团队干活"。

**主要功能（用户路径）**：新建对话/拉群 → 一个聊天框说需求 → `@` 点名某 Agent 直达，或不点名由 PM 智能选发言人 → PM 用 **7 阶段**理解→规划→分派→质检→聚合（默认沉默不刷屏）→ 真实模型产出**带 owner 染色 + 版本链**的产物卡（代码/Diff/网页 live preview）→ 每次交接落一张**可编辑的 HandoffCard** → 产物依赖变更时下游卡片亮 **⚠️ 徽章**一键召回。

**如何满足课题要求**：① IM 群聊 + `@mention` 路由 + Orchestrator 自动协调（真实可跑）；② **≥2 真实 Agent 平台**——统一适配器层接入 **Claude Code + Codex**，按角色 env 绑定；③ 上下文连续（聊天历史 + pin 约束注入每次规划）；④ 产物内联预览（7 种产物 + e2b 沙箱 live preview）；⑤ 用户自建 Agent（System Prompt + 能力集，落库）。

**技术栈简述**：Next.js 15 (App Router) 前端工作台 + tRPC + Drizzle/Postgres；`src/orchestrator` 用 LangGraph.js 跑 7 阶段编排；`src/adapters` 统一 `AgentAdapter` 契约接入多个 CLI Agent；Vercel AI SDK 做 provider-agnostic 模型层（火山引擎 / DeepSeek / OpenAI / Anthropic / MiniMax，env 一行切换）。**降级永不白屏**：无 key 或模型不可达时落到确定性启发式，demo 主链路不崩。

---

## 二、Demo 视频

> 🎬 **【上传后贴链接】** —— 拍摄脚本/逐镜计划见 [`docs/demo/video-plan.md`](../docs/demo/video-plan.md)（目标 / 逐镜步骤 / 逐字稿 / 功能覆盖核对表）。

视频走通核心场景：一位非程序员用户，从"帮我做个带邮箱收集的落地页"出发 → PM 拆成并行任务 → 多 Agent 分别产出带染色的产物卡 → Review → 聚合 → 预览，全程不看终端。

---

## 三、快速开始

需要 **Node.js 20+ 与 Docker**。

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run setup        # Docker 起 Postgres/Redis + 迁移 + 种子数据
corepack pnpm ui:dev           # 打开 http://localhost:3000
```

接入真实生成（可选）：复制 `.env.example` 为 `.env`，填入任一 Provider 的 key（默认 `ROUNDTABLE_LLM_PROVIDER`，支持火山/DeepSeek/OpenAI/Anthropic/MiniMax，env 一行切换）。第二个 Agent 平台用 Codex 时按角色绑定：`ROUNDTABLE_ADAPTER_REVIEWER=codex`。

```bash
corepack pnpm test             # vitest（orchestrator 114 + 适配器套件等）
corepack pnpm lint             # eslint
corepack pnpm typecheck        # tsc --noEmit
```

---

## 四、产品介绍（详细）

> 详版见 [`docs/prd.md`](../docs/prd.md)（双语 PRD）与 [`specs/000-overview.md`](../specs/000-overview.md)。

### 4.1 目标用户

| 用户 | 诉求 |
|---|---|
| **非程序员创始人** | 一段对话内做出可部署原型（waitlist / 落地页 / dashboard），代码可 review、一键部署 |
| **设计师 / 运营** | 在聊天里迭代 UI、看 live preview，把 review 交给独立的"reviewer 嗓音"而非自我批判 |
| **学生 / 创作者** | 多个 Agent 人格可学习；可观察的私聊旁观，看见 Agent **怎么**推理代码 |
| **资深 vibe coder** | 比单 CLI 更好的编排 / review / 维护；spec 与产物能活过第一个 demo |

> **核心原则：用户永远不用读终端日志。** 所有 Agent 决策都暴露为任务卡 / 产物 / Diff / 预览 / Review 评论 / 下一步按钮。

### 4.2 核心体验（5 大能力，每项有 spec 兜底）

**① 单聊（1v1）** — 选一个 Agent 直接聊，跑在隔离 workspace；输出按 `thinking → text → tool → file_change → artifact → done` 流式回来。PM 判定 `single_agent` 时也走这条（PM 视觉沉默）。

**② 群聊（多 Agent + Orchestrator）** —
- **路由**（spec 050）：`@某个` 直送；不提名 → Selector 选发言人；`@` 多个 → 并行多气泡；Agent 互 `@` 深度 ≤ 2。
- **7 阶段编排**：Intake → Clarify → Plan → Dispatch → Monitor → Review → Aggregate。Clarify 仅歧义时触发、最多 3 问、用结构化选项卡；Review 对改代码任务强制。
- **可观察**：Agent 私聊默认折叠成 `💬 talked N turns ▸`，可展开、可插话（HITL 入口）。

**③ 产物预览 + 归属** — 7 种产物走一个 `<ArtifactRenderer>` 分发：

| 产物 | 渲染 | 实时 |
|---|---|---|
| `code` | Monaco | 静态 |
| `diff` | Monaco diff，**按作者染色** | 静态 |
| `web_app` | e2b 沙箱 `<iframe>` | **live** |
| `markdown` / `mermaid` / `html` / `spec` | 各自渲染器 | 静态 |

> 每张卡带 owner 颜色 + 头像 + 角色 tag；**多 Agent 改同一文件时 Diff 按作者染色**；版本是链表（`parentVersion`），旧版收在 timeline 抽屉。

**④ HandoffCard（可见的上下文交接）** — 每次跨 Agent 交接产出结构化卡片（`userIntent` / `taskBrief` / `pinnedMessages` / `rolesInGroup` / 上一手摘要 / 相关产物引用 / 全历史指针）。群里折叠成 `🔄 → @backend`，`[✎ Edit]` 可改后再分派——"PM 传错上下文"从静默失败变成 **5 秒可修**。4 种场景：`dispatch` / `agent_handoff` / `join_group` / `cross_chat`。每次写一行 `ai-logs/handoffs.jsonl`。

**⑤ 依赖变更徽章** — Agent 声明上游依赖，Orchestrator 维护内存 + Postgres 依赖图；上游涨版本 → 下游卡片亮 **⚠️ dependency changed** + 一键 `[Ask @owner to sync]`（自动生成预填 HandoffCard 召回下游）。侧边栏 React Flow mini-graph。

### 4.3 核心差异化（护城河）

**4 件现有产品没人完整做的事，Roundtable 全部落地：**

1. **多作者 Diff 染色** — 两个 Agent 改同一文件，按作者分色显示哪几行是谁改的。
2. **HandoffCard 作为可见可编辑的 UI** — Agent 间传递的上下文不再是黑盒，可看、可改、可追溯。
3. **一等公民产物依赖图** — 由 Agent 声明、侧边栏可视化、变更时广播徽章。
4. **Skills 双用** — 同一份 `skills/` 既驱动我们团队的 Claude Code，又是产品运行时 Agent 的工作手册。

| 对手 | 强在 | 对我们用户的短板 |
|---|---|---|
| **Cursor** | IDE 内深度编辑 | 单 Agent、无群协作、无可见交接 |
| **v0** | 一次性 UI 生成 | 不可迭代、无 review、单模型 |
| **Bolt** | 全栈浏览器预览 | 单 Agent、无分角色 review |
| **Coze** | 节点画布 + bots | 非 chat-first、无产物依赖图、交接语义弱 |

### 4.4 如何满足课题要求 + 额外做的

| 课题要求 | 我们的实现 |
|---|---|
| IM 群聊 + @ 多 Agent + Orchestrator 自动协调 | 群聊 + `@mention` 路由（直达/Selector 选发言人）+ 7 阶段 PM 编排，真实可跑 |
| 接入 ≥2 主流 Agent 平台 + 统一适配器层 | `AgentAdapter` 契约接入 **Claude Code + Codex**（按角色 env 绑定），加新平台照 `skills/add-agent-adapter` |
| 上下文连续 | 聊天历史自动随 turn 注入；pin 约束（工作台级/会话级）注入每次规划 |
| 产物内联预览 | 7 种产物 `<ArtifactRenderer>` 分发，`web_app` 走 e2b 沙箱 live preview |
| 用户自建 Agent | 对话式自建（System Prompt + 能力集，落库） |

**要求之外我们还做了**：HandoffCard 可见可编辑交接 + 上下文预算审计、产物依赖图 + 变更徽章、多作者 Diff 染色、可定制 Workflow 编辑器直接驱动调度、运行时自动写 `handoffs.jsonl` 飞行记录、降级永不白屏。

---

## 五、技术架构（详细）

> 详版见 `specs/`（11 份功能 spec + `specs/agents/`）与 `ai-logs/decisions/`（10 份 ADR）。

### 5.1 分层

```
Next.js 15 (App Router) ── tRPC ── Drizzle + Postgres
        │                              │
   src/ui (React)              src/server (路由/权限/限流/隔离)
        │                              │
   /api/orchestrator/* ── src/orchestrator (LangGraph: intake→plan→dispatch→review→aggregate)
                                       │
                          src/adapters (统一 AgentAdapter 契约)
                          ├─ claude-code  (CLI stream-json 桥)
                          ├─ codex        (codex exec --json, 按角色 env 绑定)
                          └─ local-dispatch (离线兜底)
```

| 层 | 职责 |
|---|---|
| `src/contracts`（zod 合约层）| 三大 schema 冻结：`AgentEvent` / `Artifact` / `HandoffCard`，跨层数据先过 zod，UI 与编排彻底解耦 |
| `src/adapters`（适配器层）| 把不同 Agent runtime 包成一种 `AsyncIterable<AgentEvent>`，Orchestrator 不关心下游是谁 |
| `src/orchestrator`（LangGraph）| 7 阶段状态机，节点纯函数、图只接线 |
| `src/server`（tRPC）| 路由 / 权限 / 限流 / 实时 turn 调度 / workspace 隔离 |
| `src/ui`（React）| 群聊 UI / 产物卡 / Diff / Sandbox iframe，按 `event.type`、`artifact.kind` 无脑分发 |

### 5.2 事件流契约（最关键的解耦点，spec 020）

所有 Agent 输出统一为 `AgentEvent` 判别联合（10 类）：`thinking_delta` · `text_delta` · `tool_use` · `tool_result` · `file_change` · `artifact` · `declare_dependency` · `propose_skill` · `done` · `error`。三原则：**流式优先**（全 `AsyncIterable`）· **平坦可序列化**（走 SSE/WS）· **`declare_dependency` 一等事件**（给 Orchestrator 直接消费）。

### 5.3 Orchestrator 7 阶段（spec 010）

`Intake`（意图分类）→ `Clarify`（仅歧义，结构化选项卡）→ `Plan`（按角色拆任务 + 依赖 + 并行/串行）→ `Dispatch`（一条 TodoList + 生成 HandoffCard）→ `Monitor`（沉默盯，失败自动重试/降级）→ `Review`（改代码强制，评论锚定 artifact）→ `Aggregate`（简短汇总 + Quick Action）。SDLC 角色：`@architect / @planner / @implementer / @reviewer / @fixer`。

### 5.4 适配器协议（≥2 真实平台，spec 020）

统一接口 `createSession(opts) → session.send(input): AsyncIterable<AgentEvent>` + `interrupt()` / `close()`。

| 平台 | 接入方式 |
|---|---|
| **Claude Code** | spawn `claude -p --output-format stream-json`，stream-json → `AgentEvent` |
| **Codex** | spawn `codex exec --json`，prompt 走 stdin、JSONL → `AgentEvent`，按角色 env 绑定（详见 `specs/agents/codex.md`） |
| **local-dispatch** | 离线兜底 |

> 加新适配器照 `skills/add-agent-adapter` + `examples/adapter-template`，event-mapper 是唯一放厂商类型的地方。

### 5.5 @mention 路由（Selector 接入实路径，spec 050）

显式 `@` → 死锁直达；不提名 → Selector（有 key 用 LLM、否则启发式）按上下文选发言人、置信度低则反问；复杂需求才回落 PM 全量拆解。

### 5.6 关键设计决策（全部有 ADR）

| 决策 | 取舍 |
|---|---|
| LLM Provider 无关 | `defaultOrchestratorModel()` 单点选型，5 家一行 env 切换（ADR-004） |
| 降级永不白屏 | 模型不可达落确定性启发式 + `degraded` 标记，主链路不 500 |
| HandoffCard 即产品对象 | 交接可编辑、可跨会话导出/导入（spec 030 / ADR-003） |
| 工作流即 spec 非画布 | Workflow 是结构化定义直接驱动调度（ADR-009） |
| PM 不能自动生成 Agent | 只能建议，用户确认才实例化（ADR-007） |

### 5.7 数据与隔离

Drizzle + Postgres：`users / chats / messages / artifacts / handoffs / sessions / pinned_messages / workbenches`。每会话一个隔离 workspace；适配器会话文件落 `.roundtable/sessions/`；拒绝 workspace 外的绝对路径写入（spec 020）。

---

## 六、仓库结构

```
src/
├── contracts/     AgentEvent / Artifact / HandoffCard 等 zod 合约（跨层真相源）
├── adapters/      统一 AgentAdapter：claude-code / codex / local-dispatch / mock
├── orchestrator/  LangGraph 7 阶段节点 + selector + 依赖图 + handoff
├── server/        tRPC 路由 / 实时 turn 调度 / workspace 隔离
├── ui/            群聊 UI / 产物卡 / Diff / Sandbox（React）
└── app/           Next.js App Router（/ 与 /gallery + /api/orchestrator/*）
specs/             11 份功能 spec（000–100）+ specs/agents/（适配器 agent spec）
ai-logs/           decisions/（10 ADR）· incidents.md · handoffs.jsonl（运行时自动写）
skills/            5 个 Anthropic Skills（接适配器 / 调 prompt / 调试 stream-json …）
rules/             团队协作约定（ai-collaboration / commit / pr / code-review）
examples/          adapter-template（加新 Agent 的脚手架）
CLAUDE.md/AGENTS.md  Agent 入职文档
```

---

## 七、🤖 Agent 友好 / AI 协作开发记录

> 这一节直接对应课题 **AI 协作能力（30%）**。我们把"怎么和 AI 协作"本身做成了仓库一等公民。详版见 [`rules/ai-collaboration.md`](../rules/ai-collaboration.md) 与 `ai-logs/`。

### 7.1 七根支柱

| 沉淀物 | 位置 | 说明 |
|---|---|---|
| 协作规范 | `CLAUDE.md` / `AGENTS.md` / `rules/` | Agent 入职文档：读取顺序、代码风格、commit/PR 规范 |
| Spec 体系 | `specs/000–100` + `specs/agents/` | 11 份功能 spec + 适配器 agent spec，AI 实现前先对齐、spec 错了同 PR 改 |
| Skills | `skills/`（5 个） | Anthropic Skills 格式，**开发期指导 AI + 运行期作为产品能力复用** |
| 决策记录 | `ai-logs/decisions/`（10 ADR） | 关键选型完整论证，每份带 **"AI assistance"** 字段 |
| 翻车记录 | `ai-logs/incidents.md` | AI 错误输出 + prompt + 教训，原样保留 |
| 运行时证据 | `ai-logs/handoffs.jsonl` | **产品运行时自动写入**的真实交接记录，不是手工整理 |

### 7.2 协作规范要点（`rules/ai-collaboration.md` 节选）

- **何时问 AI vs 团队** — 实现/重构/测试/查 API → AI；架构/产品取舍/时间换范围 → 团队拍板。
- **必记三样** — 架构决策 → `ADR-NNN`；浪费时间的 AI 错误 → `incidents.md`；好 prompt → `prompt-history/`。
- **AI 出错时** — ① 记 incident ② 加守卫（测试/lint/类型）③ 不静默改，diff 留 `// AI proposed X; changed to Y because Z` ④ 同类错 ≥3 次写进 `AGENTS.md`/spec。
- **署名铁律** — commit 不带 `Co-Authored-By: Claude`，只挂人类作者。
- **pre-commit** — `pnpm lint && test` 钩子强制；改接口同 commit 改 spec；改结构同 commit 改 `AGENTS.md`。

### 7.3 离线可跑、测试即规格

默认有 `local-dispatch` 兜底 + 降级启发式，**无 key 也能端到端演示链路**；`specs/` 是实现前的对齐契约、`tests/` 是可执行的行为规格，改动以"跑绿"为验收。

---

## 八、评分维度自评 & 证据索引

| 维度 | 我们的答卷 | 去哪看证据 |
|---|---|---|
| **AI 协作 (30%)** | 规范/spec/skills/ADR/incidents + 运行时自动写的 `handoffs.jsonl` | §七；`rules/` `ai-logs/` `skills/` |
| **功能完整度 (25%)** | IM 主链路 + ≥2 真实平台 + @mention 路由 + 多 Agent 调度，端到端真实 | §四 / §五；`pnpm ui:dev` 实跑 |
| **生成质量 (20%)** | 真实模型产物内联渲染 + iframe live preview + 逐阶段卡片 | §4.2③；Demo 视频 |
| **代码理解 (15%)** | 10 ADR + 11 spec，每个选型讲得清 | `specs/` `ai-logs/decisions/` |
| **创新与产品感 (10%)** | 4 件没人做的事（§4.3） | §4.3 |

---

## 九、团队分工

| 成员 | 角色 | 负责 |
|---|---|---|
| **袁晨杰** | UI/前端 + 产品 + Demo | 群聊 UI、产物卡/Diff/Sandbox 渲染、工作流编辑器、PRD/spec 体系、Demo 脚本与录制 |
| **Evanlin** | Orchestrator / 适配器 / 契约 | LangGraph 7 阶段编排、`AgentEvent`/`Artifact`/`HandoffCard` 合约、适配器协议与 selector |
| **Peitong Qi** | 后端 / 数据库 / 沙箱 | tRPC 路由与权限、Drizzle/Postgres schema、workspace 隔离、hand-off log、e2b 沙箱集成 |

> 协作方式本身也是特色：成员各自的 AI 编码助手通过**共享记忆**对齐上下文与决策，详见 §十一 AI 使用声明。

---

## 十、关键决策 & 可改进点

**关键决策**
- **群聊语义作为差异化主轴**：押注 @ 路由 / 产物归属 / 可见交接 / 依赖图，而非堆模型。
- **统一适配器层**：用一种 `AgentEvent` 流屏蔽 Claude Code / Codex 差异，加新平台是"接线"不是"造轮子"。
- **mock/降级优先**：无 key 离线可演示，主链路永不白屏。
- **工作流即 spec**：结构化定义直接驱动真实调度，不做流程图贴纸。

**诚实边界 / 可改进点**
- 1v1 单聊间（Agent 私聊）：UI 有、live 链路未接。
- 图片/附件消息类型：未做。
- 代码冲突处理：依赖工作流阶段串行，非自动合并算法。
- 跨会话 hand-off：demo 级，生产级在 roadmap。
- 部署管线：在 roadmap。

---

## 十一、致谢 / 引用与依赖 / AI 使用声明

### 致谢
感谢字节跳动 AgentHub 课题提供的高质量命题，让我们在真实约束下完整走一遍"调研 → 设计 → 实现 → 验收 → 交付"。感谢队友在各自分层上的紧密配合——契约扎实、编排稳健，产品才跑得起来。

### 引用与依赖
- 框架：Next.js · LangGraph.js · Vercel AI SDK · tRPC · Drizzle ORM · Postgres · Redis
- 沙箱/模型：e2b（沙箱预览）· 火山引擎 / DeepSeek / OpenAI / Anthropic / MiniMax（OpenAI 兼容）
- Agent 平台：Claude Code CLI · OpenAI Codex CLI
- 规范：Anthropic Skills 格式 · Conventional Commits
- **原创部分**：群聊协作语义、`AgentEvent`/`HandoffCard` 契约与编排、适配器协议、依赖图、可定制工作流、全部 spec/ADR/skills——均为本项目自写。

### AI 使用声明（含反思）
本项目开发中**深度且透明地使用 AI**：① 题目分析与方案共创（大量产品决策"聊"出来）；② AI 写代码、人类验收（不过 lint/typecheck/test 钩子就返工）；③ 多人协作时各自 AI 助手**共享记忆**对齐上下文；④ AI 按 `CLAUDE.md` 约定起草 spec/文档、人类审校。

**反思**：① 多人 + AI 协作要**一开始就对齐 AI 使用规范**（commit/PR 语言与粒度、验收口径），否则后期返工贵；② **验收标准必须可执行**（我们以钩子跑绿为硬门槛）；③ 从第一天就把**"Agent 友好"当工程目标**（离线可跑、测试即规格、约定机读化），这也是仓库提供 `AGENTS.md` / `skills/` 的原因；④ AI 出错不静默修，留 incident + 守卫，让同类错误不再发生。
