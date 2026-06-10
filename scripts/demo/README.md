# Demo 视频录制工作流

把 `docs/demo/video-plan.md` 的 13 段脚本自动录制并合成为 `demo-out/roundtable-demo.mp4`。
全部命令在仓库根目录执行。

## 依赖

- 本仓库 `corepack pnpm install` 完成，Playwright chromium 已装（`pnpm exec playwright install chromium`）
- dev server：`corepack pnpm exec next dev -p 3001`（`NEXTAUTH_URL=http://localhost:3001`）
- docker postgres/redis 运行中（`pnpm dev:services`）
- 完整版 ffmpeg（`winget install Gyan.FFmpeg.Essentials`，脚本自动寻路）
- 旁白 TTS：`C:/Users/glqi6/dev/demo-tools` 里 `npm i msedge-tts`（Edge 神经语音，需联网）
- **录真实链路前：关 VPN**（火山方舟 ark.cn-beijing 在 VPN 下 TLS 握手失败）

## 文件

| 文件 | 作用 |
|---|---|
| `lib.mjs` | 公共库：假光标注入、平滑移动、时间标记、录像收尾 |
| `probe.mjs` | 登录探针，生成 `demo-out/auth-state.json`（dev 凭据 demo@roundtable.local） |
| `prep-real-take.mjs` | 正式录制前置：清空 live turn store、移除干跑代理 Rex、检查火山连通 |
| `take-a.mjs` | 主镜头：真实链路一镜到底（段 1-9、11、13），输出 webm + markers |
| `take-b.mjs` | 剧场镜头：/gallery 的 HandoffCard + 依赖徽章（段 10，【SCRIPT】） |
| `take-c.mjs` | 编辑器镜头：ai-logs/handoffs.jsonl + context_audit 高亮（段 12） |
| `narration.json` | 13 段中文旁白 + 字幕文案 |
| `tts.mjs` | 生成 `demo-out/vo-XX.mp3`（晓晓神经音色） |
| `assemble.mjs` | 后期：按 markers 切割、按 `fit:N秒` 加速、静态放大、烧字幕、混旁白、拼接 |

## 录制步骤

```powershell
node scripts/demo/probe.mjs           # 一次性：登录态
node scripts/demo/take-b.mjs          # 段10（不依赖 LLM）
node scripts/demo/take-c.mjs          # 段12（不依赖 LLM）
node scripts/demo/tts.mjs             # 旁白（不依赖 LLM）

# —— 关 VPN 之后 ——
corepack pnpm orch:smoke:llm          # pre-flight：必须真实 intake、errors: []
node scripts/demo/prep-real-take.mjs  # 清场（必须！否则旧 turn 会入镜/按钮错位）
node scripts/demo/take-a.mjs          # 主镜头，约 15-25 分钟（真实 agent 执行）

node scripts/demo/assemble.mjs        # 合成 demo-out/roundtable-demo.mp4
```

输出的 `*.markers.json` 记录每个分镜的时间点；`assemble.mjs` 的 EDL 用标记名切割。
单段重渲染：`node scripts/demo/assemble.mjs --only 5`。

## 已知坑（已在脚本里解决）

- 这套 UI hover/点击会触发 React 重渲染换 DOM 节点，Playwright `click()` 会陷入重试——
  `glideClick` 4 秒超时后降级为 JS click。
- 所有运行共享**同一个** local chat（服务端按用户单聊天），不清场旧 turn 会留在画面里，
  且 `.first()` 定位会点到旧卡片——脚本统一用 `.last()`/`nth(1)` + `prep-real-take.mjs` 清场。
- Add-agent 弹窗超出 800px 视口，提交按钮要先 `mouse.wheel` 滚进来。
- 平台 chip 显示真实适配器的前提：localStorage `roundtableAgentAdapter=claude-code`
  （take-a 已注入），否则走 local echo，chip 显示 "Roundtable local"。
- 单文件 `index.html` 产物 → kind html → 聊天内 iframe 可交互预览；散的 `.tsx` 只会是 code 卡。
- 计划卡若带 "heuristic planner" 字样 = LLM 降级，take-a 会主动中止（`DEMO_ALLOW_DEGRADED=1` 可放行干跑）。
- 取证用截图：beat 失败自动存 `demo-out/fail-<beat>.png`。
