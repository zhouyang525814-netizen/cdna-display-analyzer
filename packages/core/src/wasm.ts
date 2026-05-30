// Thin TS facade over @cdna/core-wasm. Two responsibilities:
//   - Build a Scorer prepopulated with each preprocessed round (anchor +
//     barcode bytes). Returned object exposes a single `score(seq)` call
//     that crosses the wasm boundary once per read.
//   - Expose RC + meanPhred byte-bands so the pipeline can choose between
//     pure-TS (reference) and WASM (production) implementations.
//
// The two implementations are kept byte-identical: the same parity test
// passes against both. Switching is opt-in at engine construction time.

import * as wasm from "@cdna/core-wasm";
import type { PreprocessedRound } from "./demultiplex.js";

export interface WasmScoreResult {
  bestScore: number;
  bestRoundIdx: number; // -1 when no anchor matched any round
  fwEndIdx: number;
  runnerUpScore: number; // +Infinity when only one round matched
}

export interface WasmScorerLike {
  score(seq: Uint8Array): WasmScoreResult;
  // Free the underlying wasm allocation. Optional in Node where GC is reliable.
  free?(): void;
}

export function createWasmScorer(rounds: ReadonlyArray<PreprocessedRound>): WasmScorerLike {
  const scorer = new wasm.Scorer();
  for (const r of rounds) {
    scorer.addRound(r.fwAnchor, r.fwBarcode);
  }
  // `resultView` aliases the Scorer's internal `[f64; 4]` in linear memory —
  // no copy per call. If WASM memory grows (rare; malloc pool warms up after
  // a few reads), the view's buffer detaches; byteLength === 0 triggers a
  // refresh.
  let resultView: Float64Array = scorer.resultView();
  return {
    score(seq: Uint8Array): WasmScoreResult {
      scorer.score(seq);
      if (resultView.byteLength === 0) resultView = scorer.resultView();
      return {
        bestScore: resultView[0]!,
        runnerUpScore: resultView[1]!,
        bestRoundIdx: resultView[2]!,
        fwEndIdx: resultView[3]!,
      };
    },
    free() {
      scorer.free();
    },
  };
}

// Pass-through wrappers for the byte primitives. Kept in this module so any
// callsite that touches WASM goes through one place — easier to swap in a
// SharedArrayBuffer-based zero-copy variant later.
export function wasmReverseComplement(input: Uint8Array): Uint8Array {
  return wasm.reverseComplement(input);
}

export function wasmMeanPhred(qual: Uint8Array): number {
  return wasm.meanPhred(qual);
}

// --- Nanopore SSM: dual-anchor scorer ------------------------------------

/** Per-site dual-anchor extraction result, mirroring banded-align.ts shape
 *  but with both anchor positions. -1 fields indicate "not found". */
export interface DualAnchorSiteResult {
  found: boolean;
  fwStart: number;
  fwEnd: number;
  rvStart: number;
  rvEnd: number;
}

export interface DualAnchorScorerLike {
  /** Run the matcher on one read; returns per-site results in registration order. */
  score(seq: Uint8Array): DualAnchorSiteResult[];
  free?(): void;
}

export interface DualAnchorSiteConfig {
  fwAnchor: Uint8Array;
  rvAnchor: Uint8Array;
}

/** Construct a DualAnchorScorer with the given sites and edit budget.
 *  `maxSubs + maxIndels` is the total per-anchor edit budget; `maxIndels`
 *  separately caps the alignment-length band width. */
export function createDualAnchorScorer(
  sites: ReadonlyArray<DualAnchorSiteConfig>,
  maxSubs: number,
  maxIndels: number,
): DualAnchorScorerLike {
  const scorer = new wasm.DualAnchorScorer(maxSubs, maxIndels);
  for (const s of sites) {
    scorer.addSite(s.fwAnchor, s.rvAnchor);
  }
  let view: Float64Array = scorer.resultView();
  return {
    score(seq: Uint8Array): DualAnchorSiteResult[] {
      scorer.score(seq);
      if (view.byteLength === 0) view = scorer.resultView();
      const out: DualAnchorSiteResult[] = [];
      for (let i = 0; i < sites.length; i++) {
        const base = 5 * i;
        out.push({
          found: view[base] === 1.0,
          fwStart: view[base + 1]!,
          fwEnd: view[base + 2]!,
          rvStart: view[base + 3]!,
          rvEnd: view[base + 4]!,
        });
      }
      return out;
    },
    free() {
      scorer.free();
    },
  };
}

/** One-shot WASM bandedAlign. Used by the parity test and by callers that
 *  don't want to build a Scorer for a single lookup. Matches the TS
 *  bandedAlign return shape. */
export function wasmBandedAlign(
  haystack: Uint8Array,
  needle: Uint8Array,
  maxSubs: number,
  maxIndels: number,
): { found: boolean; start: number; end: number; score: number } {
  const r = wasm.bandedAlign(haystack, needle, maxSubs, maxIndels);
  return {
    found: r[0] === 1.0,
    start: r[1]!,
    end: r[2]!,
    score: r[3]!,
  };
}
