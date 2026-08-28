# Orca DSH 补丁 —— 把 DeepSeek Harness 注册为 Orca 内置 Agent

> ⚠️ **第三方非官方集成**。本项目是一套用于给 **Stably Orca**（`com.stablyai.orca`）打补丁的脚本，让 Orca 的 Agent 选择器里出现 **DSH**，可一键在 pane 中启动 **dsh-TUI** 终端界面。**不包含、不重新分发 Orca 的专有源码**，仅在你本机安装时对 `app.asar` 做锚点注入。使用前请自行确认符合 Orca / DSH 的相关许可与使用条款。

在 **macOS** 上验证通过：Orca `1.4.190`、DSH CLI `0.1.1-rc.2`、dsh-TUI `@deepseek-harness-tui/dsh-tui ^0.9.x`。

## 效果

给 Orca 打补丁后，像内置 Claude Code / Codex 一样：

- **Agent 选择器**中出现 **DSH**（带蓝色图标）
- 自动**检测**本机是否安装 `dsh` CLI（探测命令 `dsh`）
- 一键在 pane 中启动 **dsh-TUI**（`dsh --profile dsh-tui`）—— Claude Code 风格的**终端全屏 TUI**，直接在 pane 内交互：打字、看实时工具调用、上下文进度条、`/resume` 会话恢复。**不再跳浏览器**
- 任务文本经 Orca 的 `stdin-after-start` 注入（可在 pane 输入框落字并回车触发）
- pane 页签显示 **🐋 DeepSeek Harness**（修复了被误判成 "Gemini CLI" 的问题，见下文）

> 说明：DSH 的 Web UI（`dsh web`）仍可用，但那是另一种前端；Orca 里启用的是终端 TUI。

## 前置条件

- **macOS** + 已安装 Orca（本仓库按 `com.stablyai.orca` 定位；见"关于实际安装位置"）
- 已安装 DSH CLI：`~/.local/bin/dsh`
- Node.js ≥ 18，且项目根目录已安装依赖：`npm install`（仅用 `@electron/asar`）

## 快速开始

```bash
# 0) 安装本仓库依赖
npm install

# 1) 只构建并校验，不安装（产物在 ./orca-dsh-build/，可先检查）
./orca-dsh-patch/patch.sh --stage

# 2) 安装到 Orca（自动：退出 Orca → 备份 → 替换 → 更新完整性哈希 → 重签名）
./orca-dsh-patch/patch.sh --install

# 3) 出问题一键回滚到最近一次备份
./orca-dsh-patch/patch.sh --rollback
```

> Orca 不在默认位置？用环境变量指定：`ORCA_APP=/path/to/Orca.app ./orca-dsh-patch/patch.sh --install`

### 安装 dsh-TUI profile（Orca 里启动 DSH 用的终端界面）

补丁让 Orca 用 `dsh --profile dsh-tui` 启动 DSH。首次使用前需安装 TUI profile（需能访问 npm registry）：

```bash
dsh plugin --profile dsh-tui add @deepseek-harness-tui/dsh-tui
# 单独验证：dsh --profile dsh-tui
```

完成后在 Orca **新建 Agent → 类型选择器选 DSH** → pane 内出现 dsh-TUI 界面，直接输入交互即可。

## 关于实际安装位置与 App Translocation

- 本机实际安装点可能是 `~/Downloads/Orca.app`（而非 `/Applications`）。确认方式：`mdfind "kMDItemCFBundleIdentifier == 'com.stablyai.orca'"`。
- 从 Downloads 下载、且经本补丁 ad-hoc 重签名后的应用，macOS 启动时会走 **App Translocation**（复制到只读临时路径运行）。这是**正常现象**，不影响功能；`patch.sh` 对 `$APP`（默认 `/Applications/Orca.app`）读写，如不一致请用 `ORCA_APP` 指定。
- 运行中的进程路径里出现 `.../T/AppTranslocation/...` 属预期。

## 已知限制

| 事项 | 说明 |
| --- | --- |
| **Orca 自动更新会还原补丁** | Orca 升级后重跑 `patch.sh --install` 即可（脚本按内容定位文件、幂等，跨版本健壮） |
| **签名变为 ad-hoc** | 原 Developer ID 签名被替换；macOS 可能要求重新授予一次"屏幕录制 / 辅助功能"等权限 |
| **细粒度状态上报缺失** | 未接入 Orca 的 agent-hook 协议（如 codex-hook），DSH pane 状态退化为进程级（运行中/已退出） |
| **TUI 版本独立** | dsh-TUI 是独立 npm 包，版本跟着走；记得同步 `dsh plugin ... add` 更新 |

## Orca 升级后如何重新启用集成

> 本补丁改的是官方 `app.asar`（含签名），**Orca 任何升级都会把它全部还原**。升级后 DSH 从选择器消失、页签逻辑回归，这是预期行为，不是故障。重新启用只需重打一次补丁：

```bash
# 0) 先确认当前 Orca 的实际路径（可能已换位置）
APP="$(mdfind "kMDItemCFBundleIdentifier == 'com.stablyai.orca'")"; echo "$APP"

# 1) 重打补丁（自动：退出 Orca → 备份 → 替换 → 更新哈希 → 重签名）
ORCA_APP="$APP" ./orca-dsh-patch/patch.sh --install
```

**重打自动化程度：**

| 层面 | 表现 |
| --- | --- |
| 共享 CJS 文件（`tui-agent-config`、`agent-title-core` 等） | 文件名跨版本稳定，自动命中 ✅ |
| 带版本 hash 的 bundle（`store-`、`daemon-ready-identity-`、`agent-catalog-` 等） | 用**内容 probe** 定位，hash 变也能找到 ✅ |
| 内部结构 / 锚点字符串 | 若 Orca 改了函数/字段/字符串，锚点失配 ⚠️ |

**可能遇到的两种情况：**

- **输出全绿** → 打好了，重启 Orca 即可。
- **报 `ANCHOR x0` / `NO FILE` / `already-ok` 缺失** → 脚本**安全停止、不写盘**，不会打坏 app。这是"失败安全"设计：把报错贴给维护者，更新锚点后再跑（1.4.184→1.4.190 时就发生过一次，已改成正则/内容定位兼容）。
- 如中途不放心：`./orca-dsh-patch/patch.sh --rollback` 可回到最近一次备份。

**升级后最容易误判为"坏了"的一点：** 每次重打都会 ad-hoc 重签名，macOS 可能再次要求授予「屏幕录制 / 辅助功能 / 文件夹访问」等权限（取决于 dsh-TUI 用到的能力）。重新授权即可。

**不受升级影响的部分：** DSH CLI、`dsh-tui` profile、`~/.dsh` 会话数据都在独立位置，Orca 升级不会动它们。

## 修复记录

### 2026-08-27 — 页签误显 "Gemini CLI" 而非 "DeepSeek Harness"（已修复）

**现象**：在 Orca 打开 dsh-TUI 后，终端 pane 页签被识别成 **Gemini CLI**。

**根因**：dsh-TUI 把 OSC 终端标题设为 `` `<✦> 🐋 <会话标题>` ``（工作时前缀换成 `⠂/⠐`）。Orca 的 `isGeminiTerminalTitle` 把标题里的 **`✦`** 当作 Gemini 工作态标志，于是未命中任何 dsh 规则就判成 **Gemini CLI**。除 `getAgentLabel` 外，还有两处**直接改写标题**的路径（`normalizeTerminalTitle`、`agent-title-identity`）。dsh-TUI 的 **🐋（U+1F40B，DeepSeek 鲸鱼）** 是无歧义指纹，此前没有任何规则引用它。

**修复**：新增 `isDshTerminalTitle(title)`（命中 `🐋` 或标题 token `dsh`），在所有 Gemini 判断**之前**短路返回 `DSH`/`dsh`；`normalizeTerminalTitle` 对 dsh 标题输出 `` `🐋 DeepSeek Harness` ``；标签→agent 映射加 `DSH → dsh`。覆盖 6 个识别副本：

- `out/shared/agent-title-core.js` — 新增导出 `isDshTerminalTitle`
- `out/shared/agent-title-identity.js` — `getAgentLabel` 加 DSH 分支
- `out/shared/terminal-title-agent-type.js` — `getAgentLabel` / `resolveTerminalTitleAgentType` + `DSH→dsh`
- `out/renderer/assets/store-*.js` — `getAgentLabel` / `getAgentLabel$1` / `TITLE_LABEL_TO_AGENT` / `normalizeTerminalTitle`
- `out/main/chunks/daemon-ready-identity-*.js` — `getAgentLabel` / `normalizeTerminalTitle`

**验证**：`resolveTerminalTitleAgentType("✦ 🐋 Fix the auth bug")` → `dsh`；真 Gemini（`✋ gemini` 等）仍 → `gemini`；Claude/Codex 不受影响；页签显示 🐋 DeepSeek Harness。

## 工程结构

```
orca-dsh-patch/
├── patch.sh             # 编排：提取 → 打补丁 → 重打包校验 → 安装/回滚
└── lib/
    ├── apply-patches.js # 38 个锚点/正则补丁（每项必须恰好命中一次，否则中止；幂等）
    ├── repack.js        # 重打包 + 与原包逐文件比对（路径/解包标志/内容哈希），零漂移校验
    ├── make-icon.js     # 生成 64×64 DSH 图标 PNG data URL（零依赖）
    └── dsh-icon.txt     # 图标数据
orca-dsh-build/          # --stage 产物（app.asar + app.asar.unpacked），可删（已 gitignore）
```

## 补丁改了哪些地方

共 **38 处**插入，按**内容**定位文件（renderer / main 的 bundle 名带版本 hash，脚本用 probe 探测模糊匹配），跨 Orca 版本健壮。凡补丁处都有 `[orca-dsh-patch]` 注释或 `dsh:` 字段标记。

**共享层 CJS**（主进程 / CLI 使用）
- `out/shared/tui-agent-config.js` — 新增 `dsh` 配置：detect=`dsh`，launch=`dsh --profile dsh-tui`，stdin 注入模式
- `out/shared/tui-agent-selection.js` — 自动挑选顺序追加 `dsh`
- `out/shared/agent-node-entrypoint-identities.js` — node 入口精确身份 `node_modules/@deepseek-ai/dsh/lib/bin.js` → dsh
- `out/shared/agent-kind.js` / `agent-name-token-match.js` / `telemetry-events.js` — kind 映射 / 名称 token / 遥测枚举
- `out/shared/agent-title-core.js` / `agent-title-identity.js` / `terminal-title-agent-type.js` — 标题识别（页签标签）DSH 分支

**主进程 chunk**（`tui-agent-config-*`、`daemon-ready-identity-*`，版本 hash 变）
- 配置副本、AGENT_NAMES、入口身份、标题识别 / `normalizeTerminalTitle`

**渲染层（桌面 UI）**（`store-*`、`agent-catalog-*`、`agent-kind-*`、`agent-process-recognition-*`）
- 配置、显示标签 `DSH`、可图标化集合、选择顺序、kind 表、目录条目 + 图标、进程识别身份、标题识别 / `normalizeTerminalTitle`

**Web 客户端变体**（`out/web/assets/*`，尽力而为）

## 重打包布局说明

原包的 unpacked 集合（约 954 个文件）由 `repack.js` 用等价 glob 复刻，并通过逐文件比对原始 asar 头部（路径集合、unpacked 标志、内容哈希）验证 —— 只有目标文件允许变化，任何漂移都会中止安装，不会动到 `/Applications`。

## 免责声明

- 此为**社区自用集成脚本**，与 DeepSeek / Stably 官方无关联；"DeepSeek HW"、"Orca" 等商标归各自所有。
- 修改第三方应用的签名与 `app.asar` 属高级操作，请在同意 Orca/DSH 许可条款的前提下自行使用，风险自负。
- 本仓库不打包、不重新分发 Orca 或 dsh-TUI 的专有代码。

## License

MIT（详见各源文件头；脚本为原创代码）。