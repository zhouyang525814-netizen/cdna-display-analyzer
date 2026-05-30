// Parity test: TS bandedAlign vs Rust→WASM bandedAlign must agree on every
// input. Both back the same DualAnchorScorer, and the engine will switch
// between them at runtime via `useWasm`; if they ever diverge, per-site
// extraction (and thus variant counts) become path-dependent.
//
// Strategy: a small handcrafted set of edge cases + a deterministic fuzz of
// 200 random anchor/haystack pairs across a representative parameter grid.

import { describe, expect, it } from "vitest";
import { bandedAlign } from "../src/banded-align.js";
import { wasmBandedAlign } from "../src/wasm.js";

const ENC = new TextEncoder();
const b = (s: string) => ENC.encode(s);

const FIXED_CASES: { haystack: string; needle: string; sub: number; indel: number }[] = [
  { haystack: "ACGTACGT", needle: "ACGT", sub: 0, indel: 0 },
  { haystack: "NNNACGTNNN", needle: "ACGT", sub: 0, indel: 0 },
  { haystack: "AGCT", needle: "ACGT", sub: 1, indel: 0 },
  { haystack: "AGCT", needle: "ACGT", sub: 2, indel: 0 },
  { haystack: "NNNACGGTNNN", needle: "ACGT", sub: 0, indel: 1 },
  { haystack: "NNNACTNNN", needle: "ACGT", sub: 0, indel: 1 },
  { haystack: "GCAACTGGCTAGAATTCCG", needle: "GCAACTGGCTAGAATTCCG", sub: 0, indel: 0 },
  { haystack: "TGCAGTACGCAACTGGCTAGAATTCCGAACGGTT", needle: "GCAACTGGCTAGAATTCCG", sub: 2, indel: 1 },
  // Empty haystack / needle edge cases
  { haystack: "", needle: "ACGT", sub: 1, indel: 1 },
  { haystack: "ACGT", needle: "", sub: 1, indel: 1 },
];

describe("bandedAlign parity (TS ↔ WASM)", () => {
  for (const c of FIXED_CASES) {
    it(`agrees on "${c.needle}" in "${c.haystack.slice(0, 30)}${c.haystack.length > 30 ? "…" : ""}" (sub=${c.sub}, indel=${c.indel})`, () => {
      const ts = bandedAlign(b(c.haystack), b(c.needle), c.sub, c.indel);
      const ws = wasmBandedAlign(b(c.haystack), b(c.needle), c.sub, c.indel);
      expect(ws.found).toBe(ts.found);
      if (ts.found) {
        expect(ws.score).toBe(ts.score);
        // start/end may differ slightly when multiple alignments tie on score
        // (the tiebreak is the same in both impls, so this should hold; this
        // assertion catches regressions if they ever diverge).
        expect(ws.start).toBe(ts.start);
        expect(ws.end).toBe(ts.end);
      }
    });
  }

  it("agrees on 200 randomized cases (seeded fuzz)", () => {
    const rng = makeRng(0xC0FFEE);
    const ALPHABET = "ACGT";
    let mismatches = 0;
    const failures: string[] = [];

    for (let trial = 0; trial < 200; trial++) {
      // Random needle length 8–22 bp (covers typical anchor sizes + edges).
      const needleLen = 8 + Math.floor(rng() * 15);
      const haystackLen = needleLen + Math.floor(rng() * 40); // anchor + 0–40 bp padding
      const needle = randSeq(rng, ALPHABET, needleLen);
      // Embed the needle (with some noise) into a longer random sequence.
      const insertAt = Math.floor(rng() * (haystackLen - needleLen));
      const left = randSeq(rng, ALPHABET, insertAt);
      const right = randSeq(rng, ALPHABET, haystackLen - insertAt - needleLen);
      const noisy = noisify(needle, rng, 0.1); // ~10% error
      const haystack = left + noisy + right;

      // Run with a grid of (sub, indel) budgets.
      for (const [sub, indel] of [[0, 0], [1, 0], [0, 1], [2, 1], [3, 2]]) {
        const ts = bandedAlign(b(haystack), b(needle), sub!, indel!);
        const ws = wasmBandedAlign(b(haystack), b(needle), sub!, indel!);
        if (ts.found !== ws.found) {
          mismatches++;
          if (failures.length < 5) {
            failures.push(`trial ${trial} sub=${sub} indel=${indel}: ts.found=${ts.found} ws.found=${ws.found} | needle=${needle} hay=${haystack}`);
          }
          continue;
        }
        if (ts.found) {
          if (ts.score !== ws.score || ts.start !== ws.start || ts.end !== ws.end) {
            mismatches++;
            if (failures.length < 5) {
              failures.push(`trial ${trial} sub=${sub} indel=${indel}: ts=${JSON.stringify(ts)} ws=${JSON.stringify(ws)}`);
            }
          }
        }
      }
    }

    if (mismatches > 0) {
      throw new Error(`${mismatches} parity mismatches:\n${failures.join("\n")}`);
    }
  });
});

// --- Helpers --------------------------------------------------------------

/** Mulberry32 — small, deterministic, period 2^32. */
function makeRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randSeq(rng: () => number, alphabet: string, n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += alphabet[Math.floor(rng() * alphabet.length)];
  return s;
}

/** Apply per-base error: substitution with prob `rate`, plus 1 random indel
 *  with prob `rate / 2`. Returns the noisy sequence. */
function noisify(seq: string, rng: () => number, rate: number): string {
  const ALPHABET = "ACGT";
  const out: string[] = [];
  for (let i = 0; i < seq.length; i++) {
    const r = rng();
    if (r < rate) {
      // substitution
      let c = ALPHABET[Math.floor(rng() * 4)]!;
      while (c === seq[i]) c = ALPHABET[Math.floor(rng() * 4)]!;
      out.push(c);
    } else if (r < rate + rate / 4) {
      // insertion (add current + extra base)
      out.push(seq[i]!);
      out.push(ALPHABET[Math.floor(rng() * 4)]!);
    } else if (r < rate + rate / 2) {
      // deletion (skip)
    } else {
      out.push(seq[i]!);
    }
  }
  return out.join("");
}
