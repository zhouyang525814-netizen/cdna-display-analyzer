/* tslint:disable */
/* eslint-disable */

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

export function meanPhred(qual: Uint8Array): number;

export function reverseComplement(input: Uint8Array): Uint8Array;
