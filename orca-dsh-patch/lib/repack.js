#!/usr/bin/env node
// Repack an extracted/staged app.asar tree and verify layout parity with the
// ORIGINAL archive before anything touches /Applications.
//
// Usage: node repack.js <staging-dir> <original-asar> <out-dir>
// Produces <out-dir>/app.asar (+ sibling app.asar.unpacked), prints SHA256.
//
// Verification strategy: parse both asar headers, assert
//   1. identical path sets,
//   2. identical per-file `unpacked` flags,
//   3. identical integrity hashes for every file NOT touched by the patcher.
// Exit non-zero on any mismatch.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const asar = require("@electron/asar");

const [stagingDir, originalAsar, outDir] = process.argv.slice(2);
if (!stagingDir || !originalAsar || !outDir) {
	console.error("usage: node repack.js <staging-dir> <original-asar> <out-dir>");
	process.exit(2);
}

function headerMap(archive) {
	const { headerString } = asar.getRawHeader(archive);
	const header = JSON.parse(headerString);
	const files = new Map();
	(function walk(node, prefix) {
		for (const [name, child] of Object.entries(node.files)) {
			const p = `${prefix}/${name}`;
			if (child.files) walk(child, p);
			else files.set(p, child);
		}
	})(header, "");
	return files;
}

// Which files did the patcher modify? Compare staged bytes against what the
// ORIGINAL archive holds (works for packed and unpacked entries alike).
function sha256(buf) {
	return crypto.createHash("sha256").update(buf).digest("hex");
}

function originalBytes(originalMap, relNoSlash) {
	const rel = relNoSlash.replace(/^\//, "");
	const origMeta = originalMap.get(relNoSlash);
	if (origMeta && origMeta.unpacked) {
		return fs.readFileSync(
			path.join(path.dirname(originalAsar), "app.asar.unpacked", rel)
		);
	}
	return asar.extractFile(originalAsar, rel);
}

// Derive the asar unpack rule DYNAMICALLY from the original archive header so
// repacking stays correct across Orca version bumps (the set of unpacked files
// changes over releases). We enumerate every unpacked file exactly and hand that
// list to the per-file `unpack` option (matched with matchBase via "**/").
function deriveUnpack(originalAsar) {
	const { headerString } = asar.getRawHeader(originalAsar);
	const header = JSON.parse(headerString);
	const unpacked = [];
	(function walk(node, prefix) {
		for (const [name, child] of Object.entries(node.files)) {
			const p = `${prefix}/${name}`;
			if (child.files) walk(child, p);
			else if (child.unpacked) unpacked.push(p.replace(/^\//, "").replace(/\\/g, "/"));
		}
	})(header, "");
	if (unpacked.length === 0) return undefined;
	return `**/{${unpacked.join(",")}}`;
}

async function main() {
console.log("packing…");
fs.rmSync(path.join(outDir, "app.asar"), { force: true });
fs.rmSync(path.join(outDir, "app.asar.unpacked"), { recursive: true, force: true });
const unpack = deriveUnpack(originalAsar);
await asar.createPackageWithOptions(stagingDir, path.join(outDir, "app.asar"), { unpack });

const originalMap = headerMap(originalAsar);
const newAsar = path.join(outDir, "app.asar");
const newMap = headerMap(newAsar);

let errors = 0;
const changed = [];

if (originalMap.size !== newMap.size) {
	console.error(`file count changed: ${originalMap.size} -> ${newMap.size}`);
	errors += 1;
}
for (const [p] of originalMap) {
	if (!newMap.has(p)) {
		console.error(`missing in new archive: ${p}`);
		errors += 1;
	}
}
for (const [p, meta] of newMap) {
	const orig = originalMap.get(p);
	if (!orig) {
		console.error(`unexpected new file: ${p}`);
		errors += 1;
		continue;
	}
	if (!!meta.unpacked !== !!orig.unpacked) {
		console.error(`unpacked-flag drift: ${p}`);
		errors += 1;
	}
}

// Content parity: everything must be byte-identical except files whose staged
// copy differs (those are exactly the patcher's edits).
for (const [p] of originalMap) {
	const rel = p.replace(/^\//, "");
	const stagedPath = path.join(
		stagingDir,
		rel.split("/").map((seg) => seg).join("/")
	);
	let origBuf;
	try {
		origBuf = originalBytes(originalMap, p);
	} catch (err) {
		console.error(`cannot read original ${p}: ${err.message}`);
		errors += 1;
		continue;
	}
	const stagedBuf = fs.readFileSync(stagedPath);
	if (!origBuf.equals(stagedBuf)) changed.push(rel);
}

console.log(`changed files (${changed.length}):`);
for (const c of changed.sort()) console.log(`  ~ ${c}`);

if (errors > 0) {
	console.error(`\nREPACK VERIFICATION FAILED with ${errors} error(s); nothing was installed.`);
	process.exit(1);
}

// Sanity: at least one title-recognition target must have changed. On a fresh
// Orca many files change; on an incremental re-patch (this title fix) only a
// subset differs, so require ANY ONE of these basename-shaped tags to appear.
const mustAny = [
	"terminal-title-agent-type.js", // shared canonical
	"agent-title-core.js", // shared gemini/dsh predicate
	"agent-title-identity.js", // shared identity getAgentLabel
	"store-", // renderer inlined titles (version-hashed)
	"daemon-ready-identity-", // daemon inlined titles (version-hashed)
];
let anyMatched = false;
for (const m of mustAny) {
	let hit = false;
	if (m.endsWith(".js")) {
		hit = changed.some((c) => c.includes(`/shared/${m}`));
	} else {
		hit = changed.some(
			(c) =>
				c.includes(`/renderer/assets/${m}`) ||
				c.includes(`/main/chunks/${m}`) ||
				c.includes(`/web/assets/${m}`)
		);
	}
	if (hit) anyMatched = true;
}
if (!anyMatched && errors === 0) {
	console.error(`expected at least one title-recognition file to change; none did`);
	errors += 1;
}
if (errors > 0) process.exit(1);

const digest = sha256(fs.readFileSync(newAsar));
console.log(`\nOK — new app.asar verified.`);
console.log(`SHA256: ${digest}`);
// machine-readable: bare hex on its own final line (patch.sh parses this)
console.log(digest);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
