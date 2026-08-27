#!/usr/bin/env node
// Apply the "DSH as a first-class Orca agent" patches to an extracted app.asar tree.
//
// Usage: node apply-patches.js <staging-dir> [--lenient-web]
//   Every REQUIRED patch must match exactly once, otherwise the script exits
//   non-zero leaving earlier files patched (re-running is idempotent-aware:
//   already-patched files are detected and skipped).
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const stagingDir = process.argv[2];
if (!stagingDir) {
	console.error("usage: node apply-patches.js <staging-dir> [--lenient-web]");
	process.exit(2);
}
const lenientWeb = process.argv.includes("--lenient-web");

const iconDataUrl = fs
	.readFileSync(path.join(__dirname, "dsh-icon.txt"), "utf8")
	.trim();
if (!iconDataUrl.startsWith("data:image/png;base64,")) {
	console.error("bad dsh-icon.txt");
	process.exit(2);
}

// --- patch payload snippets -------------------------------------------------

const CJS_DSH_CONFIG_ENTRY = `    // Why: [orca-dsh-patch] DeepSeek Harness exposed as a native terminal TUI
    // (dsh-TUI profile) so it runs and is interacted with entirely inside the
    // Orca pane -- no browser. Tasks arrive via stdin-after-start.
    dsh: {
        detectCmd: 'dsh',
        launchCmd: 'dsh --profile dsh-tui',
        expectedProcess: 'dsh',
        promptInjectionMode: 'stdin-after-start'
    },
`;

const ESM_DSH_CONFIG_ENTRY_TABS = `	dsh: {
		detectCmd: "dsh",
		launchCmd: "dsh --profile dsh-tui",
		expectedProcess: "dsh",
		promptInjectionMode: "stdin-after-start"
	},
`;

const MINIFIED_DSH_CONFIG_ENTRY =
	'dsh:{detectCmd:"dsh",launchCmd:"dsh --profile dsh-tui",expectedProcess:"dsh",promptInjectionMode:"stdin-after-start"},';

// Content signatures used to resolve version-hashed bundle filenames robustly.
const TUI_AGENT_CONFIG_PROBE = "const TUI_AGENT_CONFIG = {";
const EXACT_ENTRYPOINT_PROBE =
	'node_modules\\/prime-agent\\/dist\\/bundle\\/cli\\.js';

function cjsIdentityEntry() {
	return `    {
        pattern: /(?:^|\\/)node_modules\\/@deepseek-ai\\/dsh\\/lib\\/bin\\.js$/,
        agent: 'dsh',
        processName: 'dsh'
    }
];`;
}

function tabsIdentityEntry() {
	return `	{
		pattern: /(?:^|\\/)node_modules\\/@deepseek-ai\\/dsh\\/lib\\/bin\\.js$/,
		agent: "dsh",
		processName: "dsh"
	}
];`;
}

// --- DSH terminal-title recognition ----------------------------------------
// dsh-TUI sets the pane title to "<spinner> 🐋 <sessionTitle>". Orca's
// title→agent resolution treats the leading ✦/⠂ spinner as a *Gemini CLI*
// marker (isGeminiTerminalTitle), so the dsh tab shows "Gemini CLI". The
// unambiguous dsh signature is the DeepSeek whale 🐋 (U+1F40B); we detect it
// (or an explicit `dsh` title token) and return "DSH" *before* the Gemini rule.

const DSH_WHALE = "🐋";
const TITLE_TITLE = "terminal-title";

function sharedDshTitleFnCode() {
	return `
function isDshTerminalTitle(title) {
    // Why: [orca-dsh-patch] dsh-TUI brands its OSC title with the DeepSeek whale.
    if (!title) return false;
    if (title.includes('${DSH_WHALE}')) return true;
    return (0, agent_name_token_match_1.titleHasAgentName)(title, 'dsh');
}
`;
}

function inlinedDshTitleFnCode() {
	return `
// Why: [orca-dsh-patch] dsh-TUI brands its OSC title with the DeepSeek whale.
function isDshTerminalTitle(title) {
	if (!title) return false;
	if (title.includes("${DSH_WHALE}")) return true;
	return titleHasAgentName(title, "dsh");
}
`;
}

function sharedDshLabelEntry() {
	return `    OMP: 'omp',
    DSH: 'dsh'
};`;
}

function sharedDshLabelAnchor() {
	return `    OMP: 'omp'
};`;
}

function inlinedDshLabelEntry() {
	return `	OMP: "omp",
	DSH: "dsh"
};`;
}

function inlinedDshLabelAnchor() {
	return `	OMP: "omp"
};`;
}

// --- patch table -------------------------------------------------------------

// rel: path inside extracted tree (also relative to out/ for renderer/web pairs)
// required: fail hard when anchor not found exactly once (web variants are optional)
const PATCHES = [
	{
		id: "shared-config",
		rel: "out/shared/tui-agent-config.js",
		required: true,
		anchor: "exports.TUI_AGENT_CONFIG = {\n",
		replacement: `exports.TUI_AGENT_CONFIG = {\n${CJS_DSH_CONFIG_ENTRY}`
	},
	{
		id: "shared-selection-order",
		rel: "out/shared/tui-agent-selection.js",
		required: true,
		already: "'openclaw',\n    'dsh'\n];",
		anchor: "    'devin',\n    'openclaw'\n];",
		replacement: "    'devin',\n    'openclaw',\n    'dsh'\n];"
	},
	{
		id: "shared-entrypoint-identity",
		rel: "out/shared/agent-node-entrypoint-identities.js",
		required: true,
		already: "node_modules\\/@deepseek-ai\\/dsh\\/lib\\/bin",
		anchor:
			"    {\n        pattern: /(?:^|\\/)node_modules\\/prime-agent\\/dist\\/bundle\\/cli\\.js$/,\n        agent: 'prime-agent',\n        processName: 'prime-agent'\n    }\n];",
		replacement:
			"    {\n        pattern: /(?:^|\\/)node_modules\\/prime-agent\\/dist\\/bundle\\/cli\\.js$/,\n        agent: 'prime-agent',\n        processName: 'prime-agent'\n    },\n" +
			cjsIdentityEntry()
	},
	{
		id: "shared-agent-kind",
		rel: "out/shared/agent-kind.js",
		required: true,
		already: "openclaw: 'openclaw',\n    dsh: 'dsh',",
		anchor: "    openclaw: 'openclaw',\n    copilot: 'copilot',",
		replacement:
			"    openclaw: 'openclaw',\n    dsh: 'dsh',\n    copilot: 'copilot',"
	},
	{
		id: "shared-telemetry-enum",
		rel: "out/shared/telemetry-events.js",
		required: true,
		anchor: "    'openclaw',\n    'copilot',\n    'grok',",
		replacement: "    'openclaw',\n    'copilot',\n    'grok',\n    'dsh',"
	},
	{
		id: "shared-name-token-match",
		rel: "out/shared/agent-name-token-match.js",
		required: true,
		anchor: "    'mimo',\n    'openclaw',",
		replacement: "    'mimo',\n    'openclaw',\n    'dsh',"
	},
	{
		id: "main-chunk-config",
		dir: "out/main/chunks",
		glob: { prefix: "tui-agent-config-", probe: TUI_AGENT_CONFIG_PROBE },
		required: true,
		already: "const TUI_AGENT_CONFIG = {\n\tdsh: {",
		anchor: "const TUI_AGENT_CONFIG = {\n",
		replacement: `const TUI_AGENT_CONFIG = {\n${ESM_DSH_CONFIG_ENTRY_TABS}`
	},
	{
		id: "daemon-agent-names",
		dir: "out/main/chunks",
		glob: { prefix: "daemon-ready-identity-", probe: EXACT_ENTRYPOINT_PROBE },
		required: true,
		already: '\t"devin",\n\t"dsh"\n];',
		anchor: '\t"aider",\n\t"grok",\n\t"devin"\n];',
		replacement: '\t"aider",\n\t"grok",\n\t"devin",\n\t"dsh"\n];'
	},
	{
		id: "daemon-entrypoint-identity",
		dir: "out/main/chunks",
		glob: { prefix: "daemon-ready-identity-", probe: EXACT_ENTRYPOINT_PROBE },
		required: true,
		already: "node_modules\\/@deepseek-ai\\/dsh\\/lib\\/bin",
		anchor:
			'\t{\n\t\tpattern: /(?:^|\\/)node_modules\\/prime-agent\\/dist\\/bundle\\/cli\\.js$/,\n\t\tagent: "prime-agent",\n\t\tprocessName: "prime-agent"\n\t}\n];',
		replacement:
			'\t{\n\t\tpattern: /(?:^|\\/)node_modules\\/prime-agent\\/dist\\/bundle\\/cli\\.js$/,\n\t\tagent: "prime-agent",\n\t\tprocessName: "prime-agent"\n\t},\n' +
			tabsIdentityEntry()
	},
	{
		id: "renderer-config",
		dir: "out/renderer/assets",
		glob: { prefix: "store-", probe: TUI_AGENT_CONFIG_PROBE },
		required: true,
		already: "const TUI_AGENT_CONFIG = {\n\tdsh: {",
		anchor: "const TUI_AGENT_CONFIG = {\n\tclaude: {",
		replacement: `const TUI_AGENT_CONFIG = {\n${ESM_DSH_CONFIG_ENTRY_TABS}\tclaude: {`
	},
	{
		id: "renderer-labels",
		dir: "out/renderer/assets",
		glob: { prefix: "store-", probe: TUI_AGENT_CONFIG_PROBE },
		required: true,
		already: 'kimi: "Kimi",\n\tdsh: "DSH"',
		anchor: '\tkimi: "Kimi"\n};',
		replacement: '\tkimi: "Kimi",\n\tdsh: "DSH"\n};'
	},
	{
		id: "renderer-iconable",
		dir: "out/renderer/assets",
		glob: { prefix: "store-", probe: TUI_AGENT_CONFIG_PROBE },
		required: true,
		already: "\tante: true,\n\ttrae: true,\n\tdsh: true",
		anchor: "\tante: true,\n\ttrae: true\n};",
		replacement: "\tante: true,\n\ttrae: true,\n\tdsh: true\n};"
	},
	{
		id: "renderer-pick-order",
		dir: "out/renderer/assets",
		glob: { prefix: "store-", probe: TUI_AGENT_CONFIG_PROBE },
		required: true,
		already: '\t"openclaw",\n\t"dsh"\n];',
		anchor: '\t"devin",\n\t"openclaw"\n];',
		replacement: '\t"devin",\n\t"openclaw",\n\t"dsh"\n];'
	},
	{
		id: "renderer-agent-kind",
		dir: "out/renderer/assets",
		glob: { prefix: "telemetry-", probe: "TUI_AGENT_KIND_BY_AGENT" },
		required: true,
		already: '\ttrae: "trae",\n\tdsh: "dsh"',
		anchor: '\tante: "ante",\n\ttrae: "trae"\n};',
		replacement: '\tante: "ante",\n\ttrae: "trae",\n\tdsh: "dsh"\n};'
	},
	{
		id: "renderer-catalog-icon-var",
		dir: "out/renderer/assets",
		glob: { prefix: "agent-catalog-", probe: "openclaw_default" },
		required: true,
		already: "var dsh_logo_default",
		regex: /var openclaw_default = "data:image\/png;base64,[^"]+";\n/,
		replacementFactory: (matched) =>
			`${matched}var dsh_logo_default = "${iconDataUrl.slice(
				"data:image/png;base64,".length
			)}";\n`
	},
	{
		id: "renderer-catalog-icon-map",
		dir: "out/renderer/assets",
		glob: { prefix: "agent-catalog-", probe: "openclaw_default" },
		required: true,
		already: "\topenclaw: openclaw_default,\n\tdsh: dsh_logo_default",
		anchor: "\topenclaw: openclaw_default\n};",
		replacement: "\topenclaw: openclaw_default,\n\tdsh: dsh_logo_default\n};"
	},
	{
		id: "renderer-catalog-entry",
		dir: "out/renderer/assets",
		glob: { prefix: "agent-catalog-", probe: "openclaw_default" },
		required: true,
		already: 'id: "dsh",',
		anchor:
			'\t{\n\t\tid: "openclaw",\n\t\tlabel: translate("auto.lib.agent.catalog.5dff448636", "OpenClaw"),\n\t\tcmd: "openclaw",\n\t\tfaviconDomain: "openclaw.ai",\n\t\thomepageUrl: "https://github.com/openclaw/openclaw"\n\t}\n]);',
		replacement:
			'\t{\n\t\tid: "openclaw",\n\t\tlabel: translate("auto.lib.agent.catalog.5dff448636", "OpenClaw"),\n\t\tcmd: "openclaw",\n\t\tfaviconDomain: "openclaw.ai",\n\t\thomepageUrl: "https://github.com/openclaw/openclaw"\n\t},\n\t{\n\t\tid: "dsh",\n\t\tlabel: translate("auto.lib.agent.catalog.dsh_label", "DSH"),\n\t\tcmd: getTuiAgentLaunchCommand(TUI_AGENT_CONFIG["dsh"], getCatalogPlatform()),\n\t\ticonUrl: dsh_logo_default,\n\t\thomepageUrl: "https://github.com/deepseek-ai/deepseek-harness"\n\t}\n]);'
	},
	{
		id: "renderer-process-recognition",
		dir: "out/renderer/assets",
		glob: { prefix: "agent-process-recognition-", probe: EXACT_ENTRYPOINT_PROBE },
		required: true,
		already: "node_modules\\/@deepseek-ai\\/dsh\\/lib\\/bin",
		anchor:
			'\t{\n\t\tpattern: /(?:^|\\/)node_modules\\/prime-agent\\/dist\\/bundle\\/cli\\.js$/,\n\t\tagent: "prime-agent",\n\t\tprocessName: "prime-agent"\n\t}\n];',
		replacement:
			'\t{\n\t\tpattern: /(?:^|\\/)node_modules\\/prime-agent\\/dist\\/bundle\\/cli\\.js$/,\n\t\tagent: "prime-agent",\n\t\tprocessName: "prime-agent"\n\t},\n' +
			tabsIdentityEntry()
	},
	// ---- DSH terminal-title recognition (tab says "Gemini CLI" fix) ----------
	{
		id: "shared-title-dsh-fn",
		rel: "out/shared/terminal-title-agent-type.js",
		required: true,
		already: "function isDshTerminalTitle(title) {",
		anchor: "function getAgentLabel(title) {",
		replacement: sharedDshTitleFnCode() + "function getAgentLabel(title) {"
	},
	{
		id: "shared-title-dsh-export",
		rel: "out/shared/terminal-title-agent-type.js",
		required: true,
		already: "exports.isDshTerminalTitle = isDshTerminalTitle;",
		anchor: "exports.isGeminiTerminalTitle = isGeminiTerminalTitle;",
		replacement:
			"exports.isGeminiTerminalTitle = isGeminiTerminalTitle;\nexports.isDshTerminalTitle = isDshTerminalTitle;"
	},
	{
		id: "shared-title-dsh-gemini-pass",
		rel: "out/shared/terminal-title-agent-type.js",
		required: true,
		already: "    if (isDshTerminalTitle(title)) {\n        return 'DSH';",
		anchor:
			"    if (isGeminiTerminalTitle(title)) {\n        return 'Gemini CLI';\n    }",
		replacement:
			"    if (isDshTerminalTitle(title)) {\n        return 'DSH';\n    }\n    if (isGeminiTerminalTitle(title)) {\n        return 'Gemini CLI';\n    }"
	},
	{
		id: "shared-title-dsh-map",
		rel: "out/shared/terminal-title-agent-type.js",
		required: true,
		already: "    OMP: 'omp',\n    DSH: 'dsh'\n};",
		anchor: sharedDshLabelAnchor(),
		replacement: sharedDshLabelEntry()
	},
	{
		id: "renderer-title-dsh-fn",
		dir: "out/renderer/assets",
		glob: { prefix: "store-", probe: TUI_AGENT_CONFIG_PROBE },
		required: true,
		already: "function isDshTerminalTitle(title) {",
		anchor: "function getAgentLabel(title) {",
		replacement: inlinedDshTitleFnCode() + "function getAgentLabel(title) {"
	},
	{
		id: "renderer-title-dsh-pass",
		dir: "out/renderer/assets",
		glob: { prefix: "store-", probe: TUI_AGENT_CONFIG_PROBE },
		required: true,
		already: 'if (isDshTerminalTitle(title)) return "DSH";',
		anchor: 'if (isGeminiTerminalTitle(title)) return "Gemini CLI";',
		replacement: 'if (isDshTerminalTitle(title)) return "DSH";\n\tif (isGeminiTerminalTitle(title)) return "Gemini CLI";'
	},
	{
		id: "renderer-title-dsh-pass-1",
		dir: "out/renderer/assets",
		glob: { prefix: "store-", probe: TUI_AGENT_CONFIG_PROBE },
		required: true,
		already:
			'if (isDshTerminalTitle(title)) return "DSH";\n\tif (isGeminiTerminalTitle$1(title)) return "Gemini CLI";',
		anchor: 'if (isGeminiTerminalTitle$1(title)) return "Gemini CLI";',
		replacement: 'if (isDshTerminalTitle(title)) return "DSH";\n\tif (isGeminiTerminalTitle$1(title)) return "Gemini CLI";'
	},
	{
		id: "renderer-title-dsh-map",
		dir: "out/renderer/assets",
		glob: { prefix: "store-", probe: TUI_AGENT_CONFIG_PROBE },
		required: true,
		already: "\tOMP: \"omp\",\n\tDSH: \"dsh\"\n};",
		anchor: inlinedDshLabelAnchor(),
		replacement: inlinedDshLabelEntry()
	},
	{
		id: "daemon-title-dsh-fn",
		dir: "out/main/chunks",
		glob: { prefix: "daemon-ready-identity-", probe: EXACT_ENTRYPOINT_PROBE },
		required: true,
		already: "function isDshTerminalTitle(title) {",
		anchor: "function getAgentLabel(title) {",
		replacement: inlinedDshTitleFnCode() + "function getAgentLabel(title) {"
	},
	{
		id: "daemon-title-dsh-pass",
		dir: "out/main/chunks",
		glob: { prefix: "daemon-ready-identity-", probe: EXACT_ENTRYPOINT_PROBE },
		required: true,
		already: '\tif (isDshTerminalTitle(title)) return "DSH";',
		anchor: '\tif (isGeminiTerminalTitle(title)) return "Gemini CLI";',
		replacement: '\tif (isDshTerminalTitle(title)) return "DSH";\n\tif (isGeminiTerminalTitle(title)) return "Gemini CLI";'
	},
	{
		id: "renderer-title-dsh-normalize",
		dir: "out/renderer/assets",
		glob: { prefix: "store-", probe: TUI_AGENT_CONFIG_PROBE },
		required: true,
		already: 'return "\\u{1F40B} DeepSeek Harness";',
		// matches a fresh normalizeTerminalTitle (no dsh line) OR a previously
		// patched one with `return title;`, so both the fresh-app and the
		// incremental-upgrade paths converge on the branded form.
		regex:
			/function normalizeTerminalTitle\(title\) \{\n\tif \(!title\) return title;\n(?:\tif \(isDshTerminalTitle\(title\)\) return title;\n)?\tif \(isGeminiTerminalTitle\(title\)\) \{/,
		replacementFactory: () =>
			'function normalizeTerminalTitle(title) {\n\tif (!title) return title;\n\tif (isDshTerminalTitle(title)) return "\\u{1F40B} DeepSeek Harness";\n\tif (isGeminiTerminalTitle(title)) {'
	},
	{
		id: "daemon-title-dsh-normalize",
		dir: "out/main/chunks",
		glob: { prefix: "daemon-ready-identity-", probe: EXACT_ENTRYPOINT_PROBE },
		required: true,
		already: 'return "\\u{1F40B} DeepSeek Harness";',
		regex:
			/function normalizeTerminalTitle\(title\) \{\n\tif \(!title\) return title;\n(?:\tif \(isDshTerminalTitle\(title\)\) return title;\n)?\tif \(isGeminiTerminalTitle\(title\)\) \{/,
		replacementFactory: () =>
			'function normalizeTerminalTitle(title) {\n\tif (!title) return title;\n\tif (isDshTerminalTitle(title)) return "\\u{1F40B} DeepSeek Harness";\n\tif (isGeminiTerminalTitle(title)) {'
	},
	{
		id: "core-title-dsh-fn",
		rel: "out/shared/agent-title-core.js",
		required: true,
		already: "function isDshTerminalTitle(title) {",
		anchor: "    return (0, agent_name_token_match_1.titleHasAgentName)(title, 'gemini');\n}",
		replacement:
			"    return (0, agent_name_token_match_1.titleHasAgentName)(title, 'gemini');\n}\nfunction isDshTerminalTitle(title) {\n    // Why: [orca-dsh-patch] dsh-TUI brands its OSC title with the DeepSeek whale.\n    if (!title) { return false; }\n    if (title.includes('\\u{1F40B}')) { return true; }\n    return (0, agent_name_token_match_1.titleHasAgentName)(title, 'dsh');\n}"
	},
	{
		id: "core-title-dsh-export",
		rel: "out/shared/agent-title-core.js",
		required: true,
		already: "exports.isDshTerminalTitle = isDshTerminalTitle;",
		anchor: "exports.isGeminiTerminalTitle = isGeminiTerminalTitle;",
		replacement:
			"exports.isGeminiTerminalTitle = isGeminiTerminalTitle;\nexports.isDshTerminalTitle = isDshTerminalTitle;"
	},
	{
		id: "identity-title-dsh-pass",
		rel: "out/shared/agent-title-identity.js",
		required: true,
		already:
			"    if ((0, agent_title_core_1.isDshTerminalTitle)(title)) {\n        return 'DSH';",
		anchor:
			"    if ((0, agent_title_core_1.isGeminiTerminalTitle)(title)) {\n        return 'Gemini CLI';\n    }",
		replacement:
			"    if ((0, agent_title_core_1.isDshTerminalTitle)(title)) {\n        return 'DSH';\n    }\n    if ((0, agent_title_core_1.isGeminiTerminalTitle)(title)) {\n        return 'Gemini CLI';\n    }"
	},
	// ---- web (browser client) variants: best-effort -------------------------
	{
		id: "web-config",
		dir: "out/web/assets",
		glob: { prefix: "store-", probe: 'detectCmd:"claude"' },
		required: false,
		anchor: 'const Dt={claude:{detectCmd:"claude",launchCmd:"claude"',
		replacement: `const Dt={${MINIFIED_DSH_CONFIG_ENTRY}claude:{detectCmd:"claude",launchCmd:"claude"`
	},
	{
		id: "web-labels",
		dir: "out/web/assets",
		glob: { prefix: "store-", probe: 'detectCmd:"claude"' },
		required: false,
		anchor: 'trae:"Trae",kimi:"Kimi"}',
		replacement: 'trae:"Trae",kimi:"Kimi",dsh:"DSH"}'
	},
	{
		id: "web-iconable",
		dir: "out/web/assets",
		glob: { prefix: "store-", probe: 'detectCmd:"claude"' },
		required: false,
		anchor: "ante:!0,trae:!0}",
		replacement: "ante:!0,trae:!0,dsh:!0}"
	},
	{
		id: "web-pick-order",
		dir: "out/web/assets",
		glob: { prefix: "store-", probe: 'detectCmd:"claude"' },
		required: false,
		anchor: '"devin","openclaw"]',
		replacement: '"devin","openclaw","dsh"]'
	},
	{
		id: "web-agent-kind",
		dir: "out/web/assets",
		glob: { prefix: "store-", probe: 'detectCmd:"claude"' },
		required: false,
		anchor: "trae:\"trae\"}",
		replacement: 'trae:"trae",dsh:"dsh"}'
	}
];

// --- applier ----------------------------------------------------------------

// Resolve a patch target to a concrete path inside stagingDir.
//   patch.rel  == exact path (unchanged names)            -> used as-is
//   patch.glob == basename prefix to search under a dir    -> matched with patch.probe
function resolveTarget(stagingDir, patch) {
	if (patch.rel) {
		const abs = path.join(stagingDir, patch.rel);
		return fs.existsSync(abs) ? abs : null;
	}
	if (!patch.glob) return patch.rel == null ? null : path.join(stagingDir, patch.rel);
	const dir = path.join(stagingDir, patch.dir || "out/renderer/assets");
	let names = [];
	try {
		names = fs.readdirSync(dir);
	} catch {
		return null;
	}
	const prefix =
		typeof patch.glob === "string"
			? patch.glob
			: patch.glob.prefix; // glob: {prefix, probe?}
	const suffix = patch.glob.suffix || "";
	const probe = patch.glob.probe;
	let candidates = names.filter((n) => n.startsWith(prefix) && n.endsWith(suffix));
	if (probe) {
		candidates = candidates.filter((n) =>
			fs.readFileSync(path.join(dir, n), "utf8").includes(probe)
		);
	}
	if (candidates.length === 1) return path.join(dir, candidates[0]);
	if (candidates.length > 1) {
		console.error(`AMBIGUOUS ${patch.id}: candidates ${candidates.join(", ")}`);
		return null;
	}
	console.error(`NO FILE for ${patch.id}: no ${prefix}*${suffix} in ${patch.dir || "out/renderer/assets"}`);
	return null;
}

let failures = 0;
let applied = 0;
let skippedAlready = 0;
const touchedFiles = new Set();

for (const patch of PATCHES) {
	const abs = resolveTarget(stagingDir, patch);
	if (!abs) {
		if (patch.required) failures += 1;
		console.error(`MISSING  ${patch.id} (${patch.rel || patch.glob?.prefix})`);
		continue;
	}
	const src = fs.readFileSync(abs, "utf8");

	const alreadyPatched =
		patch.already !== undefined
			? src.includes(patch.already)
			: src.includes("orca-dsh-patch") ||
			  src.includes('id: "dsh"') ||
			  src.includes("\ndsh: {") ||
			  src.includes("isDshTerminalTitle");
	if (alreadyPatched) {
		skippedAlready += 1;
		touchedFiles.add(patch.rel);
		console.log(`already-ok    ${patch.id} (${patch.rel})`);
		continue;
	}
	let count;
	let next;
	if (patch.regex) {
		const matches = src.match(new RegExp(patch.regex.source, "g")) ?? [];
		count = matches.length;
		next =
			count === 1
				? src.replace(patch.regex, patch.replacementFactory(matches[0]))
				: src;
	} else {
		count = src.split(patch.anchor).length - 1;
		next = count === 1 ? src.replace(patch.anchor, patch.replacement) : src;
	}

	if (count === 1) {
		fs.writeFileSync(abs, next);
		applied += 1;
		touchedFiles.add(patch.rel);
		console.log(`applied       ${patch.id} -> ${patch.rel}`);
	} else if (!patch.required && count === 0) {
		skippedAlready += 1;
		console.log(`skipped(opt)  ${patch.id}: anchor not found (web variant changed?)`);
	} else {
		failures += 1;
		console.error(
			`ANCHOR x${count}     ${patch.id}: expected exactly 1 occurrence in ${patch.rel}${patch.required ? "" : " (optional)"}`
		);
	}
}

console.log(
	`\n${applied} applied, ${skippedAlready} skipped, ${failures} failures, ${touchedFiles.size} files touched`
);
process.exit(failures > 0 ? 1 : 0);
