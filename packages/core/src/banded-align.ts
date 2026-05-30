// Banded approximate string matcher — finds the best occurrence of a `needle`
// (anchor sequence, typically 15–20 bp) inside a `haystack` (a search window,
// typically 30–100 bp on each end of a read), tolerating up to `maxSubs`
// substitutions and `maxIndels` insertions/deletions.
//
// Algorithm: for each candidate start position in the haystack, run a
// Wagner-Fischer edit-distance DP with row rolling and early termination when
// the row minimum exceeds the tolerance. The "banded" part is two-fold:
//   - We only consider match window lengths in [m - maxIndels, m + maxIndels]
//     (the actual alignment span can shrink by `maxIndels` due to deletions
//     in the needle and grow by `maxIndels` due to insertions).
//   - Inside Wagner-Fischer, we don't bound the DP itself; instead we early-
//     exit if the row min already exceeds tolerance.
//
// For typical SSM use (anchor 15–20 bp, search window 50 bp, maxSubs=2,
// maxIndels=1) this is ~10k DP cell evaluations per call — fast even in pure
// TS without WASM. The WASM port (Phase 6.2b) mirrors this exactly for the
// hot path.
//
// Correctness invariants tested in banded-align.test.ts:
//   - Exact match returns score 0 at the right position.
//   - Single substitution returns score 1.
//   - Single insertion in needle (i.e. extra base in haystack relative to
//     needle) returns score 1 at length m+1.
//   - Single deletion (missing base) returns score 1 at length m-1.
//   - Edits exceeding tolerance return found=false.
//   - When multiple alignments are within tolerance, the lowest-score one wins;
//     ties break by earlier start position.

export interface BandedAlignResult {
  /** Whether a match within tolerance was found. */
  found: boolean;
  /** Inclusive byte index in haystack where the match starts. -1 if not found. */
  start: number;
  /** Exclusive byte index in haystack where the match ends. -1 if not found. */
  end: number;
  /** Edit-distance score (substitutions + indels). Lower is better. */
  score: number;
}

const NOT_FOUND: BandedAlignResult = Object.freeze({
  found: false,
  start: -1,
  end: -1,
  score: Number.POSITIVE_INFINITY,
}) as BandedAlignResult;

/**
 * Find the best occurrence of `needle` in `haystack` within an error budget.
 *
 * @param haystack The sequence to search in (typically a window from a read).
 * @param needle The anchor sequence to find (typically 15–20 bp).
 * @param maxSubs Maximum substitutions allowed.
 * @param maxIndels Maximum insertions/deletions allowed (each indel = 1 edit).
 * @returns Best match, or NOT_FOUND if none within `maxSubs + maxIndels`.
 */
export function bandedAlign(
  haystack: Uint8Array,
  needle: Uint8Array,
  maxSubs: number,
  maxIndels: number,
): BandedAlignResult {
  const tolerance = maxSubs + maxIndels;
  const m = needle.length;
  if (m === 0) return NOT_FOUND;
  const hLen = haystack.length;
  if (hLen === 0) return NOT_FOUND;

  // Candidate alignment lengths in haystack: from m-maxIndels (all deletions)
  // to m+maxIndels (all insertions). Must stay positive.
  const minLen = Math.max(1, m - maxIndels);
  const maxLen = m + maxIndels;

  let best: BandedAlignResult = NOT_FOUND;

  for (let start = 0; start + minLen <= hLen; start++) {
    // For each start, try every window length within band.
    for (let len = minLen; len <= maxLen; len++) {
      const end = start + len;
      if (end > hLen) break;
      const dist = limitedEditDistance(needle, haystack, start, end, tolerance);
      if (dist === -1) continue; // exceeded tolerance, skip
      if (dist < best.score || (dist === best.score && (!best.found || start < best.start))) {
        best = { found: true, start, end, score: dist };
        if (dist === 0) return best; // can't beat exact match
      }
    }
  }
  return best;
}

/**
 * Wagner-Fischer edit distance with early termination. Returns -1 if the
 * minimum-possible distance exceeds `limit` at any point during the fill,
 * otherwise returns the final distance (which is ≤ limit).
 *
 * @param needle The pattern.
 * @param hay The full haystack buffer.
 * @param hStart Inclusive start index into hay.
 * @param hEnd Exclusive end index into hay.
 * @param limit Maximum edit distance to consider; anything above bails early.
 */
function limitedEditDistance(
  needle: Uint8Array,
  hay: Uint8Array,
  hStart: number,
  hEnd: number,
  limit: number,
): number {
  const n = needle.length;
  const m = hEnd - hStart;
  // Trivial lower bound — even with all edits free, |n - m| basic indels are
  // required, so if that already exceeds the limit, skip.
  if (Math.abs(n - m) > limit) return -1;

  let prev = new Int32Array(m + 1);
  let curr = new Int32Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;

  for (let i = 1; i <= n; i++) {
    curr[0] = i;
    let rowMin = i;
    const ni = needle[i - 1]!;
    for (let j = 1; j <= m; j++) {
      const cost = ni === hay[hStart + j - 1]! ? 0 : 1;
      const v = Math.min(
        prev[j - 1]! + cost, // diag (match/substitute)
        prev[j]! + 1,        // up   (insertion in needle / deletion in haystack)
        curr[j - 1]! + 1,    // left (deletion in needle / insertion in haystack)
      );
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > limit) return -1;
    // Swap rows.
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  const final = prev[m]!;
  return final <= limit ? final : -1;
}

// --- Convenience helpers ---------------------------------------------------

const ENC = new TextEncoder();

/** ASCII-only convenience wrapper around bandedAlign — useful for tests and
 *  for one-shot lookups from non-byte code paths. */
export function bandedAlignAscii(
  haystack: string,
  needle: string,
  maxSubs: number,
  maxIndels: number,
): BandedAlignResult {
  return bandedAlign(ENC.encode(haystack), ENC.encode(needle), maxSubs, maxIndels);
}
