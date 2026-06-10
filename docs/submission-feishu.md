# Roundtable — AgentHub 课题提交文档

> 本文件是飞书提交文档的母版：整体复制进飞书后调整排版即可。`【】` 内为需要你手填的占位。

---

## 一、项目概览

**Roundtable（圆桌）** — IM 式多 Agent 协作平台。用户像拉群一样把多个 Coding Agent 请到一张圆桌旁：PM Agent 负责理解意图、拆解任务、按工作流分派与聚合；每一次 Agent 间交接都是一张结构化的 HandoffCard，产物带 owner 与版本，依赖关系可视化。

- **GitHub 仓库（可运行 Demo）**：https://github.com/AntaresYuan/Roundtable
- **Demo 视频**：【上传后贴链接，拍摄脚本见仓库 `docs/demo/video-script.md`】
- **团队**：袁晨杰（UI/前端 + 产品 + Demo）、Evanlin（Orchestrator/适配器/契约）、Peitong Qi（后端/数据库/沙箱）

### 30 秒跑起来

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run setup        # Docker 起 Postgres/Redis + 迁移 + 种子数据
corepack pnpm ui:dev           # localhost:3000
```

LLM 配置见 `.env.example`（多 Provider：火山引擎 / DeepSeek / OpenAI / Anthropic / MiniMax，env 一行切换）。

---

## 二、产品设计

**定位**：vibe coding 的协作层。单 Agent 工具解决"一个人干活"，Roundtable 解决"一个团队干活"——分工、交接、依赖、质检如何不在聊天记录里失传。

**核心交互**（详见 `docs/prd.md` 与 `specs/000-overview.md`）：

| 模块 | 实现 |
|---|---|
| IM 聊天 | 会话列表（新建/搜索/置顶/归档/最近排序）、@mention 点名、引用回复、重新生成、代码一键复制 |
| PM 编排 | 意图理解 → 结构化计划（真实对象，非 prose）→ **人工批准闸门** → 按工作流阶段分派 → 聚合汇报 |
| 工作流 | 可定制的 Workflow 编辑器（阶段/席位/审批闸口），编辑后绑定工作台直接驱动真实调度 |
| 上下文 | 聊天历史自动随 turn 传给模型；pin 的约束（工作台级/会话级）注入每次规划 |
| 多 Agent | 统一适配器层接入 **Claude Code + Codex CLI**（按角色绑定）；对话式自建 Agent（System Prompt + 能力集，落库） |
| 产物 | 代码/Diff/网页产物卡内联渲染，iframe 实时预览，全屏抽屉，owner 颜色 + 版本号 |
| 交接 | **HandoffCard**：每次交接生成结构化卡片（含上下文预算审计），自动写入 `ai-logs/handoffs.jsonl` |

---

## 三、技术架构

```
Next.js 15 (App Router) ── tRPC ── Drizzle + Postgres
        │                              │
   src/ui (React)              src/server (路由/权限/限流)
        │                              │
   /api/orchestrator/* ── src/orchestrator (LangGraph 节点: intake→plan→dispatch→review→aggregate)
                                       │
                          src/adapters (统一 AgentAdapter 契约)
                          ├─ claude-code (CLI stream-json 桥)
                          ├─ codex (第二平台, 按角色 env 绑定)
                          └─ local-dispatch (离线兜底)
```

**关键设计决策**（全部有 ADR，见 `ai-logs/decisions/`）：

- **事件流契约**：所有 Agent 输出统一为 `AgentEvent` 判别联合（zod），UI 与编排层解耦（spec 020）
- **LLM Provider 无关**：`defaultOrchestratorModel()` 单点选型，火山引擎/DeepSeek/OpenAI 一行 env 切换
- **降级永不白屏**：LLM 不可达时 intake/planner 落到确定性启发式并打 `degraded` 标记，demo 主链路不会 500
- **HandoffCard 即产品对象**：交接不是黑盒消息传递，卡片可编辑、可跨会话导出/导入（spec 030）
- **工作流即 spec 非画布**：Workflow 是结构化定义直接驱动调度，不是流程图贴纸（ADR-009）

---

## 四、AI 协作开发记录（仓库内可验证）

我们把"怎么和 AI 协作"本身沉淀成了仓库里的一等公民：

| 沉淀物 | 位置 | 说明 |
|---|---|---|
| 协作规范 | `CLAUDE.md` / `AGENTS.md` / `rules/` | Agent 入职文档：读取顺序、代码风格、commit 规范、PR 检查单 |
| Spec 体系 | `specs/000–100` | 11 份功能 spec，AI 实现前先对齐 spec，spec 错了同 PR 改 spec |
| Skills | `skills/`（5 个） | Anthropic Skills 格式：接新适配器、调 PM prompt、调试 stream-json 等——**开发期指导 AI，运行期作为产品能力复用** |
| 决策记录 | `ai-logs/decisions/`（10 份 ADR） | LangGraph vs AutoGen、CLI vs API 等关键选型的完整论证 |
| 翻车记录 | `ai-logs/incidents.md` | AI 的错误输出 + prompt + 教训，原样保留 |
| 运行时证据 | `ai-logs/handoffs.jsonl` | **产品运行时自动写入**的真实交接记录（含上下文预算审计），不是手工整理 |

协作流程一句话：**spec 先行 → AI 按 CLAUDE.md 约定实现 → lint/typecheck/test 钩子强制 → 一逻辑一 commit → 意外行为记 incidents**。

---

## 五、对照课题要求自评

| 维度 | 我们的答卷 |
|---|---|
| AI 协作能力 (30%) | 上表全套沉淀，handoffs.jsonl 是运行时自动产物，答辩可现场打开 |
| 功能完整度 (25%) | IM 主链路 + 多 Agent 调度端到端真实可跑（DeepSeek 实测，非 mock） |
| 生成效果 (20%) | 真实模型产物（代码/网页）内联渲染 + iframe 预览 + 逐阶段卡片 |
| 代码理解 (15%) | 10 份 ADR + 11 份 spec，每个选型都能讲清楚为什么 |
| 创新与产品感 (10%) | HandoffCard 可视化、依赖变更徽章、可定制工作流驱动真实调度、上下文 pin 注入 |

**诚实边界**（被问到时的口径）：1v1 单聊间（UI 有，live 链路未接）；图片/附件消息类型未做；代码冲突处理依赖工作流阶段串行而非合并算法；部署管线在 roadmap。

---

## 六、附录

- 视频拍摄脚本：`docs/demo/video-script.md`（逐镜 + 台词 + 评分点）
- 演示风险预案：`docs/risk-register.md`
- 运维手册：`docs/operations.md`
