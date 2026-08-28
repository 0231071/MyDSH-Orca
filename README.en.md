# Orca DSH Patch — Register DeepSeek Harness as a First-Class Orca Agent

> **中文版见 [README.zh.md](./README.zh.md)** · English version of this file.

> ⚠️ **Third-party, unofficial integration.** This project is a set of scripts that patch **Stably Orca** (`com.stablyai.orca`) so that **DSH** appears in Orca's agent picker and launches the **dsh-TUI** terminal UI in a pane. It **does not include or redistribute any of Orca's proprietary source** — it only performs anchored string injection against `app.asar` on your local machine at install time. Use it at your own risk and make sure it complies with Orca / DSH's licenses and terms of use.

Verified on **macOS**: Orca `1.4.190`, DSH CLI `0.1.1-rc.2`, dsh-TUI `@deepseek-harness-tui/dsh-tui ^0.9.x`.

## What it does

After patching, Orca behaves as it does for the built-in Claude Code / Codex:

- **DSH shows up in the Agent picker** (with a blue icon)
- Orca auto-**detects** whether the `dsh` CLI is installed (probes `dsh`)
- One-click launch of **dsh-TUI** (`dsh --profile dsh-tui`) in a pane — a Claude-Code-style **full-screen terminal TUI**: type prompts, watch live tool calls, see context-progress bars, resume sessions with `/resume`. **No browser involved.**
- Task text is injected through Orca's `stdin-after-start` (type into the pane's input box and hit Enter)
- The pane tab shows **🐋 DeepSeek Harness** (fixes the case where it was mislabeled "Gemini CLI" — see below)

> Note: DSH's web UI (`dsh web`) still exists and works — it's just another frontend; Orca uses the terminal TUI.

## Prerequisites

- **macOS** + Orca installed (this repo locates it by `com.stablyai.orca`; see "Actual install location")
- DSH CLI installed: `~/.local/bin/dsh`
- Node.js ≥ 18, and project dependencies installed at the repo root: `npm install` (only uses `@electron/asar`)

## Quick start

```bash
# 0) install this repo's dependency
npm install

# 1) build & verify only, do not install (artifacts in ./orca-dsh-build/, inspect first)
./orca-dsh-patch/patch.sh --stage

# 2) install into Orca (automatic: quit Orca → backup → replace → update integrity hash → re-sign)
./orca-dsh-patch/patch.sh --install

# 3) one-click rollback to the most recent backup if anything goes wrong
./orca-dsh-patch/patch.sh --rollback
```

> Orca not at the default location? Point to it with an env var: `ORCA_APP=/path/to/Orca.app ./orca-dsh-patch/patch.sh --install`

### Install the dsh-TUI profile (the terminal UI it launches DSH in)

The patch makes Orca launch DSH via `dsh --profile dsh-tui`. Install this TUI profile once before first use (requires npm registry access):

```bash
dsh plugin --profile dsh-tui add @deepseek-harness-tui/dsh-tui
# standalone check: dsh --profile dsh-tui
```

After that, in Orca **New Agent → pick DSH** → the dsh-TUI interface appears in the pane; just type and interact there.

## Actual install location & App Translocation

- On this machine the app may live at `~/Downloads/Orca.app` rather than `/Applications`. To check: `mdfind "kMDItemCFBundleIdentifier == 'com.stablyai.orca'"`.
- An app downloaded to Downloads and ad-hoc re-signed by this patch will be started by macOS through **App Translocation** (copied to a read-only temporary path). This is **normal and doesn't affect functionality**; `patch.sh` reads/writes `$APP` (default `/Applications/Orca.app`) — if the real path differs, pass it via `ORCA_APP`.
- Seeing `.../T/AppTranslocation/...` in the running process path is expected.

## Known limitations

| Item | Notes |
| --- | --- |
| **Orca auto-update reverts the patch** | Re-run `patch.sh --install` after an Orca upgrade (the script locates files by content and is idempotent/version-robust) |
| **Signature becomes ad-hoc** | The original Developer ID signature is replaced; macOS may ask you to re-grant "Screen Recording / Accessibility" etc. |
| **No fine-grained status reporting** | Orca's agent-hook protocol (e.g. codex-hook) is not wired up; DSH pane status falls back to process-level (running / exited) |
| **dsh-TUI version is independent** | It's a separate npm package and follows its own versioning; remember to `dsh plugin ... add` to update |

## Re-enabling the integration after an Orca upgrade

> This patch modifies Orca's official `app.asar` (including the signature), so **any Orca upgrade fully reverts it**. After an upgrade, DSH disappears from the picker and the tab logic reverts — this is expected behavior, not a bug. Re-enabling just means re-applying the patch once:

```bash
# 0) confirm Orca's actual path first (it may have moved)
APP="$(mdfind "kMDItemCFBundleIdentifier == 'com.stablyai.orca'")"; echo "$APP"

# 1) re-apply the patch (automatic: quit Orca → backup → replace → update hash → re-sign)
ORCA_APP="$APP" ./orca-dsh-patch/patch.sh --install
```

**How much of the re-apply is automated:**

| Layer | Behavior |
| --- | --- |
| Shared CJS files (`tui-agent-config`, `agent-title-core`, …) | Filenames are stable across versions — auto-match ✅ |
| Version-hashed bundles (`store-`, `daemon-ready-identity-`, `agent-catalog-`, …) | Located via **content probe** — found even when the hash changes ✅ |
| Internal structure / anchor strings | If Orca renames functions/fields/strings, anchors may not match ⚠️ |

**The two outcomes you might see:**

- **All green output** → patched fine; just restart Orca.
- **`ANCHOR x0` / `NO FILE` / missing `already-ok`** → the script **stops safely and writes nothing**; it won't corrupt the app. This is a fail-safe design — send the error to the maintainer to update the anchors, then re-run (this already happened on 1.4.184 → 1.4.190, and was fixed by switching to regex/content-based matching).
- If in doubt mid-way: `./orca-dsh-patch/patch.sh --rollback` returns to the most recent backup.

**Easiest thing to mistake for "it broke" after an upgrade:** every re-apply does an ad-hoc re-sign, and macOS may again ask you to grant "Screen Recording / Accessibility / Folder Access" etc. (depending on what the dsh-TUI uses). Just re-grant.

**Not affected by upgrades:** the DSH CLI, the `dsh-tui` profile, and your `~/.dsh` session data all live in separate locations; an Orca upgrade won't touch them.

## Changelog

### 2026-08-27 — Tab mislabeled "Gemini CLI" instead of "DeepSeek Harness" (fixed)

**Symptom:** when dsh-TUI is opened in Orca, the terminal pane tab is identified as **Gemini CLI**.

**Root cause:** dsh-TUI sets the OSC terminal title to `` `<✦> 🐋 <session title>` `` (the prefix becomes a `⠂/⠐` braille spinner while working). Orca's `isGeminiTerminalTitle` treats the **`✦`** in the title as a Gemini working-state marker, so — with no dsh rule present — it labels the tab **Gemini CLI**. In addition to `getAgentLabel`, there are two other paths that **rewrite the title directly** (`normalizeTerminalTitle`, `agent-title-identity`). dsh-TUI's **🐋 (U+1F40B, the DeepSeek whale)** is an unambiguous fingerprint, but no rule referenced it.

**Fix:** added `isDshTerminalTitle(title)` (matches `🐋` or the `dsh` title token), short-circuiting to `DSH`/`dsh` **before** all Gemini checks; `normalizeTerminalTitle` now outputs `` `🐋 DeepSeek Harness` `` for dsh titles; added the `DSH → dsh` label→agent mapping. Covered 6 recognition copies:

- `out/shared/agent-title-core.js` — adds & exports `isDshTerminalTitle`
- `out/shared/agent-title-identity.js` — `getAgentLabel` DSH branch
- `out/shared/terminal-title-agent-type.js` — `getAgentLabel` / `resolveTerminalTitleAgentType` + `DSH→dsh`
- `out/renderer/assets/store-*.js` — `getAgentLabel` / `getAgentLabel$1` / `TITLE_LABEL_TO_AGENT` / `normalizeTerminalTitle`
- `out/main/chunks/daemon-ready-identity-*.js` — `getAgentLabel` / `normalizeTerminalTitle`

**Verification:** `resolveTerminalTitleAgentType("✦ 🐋 Fix the auth bug")` → `dsh`; real Gemini (`✋ gemini` etc.) still → `gemini`; Claude/Codex unaffected; tab shows 🐋 DeepSeek Harness.

## Project structure

```
orca-dsh-patch/
├── patch.sh             # orchestration: extract → patch → repack-verify → install/rollback
└── lib/
    ├── apply-patches.js # 38 anchor/regex patches (each must match exactly once or it aborts; idempotent)
    ├── repack.js        # repack + per-file comparison vs the original (paths/unpacked-flag/content hash), zero-drift check
    ├── make-icon.js     # generates a 64×64 DSH icon PNG data URL (zero deps)
    └── dsh-icon.txt     # the icon data
orca-dsh-build/          # --stage artifacts (app.asar + app.asar.unpacked); deletable (gitignored)
```

## What the patch touches

**38** insertions total, locating files **by content** (renderer/main bundle names carry version hashes; the script fuzzy-matches via probes), so it's robust across Orca versions. Every patch site is marked with an `[orca-dsh-patch]` comment or a `dsh:` field.

**Shared layer CJS (main process / CLI)**
- `out/shared/tui-agent-config.js` — adds the `dsh` config: detect=`dsh`, launch=`dsh --profile dsh-tui`, stdin injection mode
- `out/shared/tui-agent-selection.js` — appends `dsh` to the auto-pick order
- `out/shared/agent-node-entrypoint-identities.js` — exact node entrypoint identity `node_modules/@deepseek-ai/dsh/lib/bin.js` → dsh
- `out/shared/agent-kind.js` / `agent-name-token-match.js` / `telemetry-events.js` — kind mapping / name tokens / telemetry enum
- `out/shared/agent-title-core.js` / `agent-title-identity.js` / `terminal-title-agent-type.js` — title recognition (tab label) DSH branch

**Main-process chunks** (`tui-agent-config-*`, `daemon-ready-identity-*`, version hashes vary)
- config copy, AGENT_NAMES, entrypoint identity, title recognition / `normalizeTerminalTitle`

**Renderer (desktop UI)** (`store-*`, `agent-catalog-*`, `agent-kind-*`, `agent-process-recognition-*`)
- config, `DSH` display label, iconable set, pick order, kind table, catalog entry + icon, process-recognition identity, title recognition / `normalizeTerminalTitle`

**Web client variants** (`out/web/assets/*`, best-effort)

## Repacking / layout notes

The original unpacked file set (~954 files) is reproduced by `repack.js` with an equivalent glob, then verified by comparing each file against the original asar header (path set, unpacked flags, content hash). Only the intended files may differ; any drift aborts the install, and it never touches `/Applications` until fully verified.

## Disclaimer

- This is a **community self-use integration script**; it is unaffiliated with DeepSeek / Stably. "DeepSeek", "Orca" and other trademarks belong to their respective owners.
- Patching a third-party app's signature and `app.asar` is an advanced operation — use it only if you accept Orca/DSH's licenses and terms, at your own risk.
- This repo does not bundle or redistribute any proprietary code from Orca or dsh-TUI.

## License

MIT (see the headers in each source file; the scripts are original code).