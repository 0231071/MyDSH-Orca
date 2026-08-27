#!/usr/bin/env node
// Generate the DSH agent icon as a 64x64 PNG data URL (no external deps).
// DeepSeek-blue rounded square with a white "D" glyph.
"use strict";

const zlib = require("node:zlib");

const SIZE = 64;
const BG = [0x4d, 0x6b, 0xfe]; // DeepSeek blue
const RADIUS = 13;

function insideRoundedRect(x, y) {
	const r = RADIUS;
	const cx = Math.min(Math.max(x, r), SIZE - 1 - r);
	const cy = Math.min(Math.max(y, r), SIZE - 1 - r);
	const dx = x - cx;
	const dy = y - cy;
	return dx * dx + dy * dy <= r * r;
}

// White "D": stem rect x[20..28] y[14..49], bowl = half annulus centered (28,32), outer r 18, inner r 10.
function insideD(x, y) {
	if (y < 14 || y > 49 || x < 20 || x > 46) return false;
	if (x <= 28) return true; // stem
	const dx = x - 28;
	const dy = y - 32;
	const d2 = dx * dx + dy * dy;
	return d2 <= 18 * 18 && d2 >= 10 * 10;
}

function sample(px, py) {
	// 3x3 supersample for smooth edges
	let cover = 0;
	for (let sy = 0; sy < 3; sy += 1) {
		for (let sx = 0; sx < 3; sx += 1) {
			const x = px + (sx + 0.5) / 3;
			const y = py + (sy + 0.5) / 3;
			if (!insideRoundedRect(x, y)) continue;
			cover += insideD(x, y) ? 1 : 1 - 1; // bg pixel counts once
			if (insideD(x, y)) continue;
			cover += 2; // plain bg adds two extra thirds so totals stay consistent
		}
	}
	return cover;
}

function buildRawImage() {
	const rows = [];
	for (let py = 0; py < SIZE; py += 1) {
		const row = Buffer.alloc(1 + SIZE * 4);
		row[0] = 0; // filter: none
		for (let px = 0; px < SIZE; px += 1) {
			let r = 0, g = 0, b = 0, aCount = 0;
			for (let sy = 0; sy < 3; sy += 1) {
				for (let sx = 0; sx < 3; sx += 1) {
					const x = px + (sx + 0.5) / 3;
					const y = py + (sy + 0.5) / 3;
					if (!insideRoundedRect(x, y)) continue;
					aCount += 1;
					if (insideD(x, y)) {
						r += 255; g += 255; b += 255;
					} else {
						r += BG[0]; g += BG[1]; b += BG[2];
					}
				}
			}
			const o = 1 + px * 4;
			if (aCount === 0) {
				row[o] = 0; row[o + 1] = 0; row[o + 2] = 0; row[o + 3] = 0;
			} else {
				row[o] = Math.round(r / aCount);
				row[o + 1] = Math.round(g / aCount);
				row[o + 2] = Math.round(b / aCount);
				row[o + 3] = Math.round((aCount / 9) * 255);
			}
		}
		rows.push(row);
	}
	return Buffer.concat(rows);
}

function crc32(buf) {
	let c = ~0;
	for (let i = 0; i < buf.length; i += 1) {
		c ^= buf[i];
		for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
	}
	return ~c >>> 0;
}

function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([len, body, crc]);
}

function encodePng(raw) {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(SIZE, 0);
	ihdr.writeUInt32BE(SIZE, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // color type RGBA
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		chunk("IDAT", zlib.deflateSync(raw)),
		chunk("IEND", Buffer.alloc(0))
	]);
}

const png = encodePng(buildRawImage());
process.stdout.write(`data:image/png;base64,${png.toString("base64")}`);
