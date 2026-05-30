// WASM hot-path. Two pipelines share this crate:
//
// cDNA-DISPLAY (Phase 1–2):
//   - `Scorer`: per-round (fw_anchor, fw_barcode) scoring for the cDNA tool.
//   - `reverse_complement`, `mean_phred`: shared helpers.
//
// Nanopore SSM (Phase 6.2b):
//   - `DualAnchorScorer`: per-site (fw_anchor, rv_anchor) banded-tolerant
//     extraction. Locates the inter-anchor ROI in a Nanopore read with
//     up to `max_subs + max_indels` edits per anchor.
//   - `bandedAlign` (free function, exported for tests + the TS engine's
//     direct-call path when WASM is enabled).
//
// All semantics mirror the TS reference (packages/core/src/) so parity tests
// stay byte-identical regardless of which path runs.

use wasm_bindgen::prelude::*;
use js_sys::Float64Array;

// Layout of the result buffer:
//   [0] best_score          (f64; +Inf when no anchor matched any round)
//   [1] runner_up_score     (f64; +Inf when only one round matched)
//   [2] best_round_idx      (f64; -1.0 sentinel when no anchor matched)
//   [3] fw_end_idx          (f64; -1.0 sentinel when no anchor matched)
//
// The buffer lives inside the Scorer struct. `resultView()` hands JS a
// Float64Array that aliases linear memory at this address — no copy on the
// way out. JS reads the four values directly after each `score()` call.
pub const RESULT_LEN: usize = 4;

struct RoundData {
    fw_anchor: Vec<u8>,
    fw_barcode: Vec<u8>,
}

#[wasm_bindgen]
pub struct Scorer {
    rounds: Vec<RoundData>,
    result: [f64; RESULT_LEN],
}

#[wasm_bindgen]
impl Scorer {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self { rounds: Vec::new(), result: [0.0; RESULT_LEN] }
    }

    /// Register one round. Call in the same order the TS side iterates rounds;
    /// that order is the stable-sort tiebreaker on equal scores.
    #[wasm_bindgen(js_name = addRound)]
    pub fn add_round(&mut self, fw_anchor: Vec<u8>, fw_barcode: Vec<u8>) {
        self.rounds.push(RoundData { fw_anchor, fw_barcode });
    }

    /// Returns a length-4 Float64Array view aliasing the Scorer's internal
    /// result buffer. JS calls this once after construction and re-reads
    /// elements after every `score()` call — no per-call allocation or copy.
    ///
    /// Safety: the view becomes detached if WASM linear memory grows. Since
    /// `score()` doesn't allocate on the steady state (no Vec creation, the
    /// read buffer is malloc/freed via wasm-bindgen's pool which doesn't
    /// grow once warm), the view stays valid. JS still checks and rebuilds
    /// the view if `byteLength === 0`.
    #[wasm_bindgen(js_name = resultView)]
    pub fn result_view(&self) -> Float64Array {
        unsafe { Float64Array::view(&self.result) }
    }

    /// Score one read against every round's (fw_anchor, fw_barcode). Mirrors
    /// the Python and TS scoring exactly:
    ///   - N in the read at a barcode position → +0.5 penalty
    ///   - non-matching base (and not N)        → +1.0 penalty
    ///   - missing barcode bases (read starts mid-barcode) → +1.0 per missing
    ///
    /// Ties go to the earliest-added round (stable, matching the TS path).
    /// Writes results into `self.result` (read via `result_view()` on JS).
    pub fn score(&mut self, seq: &[u8]) {
        let mut best_score = f64::INFINITY;
        let mut runner_up_score = f64::INFINITY;
        let mut best_round_idx: i32 = -1;
        let mut fw_end_idx: i32 = -1;

        for (idx, round) in self.rounds.iter().enumerate() {
            let anchor_pos = match find_subslice(seq, &round.fw_anchor) {
                Some(p) => p,
                None => continue,
            };

            let expected_bc = &round.fw_barcode;
            let expected_bc_len = expected_bc.len();
            let bc_start = if anchor_pos >= expected_bc_len {
                anchor_pos - expected_bc_len
            } else {
                0
            };
            let read_bc_len = anchor_pos - bc_start;
            let len_diff = expected_bc_len - read_bc_len;

            let mut score: f64 = len_diff as f64;
            let compare_start = len_diff; // skip the missing prefix of expected
            for j in 0..read_bc_len {
                let e = expected_bc[compare_start + j];
                let v = seq[bc_start + j];
                if v == b'N' {
                    score += 0.5;
                } else if v != e {
                    score += 1.0;
                }
            }

            // Stable top-2 tracking: a strictly-lower score promotes to best
            // and demotes the previous best to runner-up; an equal-to-best
            // score becomes runner-up (preserving first-added wins on ties).
            if score < best_score {
                runner_up_score = best_score;
                best_score = score;
                best_round_idx = idx as i32;
                fw_end_idx = (anchor_pos + round.fw_anchor.len()) as i32;
            } else if score < runner_up_score {
                runner_up_score = score;
            }
        }

        self.result[0] = best_score;
        self.result[1] = runner_up_score;
        self.result[2] = best_round_idx as f64;
        self.result[3] = fw_end_idx as f64;
    }
}

#[wasm_bindgen(js_name = reverseComplement)]
pub fn reverse_complement(input: &[u8]) -> Vec<u8> {
    let n = input.len();
    let mut out = vec![0u8; n];
    for i in 0..n {
        out[i] = match input[n - 1 - i] {
            b'A' => b'T',
            b'T' => b'A',
            b'C' => b'G',
            b'G' => b'C',
            b'N' => b'N',
            x => x, // pass through unknown bases (matches Python str.translate)
        };
    }
    out
}

#[wasm_bindgen(js_name = meanPhred)]
pub fn mean_phred(qual: &[u8]) -> f64 {
    if qual.is_empty() {
        return 0.0;
    }
    let mut sum: i64 = 0;
    for &b in qual {
        sum += (b as i64) - 33;
    }
    (sum as f64) / (qual.len() as f64)
}

// --- Nanopore SSM: banded approximate matcher + DualAnchorScorer ---------
//
// `banded_align` mirrors banded-align.ts. Used twice per site per read to
// locate the upstream + downstream anchors with Nanopore-class error tolerance.

/// One hit result. None when no alignment within tolerance was found.
#[derive(Clone, Copy)]
struct MatchResult {
    start: usize,
    end: usize,
    score: u32,
}

/// Banded approximate string match. Mirrors TS `bandedAlign` semantics:
///   - tolerance = max_subs + max_indels (combined edit budget)
///   - alignment-length band: window in [m - max_indels, m + max_indels]
///   - returns lowest-score hit; tie-break: earlier start wins, then shorter length
fn banded_align(
    haystack: &[u8],
    needle: &[u8],
    max_subs: usize,
    max_indels: usize,
) -> Option<MatchResult> {
    let tolerance = max_subs + max_indels;
    let m = needle.len();
    if m == 0 || haystack.is_empty() {
        return None;
    }
    let min_len = if m > max_indels { m - max_indels } else { 1 };
    let min_len = min_len.max(1);
    let max_len = m + max_indels;
    let h_len = haystack.len();
    if h_len < min_len {
        return None;
    }

    let mut best: Option<MatchResult> = None;
    let max_start = h_len - min_len;
    for start in 0..=max_start {
        let mut len = min_len;
        while len <= max_len {
            let end = start + len;
            if end > h_len {
                break;
            }
            if let Some(dist) = limited_edit_distance(needle, &haystack[start..end], tolerance) {
                let is_better = match &best {
                    None => true,
                    Some(b) => {
                        dist < b.score
                            || (dist == b.score
                                && (start < b.start || (start == b.start && len < (b.end - b.start))))
                    }
                };
                if is_better {
                    best = Some(MatchResult { start, end, score: dist });
                    if dist == 0 {
                        return best;
                    }
                }
            }
            len += 1;
        }
    }
    best
}

/// Wagner-Fischer edit distance with row rolling + early termination when the
/// row minimum exceeds `limit`. Returns None if exceeded.
fn limited_edit_distance(needle: &[u8], hay: &[u8], limit: usize) -> Option<u32> {
    let n = needle.len();
    let m = hay.len();
    if n.abs_diff(m) > limit {
        return None;
    }
    let limit32 = limit as u32;

    let mut prev: Vec<u32> = (0..=m as u32).collect();
    let mut curr: Vec<u32> = vec![0u32; m + 1];

    for i in 1..=n {
        curr[0] = i as u32;
        let mut row_min = curr[0];
        let ni = needle[i - 1];
        for j in 1..=m {
            let cost = if ni == hay[j - 1] { 0 } else { 1 };
            let diag = prev[j - 1].saturating_add(cost);
            let up = prev[j].saturating_add(1);
            let left = curr[j - 1].saturating_add(1);
            let v = diag.min(up).min(left);
            curr[j] = v;
            if v < row_min {
                row_min = v;
            }
        }
        if row_min > limit32 {
            return None;
        }
        std::mem::swap(&mut prev, &mut curr);
    }

    let final_dist = prev[m];
    if final_dist <= limit32 {
        Some(final_dist)
    } else {
        None
    }
}

/// Exported flat-API wrapper for the TS test suite to verify Rust↔TS parity.
/// Returns a 4-element Float64Array: [found ? 1 : 0, start, end, score].
/// found==0 sets start/end/score to -1.
#[wasm_bindgen(js_name = bandedAlign)]
pub fn banded_align_wasm(haystack: &[u8], needle: &[u8], max_subs: usize, max_indels: usize) -> Vec<f64> {
    match banded_align(haystack, needle, max_subs, max_indels) {
        Some(m) => vec![1.0, m.start as f64, m.end as f64, m.score as f64],
        None => vec![0.0, -1.0, -1.0, -1.0],
    }
}

struct SiteData {
    fw_anchor: Vec<u8>,
    rv_anchor: Vec<u8>,
}

/// Per-site dual-anchor scorer. Each call to `score(seq)` writes 5 fields
/// per configured site into the internal result buffer:
///
///   [base + 0] = found ? 1 : 0   (both anchors located)
///   [base + 1] = fw_start        (-1 if not found)
///   [base + 2] = fw_end
///   [base + 3] = rv_start
///   [base + 4] = rv_end
///
/// where `base = 5 * site_index`. The downstream anchor is searched only
/// from `fw_end` onward, so it is guaranteed to sit after the upstream anchor.
#[wasm_bindgen]
pub struct DualAnchorScorer {
    sites: Vec<SiteData>,
    max_subs: usize,
    max_indels: usize,
    result: Vec<f64>,
}

#[wasm_bindgen]
impl DualAnchorScorer {
    #[wasm_bindgen(constructor)]
    pub fn new(max_subs: usize, max_indels: usize) -> Self {
        Self {
            sites: Vec::new(),
            max_subs,
            max_indels,
            result: Vec::new(),
        }
    }

    /// Register one site. Order matters — site index is the row index in the
    /// per-call result buffer. Returns the new site index.
    #[wasm_bindgen(js_name = addSite)]
    pub fn add_site(&mut self, fw_anchor: Vec<u8>, rv_anchor: Vec<u8>) -> usize {
        let idx = self.sites.len();
        self.sites.push(SiteData { fw_anchor, rv_anchor });
        for _ in 0..5 {
            self.result.push(0.0);
        }
        idx
    }

    /// Returns a Float64Array view onto the internal result buffer. Length is
    /// `5 * site_count`. See struct doc for layout.
    #[wasm_bindgen(js_name = resultView)]
    pub fn result_view(&self) -> Float64Array {
        unsafe { Float64Array::view(&self.result) }
    }

    /// Score one read against every configured site. Writes results in-place
    /// into the buffer aliased by `resultView()`.
    pub fn score(&mut self, seq: &[u8]) {
        for (i, site) in self.sites.iter().enumerate() {
            let base = 5 * i;
            let fw = banded_align(seq, &site.fw_anchor, self.max_subs, self.max_indels);
            let pair = if let Some(fwm) = fw {
                if fwm.end >= seq.len() {
                    None
                } else {
                    let tail = &seq[fwm.end..];
                    banded_align(tail, &site.rv_anchor, self.max_subs, self.max_indels)
                        .map(|rvm| (fwm, MatchResult {
                            start: rvm.start + fwm.end,
                            end: rvm.end + fwm.end,
                            score: rvm.score,
                        }))
                }
            } else {
                None
            };

            match pair {
                Some((fwm, rvm)) => {
                    self.result[base] = 1.0;
                    self.result[base + 1] = fwm.start as f64;
                    self.result[base + 2] = fwm.end as f64;
                    self.result[base + 3] = rvm.start as f64;
                    self.result[base + 4] = rvm.end as f64;
                }
                None => {
                    self.result[base] = 0.0;
                    self.result[base + 1] = -1.0;
                    self.result[base + 2] = -1.0;
                    self.result[base + 3] = -1.0;
                    self.result[base + 4] = -1.0;
                }
            }
        }
    }
}

// --- cDNA-DISPLAY: existing substring search (unchanged) -----------------

// Naive multi-byte substring search. Anchors are ~10 bp, reads ~150 bp, so
// the naive O(n*m) cost is ~1500 byte ops per call — well under what a
// fancier algorithm (Boyer-Moore / two-way) would add in setup overhead.
fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    let n_len = needle.len();
    let h_len = haystack.len();
    if n_len == 0 {
        return Some(0);
    }
    if n_len > h_len {
        return None;
    }
    let last = h_len - n_len;
    let first = needle[0];
    'outer: for i in 0..=last {
        if haystack[i] != first {
            continue;
        }
        for j in 1..n_len {
            if haystack[i + j] != needle[j] {
                continue 'outer;
            }
        }
        return Some(i);
    }
    None
}
