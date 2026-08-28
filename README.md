# Orca DSH — DeepSeek Harness as a first-class Orca agent

[中文](./README.zh.md) · [English](./README.en.md)

> ⚠️ **Third-party, unofficial integration.** Scripts that patch **Stably Orca** (`com.stablyai.orca`) so that **DSH** appears in Orca's agent picker and launches the **dsh-TUI** terminal UI in a pane. Does **not** include or redistribute Orca's proprietary source — only anchored injection against `app.asar` at install time. Use at your own risk; check Orca/DSH licenses/terms.

---

## What it does

- **DSH appears in Orca's Agent picker** (blue icon), and Orca auto-detects the `dsh` CLI
- One-click launch of **dsh-TUI** (`dsh --profile dsh-tui`) — a Claude-Code-style full-screen terminal TUI in the pane (no browser)
- Pane tab shows **🐋 DeepSeek Harness** (fixed a bug where it was mislabeled "Gemini CLI")

Verified on **macOS**: Orca `1.4.190`, DSH CLI `0.1.1-rc.2`, dsh-TUI `^0.9.x`.

## Quick start

```bash
npm install
./orca-dsh-patch/patch.sh --install    # quit Orca → backup → patch → re-sign
./orca-dsh-patch/patch.sh --rollback   # restore latest backup if needed

# first time only — dsh-TUI profile:
dsh plugin --profile dsh-tui add @deepseek-harness-tui/dsh-tui
```

Orca not at the default path? `ORCA_APP=/path/to/Orca.app ./orca-dsh-patch/patch.sh --install`

## ⚠️ After Orca auto-updates

Orca upgrades fully revert the patch (DSH disappears from the picker). Re-enable with one command:

```bash
APP="$(mdfind "kMDItemCFBundleIdentifier == 'com.stablyai.orca'")"
ORCA_APP="$APP" ./orca-dsh-patch/patch.sh --install
```

It's fail-safe: if anchors don't match a new Orca build, the script stops and writes nothing (won't corrupt the app). If you see `ANCHOR x0` / `NO FILE`, share the error so the anchors can be updated.

---

**Full details:** [中文版 README.zh.md](./README.zh.md) · [English README.en.md](./README.en.md)

## License

MIT