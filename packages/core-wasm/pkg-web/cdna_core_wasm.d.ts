/* tslint:disable */
/* eslint-disable */

/**
 * Per-site dual-anchor scorer. Each call to `score(seq)` writes 5 fields
 * per configured site into the internal result buffer:
 *
 *   [base + 0] = found ? 1 : 0   (both anchors located)
 *   [base + 1] = fw_start        (-1 if not found)
 *   [base + 2] = fw_end
 *   [base + 3] = rv_start
 *   [base + 4] = rv_end
 *
 * where `base = 5 * site_index`. The downstream anchor is searched only
 * from `fw_end` onward, so it is guaranteed to sit after the upstream anchor.
 */
export class DualAnchorScorer {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Register one site. Order matters — site index is the row index in the
     * per-call result buffer. Returns the new site index.
     */
    addSite(fw_anchor: Uint8Array, rv_anchor: Uint8Array): number;
    constructor(max_subs: number, max_indels: number);
    /**
     * Returns a Float64Array view onto the internal result buffer. Length is
     * `5 * site_count`. See struct doc for layout.
     */
    resultView(): Float64Array;
    /**
     * Score one read against every configured site. Writes results in-place
     * into the buffer aliased by `resultView()`.
     */
    score(seq: Uint8Array): void;
}

export class Scorer {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Register one round. Call in the same order the TS side iterates rounds;
     * that order is the stable-sort tiebreaker on equal scores.
     */
    addRound(fw_anchor: Uint8Array, fw_barcode: Uint8Array): void;
    constructor();
    /**
     * Returns a length-4 Float64Array view aliasing the Scorer's internal
     * result buffer. JS calls this once after construction and re-reads
     * elements after every `score()` call — no per-call allocation or copy.
     *
     * Safety: the view becomes detached if WASM linear memory grows. Since
     * `score()` doesn't allocate on the steady state (no Vec creation, the
     * read buffer is malloc/freed via wasm-bindgen's pool which doesn't
     * grow once warm), the view stays valid. JS still checks and rebuilds
     * the view if `byteLength === 0`.
     */
    resultView(): Float64Array;
    /**
     * Score one read against every round's (fw_anchor, fw_barcode). Mirrors
     * the Python and TS scoring exactly:
     *   - N in the read at a barcode position → +0.5 penalty
     *   - non-matching base (and not N)        → +1.0 penalty
     *   - missing barcode bases (read starts mid-barcode) → +1.0 per missing
     *
     * Ties go to the earliest-added round (stable, matching the TS path).
     * Writes results into `self.result` (read via `result_view()` on JS).
     */
    score(seq: Uint8Array): void;
}

/**
 * Exported flat-API wrapper for the TS test suite to verify Rust↔TS parity.
 * Returns a 4-element Float64Array: [found ? 1 : 0, start, end, score].
 * found==0 sets start/end/score to -1.
 */
export function bandedAlign(haystack: Uint8Array, needle: Uint8Array, max_subs: number, max_indels: number): Float64Array;

export function meanPhred(qual: Uint8Array): number;

export function reverseComplement(input: Uint8Array): Uint8Array;
