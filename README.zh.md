# Orca DSH 补丁 —— 把 DeepSeek Harness 注册为 Orca 内置 Agent（终端 TUI 形态）

给 **Stably Orca**（`com.stablyai.orca`，当前在 `~/Downloads/Orca.app`）打补丁，使其像内置 Claude Code / Codex 一样：

- 在 **Agent 选择器**中出现 **DSH**（带图标）
- 自动**检测**本机是否安装了 `dsh` CLI（探测命令 `dsh`）
- 一键在 pane 中启动 **dsh-TUI**（`dsh --profile dsh-tui`）—— 一个 Claude Code 风格的**终端全屏 TUI**，直接在 pane 内交互：打字、看实时工具调用、上下文进度条、`/resume` 会话恢复。**不再跳浏览器**。任务文本通过 Orca 的 `stdin-after-start` 注入（已实测可在 pane 输入框落字并回车触发）
- 前置：需先安装 dsh-TUI profile（本项目安装时会提示，见下文）

> 说明：DSH 的 Web UI（`dsh web`）仍可用，但那只是另一种前端；Orca 里启用的是终端 TUI。

## 前置条件

- macOS + 已安装 Orca（补丁基于 **1.4.184** 制作，其他版本需重跑并确认锚点仍匹配）
- 已安装 DSH CLI：`~/.local/bin/dsh`（补丁脚本会自动把它软链到 `/usr/local/bin/dsh`，保证 GUI 启动的 Orca 能在系统默认 PATH 里探测到）
- Node.js ≥ 18，且本项目根目录已 `npm install`（依赖 `@electron/asar`）

## 使用

```bash
# 只构建与校验，不安装（产物在 ./orca-dsh-build/）
./orca-dsh-patch/patch.sh --stage

# 安装到 Orca（自动退出 Orca → 备份 → 替换 → 改完整性哈希 → 重签名）
./orca-dsh-patch/patch.sh --install

# 出问题一键回滚到最近一次备份
./orca-dsh-patch/patch.sh --rollback
```

### 安装 dsh-TUI profile（Orca 里启动 DSH 的终端界面）

补丁让 Orca 用 `dsh --profile dsh-tui` 启动 DSH。首次使用前需安装该 TUI profile：

```bash
# 一次性安装 dsh-TUI（社区 Claude Code 风格终端界面，官方公众号收录）
dsh plugin --profile dsh-tui add @deepseek-harness-tui/dsh-tui
# 或单独验证：dsh --profile dsh-tui
```

安装完成后在 Orca 新建 Agent → 类型选择器选 **DSH** → pane 内出现 dsh-TUI 界面，直接在其中输入交互即可。任务文本在 pane 的输入框里输入并回车。

## 已知限制

| 事项 | 说明 |
| --- | --- |
| **Orca 自动更新会还原补丁** | 更新后重新跑一次 `patch.sh --install` 即可 |
| **签名变为 ad-hoc** | 原 Developer ID 签名被替换；macOS 可能要求重新授予一次"屏幕录制 / 辅助功能"等权限 |
| **细粒度状态上报缺失** | 未接入 Orca 的 agent-hook 协议（如 codex-hook），DSH pane 的状态识别退化为进程级（运行中/已退出） |
| **TUI 升级兼容性** | dsh-TUI 是独立 npm 包（`@deepseek-harness-tui/dsh-tui`），版本跟着走；Orca 升级后重跑 `patch.sh --install` |
| **Orca 自动更新会还原补丁** | 更新后重新跑 `./orca-dsh-patch/patch.sh --install`（脚本已按内容定位文件，跨版本健壮） |

## 修复记录

### 2026-08-27 — 页签显示"Gemini CLI"而非"DSH"（已修复）

**现象**：在 Orca 里打开 dsh-TUI 后，终端 pane 的页签/标题被识别成 **Gemini CLI**。

**根因**：dsh-TUI 把 OSC 终端标题设置为 `` `<✦> 🐋 <会话标题>` ``（工作时前缀换成 `⠂/⠐` 旋转点）。Orca 的字面识别 `isGeminiTerminalTitle` 把标题里的 **`✦`** 当作 Gemini 工作态标志（`✦` = GEMINI_WORKING），于是在未命中任何 dsh 规则的情况下判成 **Gemini CLI**。除了 `getAgentLabel`（标签），Orca 还有两处**直接改写标题**的路径会把它变成 `✦ Gemini CLI`：`normalizeTerminalTitle`（store/daemon）以及独立的 `agent-title-identity.js` `getAgentLabel`。dsh-TUI 的 `🐋`（U+1F40B，DeepSeek 鲸鱼）是无歧义指纹，此前却没有任何识别规则引用它。

**修复**：新增 `isDshTerminalTitle(title)`（命中 `🐋` 或标题 token `dsh`），在所有 Gemini 判断**之前**短路返回 `DSH`/`dsh`，并给标签→agent 映射加 `DSH → dsh`；同时让 `normalizeTerminalTitle` 对 dsh 标题输出 `` `🐋 DeepSeek Harness` ``（不再改写成 `✦ Gemini CLI`）。覆盖的识别副本：

- `out/shared/agent-title-core.js` — 新增并导出 `isDshTerminalTitle`
- `out/shared/agent-title-identity.js` — `getAgentLabel` 加 DSH 分支
- `out/shared/terminal-title-agent-type.js` — `getAgentLabel` / `resolveTerminalTitleAgentType` + `DSH→dsh`
- `out/renderer/assets/store-*.js` — 内联 `getAgentLabel` + `getAgentLabel$1` + `TITLE_LABEL_TO_AGENT` + `normalizeTerminalTitle`
- `out/main/chunks/daemon-ready-identity-*.js` — 内联 `getAgentLabel` + `normalizeTerminalTitle`

**验证**：`resolveTerminalTitleAgentType("✦ 🐋 Fix the auth bug")` → `dsh`；`agent-title-identity.getAgentLabel` 同题 → `DSH`；`normalizeTerminalTitle` 对 dsh 标题返回 `` `🐋 DeepSeek Harness` ``（页签显示带产品名），不再改写为 `✦ Gemini CLI`；真正的 Gemini（`✋ gemini`、`✦ deep dive` 无鲸鱼）仍 → `gemini`；Claude/Codex 不受影响。补丁脚本具备幂等性（每项带 `already` 指纹，重跑/增量更新不重复叠加）。

重新安装：`ORCA_APP=~/Downloads/Orca.app ./orca-dsh-patch/patch.sh --install`，然后重启 Orca。

## 工程结构

```
orca-dsh-patch/
├── patch.sh              # 编排：提取 → 打补丁 → 重打包校验 → 安装/回滚
└── lib/
    ├── apply-patches.js  # 23 个字符串锚点补丁（每个必须恰好命中一次，否则中止）
    ├── repack.js         # 重打包 + 与原包逐文件比对（路径集合/unpacked 标志/内容哈希）
    ├── make-icon.js      # 生成 64×64 DSH 图标 PNG data URL（零依赖）
    └── dsh-icon.txt      # 图标数据
orca-dsh-build/           # --stage 的产物（app.asar + app.asar.unpacked），可删
```

## 补丁改了哪些地方

共 16 个文件、23 处插入（全部以 `[orca-dsh-patch]` 注释或 `dsh:` 字段标记）：

**共享层 CJS**（主进程 / CLI 使用）
- `out/shared/tui-agent-config.js` — 新增 `dsh` 配置：detect=`dsh`，launch=`dsh web --port 0`，stdin 注入模式
- `out/shared/tui-agent-selection.js` — 追加自动挑选顺序
- `out/shared/agent-node-entrypoint-identities.js` — node 入口精确身份：`node_modules/@deepseek-ai/dsh/lib/bin.js` → dsh
- `out/shared/agent-kind.js`、`agent-name-token-match.js`、`telemetry-events.js` — kind 映射 / 名称 token 匹配 / 遥测枚举

**主进程 chunk**
- `out/main/chunks/tui-agent-config-6df2S_Od.js` — 配置副本
- `out/main/chunks/daemon-ready-identity-CBpVZzLg.js` — AGENT_NAMES + 入口身份副本

**渲染层（桌面 UI）**
- `out/renderer/assets/agent-status-3vUKbY6l.js` — 配置 + 显示标签 `DSH` + 可图标化集合
- `out/renderer/assets/store-CgXrfmaH.js` — 选择顺序
- `out/renderer/assets/agent-kind-Dfx6MnkP.js` — kind 表
- `out/renderer/assets/agent-catalog-CBF2CV5Q.js` — 目录条目 + 图标
- `out/renderer/assets/agent-process-recognition-BB0O3DaN.js` — 进程识别身份

**Web 客户端变体**（尽力而为）
- `out/web/assets/{agent-status,store,agent-kind}` 同步修改

## 重打包布局说明

原包的 unpacked 集合（954 个文件）由 `repack.js` 用等价 glob 复刻，并通过逐文件比对原始 asar 头部（路径集合、unpacked 标志、内容哈希）验证 —— 只有上述 16 个目标文件允许变化，任何漂移都会中止安装。
