# Demo 视频逐镜脚本（3 分钟版）

配套 [`storyboard.md`](./storyboard.md)（镜头依据其 primary scenario）。录制前先跑完 storyboard 的 Pre-flight 四步——尤其确认 plan 卡**没有** `degraded` 标记。

约定：**[LIVE]** = 真实链路实时跑（2026-06-10 已验证）；**[SCRIPT]** = 登出态脚本剧场（确定性，适合赶时间）。台词照念约 2 秒/句，总台词控制在 380 字内。

| 时间 | 画面 | 操作 | 台词（口播） | 评分点 |
|---|---|---|---|---|
| 0:00–0:15 | 首页全景：圆桌场景 + WorkflowStrip | 无操作，光标轻扫成员头像 | Roundtable 是一个 IM 式多 Agent 协作平台：你像拉群一样把 Coding Agent 拉到一张圆桌上，PM Agent 负责拆解、分派和聚合。 | 产品感 10% |
| 0:15–0:40 | 聊天主界面 **[LIVE]** | 发送「给设置页加一个深色模式开关」；@ 按钮弹出 mention 菜单顺带展示 | 一句话需求发进群里。注意 PM 没有直接动手——它先产出一份结构化计划。可以用 @ 点名任何一个 Agent。 | IM 核心体验 25% |
| 0:40–1:00 | Plan 卡（TodoList）**[LIVE]** | 点 "Show plan" 展开：任务、assignee 头像、依赖标注 | 计划是真实对象不是一段话：每个任务有负责人、有依赖关系。**没有我的批准，任何 Agent 都不会开工**——人始终握着闸门。 | 多Agent调度 |
| 1:00–1:40 | 批准 → StageCards 逐阶段出现 **[LIVE]** | 点 Approve；Build 阶段卡出现（实现者头像+spinner）→ Review 阶段卡；右上平台 chip 指给评委看 | 批准后工作流逐阶段推进，每个阶段一张卡：谁在干、干到哪、产出什么，全部可见。右上角是执行平台标识——适配器层支持 Claude Code 和 Codex CLI 按角色绑定。 | 调度跑通 + 多平台接入 |
| 1:40–2:05 | 产物卡 **[LIVE]** | 展开 code 产物（点复制按钮）；切到 preview 产物的 iframe 实时渲染 | 产物是真实模型写的代码，一键复制；网页类产物直接在聊天里渲染预览。每个产物带 owner 颜色和版本号。 | 生成效果 20% |
| 2:05–2:30 | Workflow 编辑器 | 打开编辑器：拖阶段、改 seats、给 Ship 阶段设 user approval gate | 工作流本身是可定制的产品对象：新手用现成模板，重度用户自己搭——阶段、席位、闸口都能改，改完直接绑定到工作台生效。 | 创新点 + 产品感 |
| 2:30–2:50 | HandoffCard + ai-logs **[SCRIPT 镜头 + 真实文件]** | 展示对话流中的 HandoffCard；切到编辑器打开 `ai-logs/handoffs.jsonl`，指着今天的真实记录 | 每次 Agent 间交接都是一张结构化卡片，带上下文预算审计，并自动落盘——这个文件就是今天真实跑出来的交接记录，不是演的。 | AI 协作 30% |
| 2:50–3:00 | 回到首页全景 | 无操作 | 规范沉淀在 specs 和 skills 里，开发期和运行期共用一套约定。这就是 Roundtable。 | 收尾 |

## 录制注意

- **窗口**：1280×800 以上，浅色主题，关掉系统通知。
- **节奏**：dispatch 等待期间（约 20–30 秒）用剪辑跳过，保留阶段卡"翻面"瞬间。
- **保底**：若 LIVE 链路当场异常（参照 `docs/risk-register.md`），0:15–2:05 全部镜头可用登出态脚本剧场替代，台词不变，删掉「真实模型写的」一句。
- **不要拍**：Deploy 相关字样（无真实部署管线）、`.env`、任何 API key。

## 答辩加分提示（视频外，问答用）

- 评委强调过的三件套：HandoffCard 可视化、依赖变更徽章、`handoffs.jsonl` 自动写入——视频里各给了一个镜头，问答时可现场打开文件再讲 context_audit 字段。
- 被问"第二个平台"：适配器层（`src/adapters/`）已接 Claude Code 与 Codex CLI，按角色 env 绑定（`ROUNDTABLE_ADAPTER_REVIEWER=codex`），演示机未装 codex CLI 故视频用 Claude Code 执行。
