/* @ts-self-types="./cdna_core_wasm.d.ts" */

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
class DualAnchorScorer {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        DualAnchorScorerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_dualanchorscorer_free(ptr, 0);
    }
    /**
     * Register one site. Order matters — site index is the row index in the
     * per-call result buffer. Returns the new site index.
     * @param {Uint8Array} fw_anchor
     * @param {Uint8Array} rv_anchor
     * @returns {number}
     */
    addSite(fw_anchor, rv_anchor) {
        const ptr0 = passArray8ToWasm0(fw_anchor, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(rv_anchor, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.dualanchorscorer_addSite(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return ret >>> 0;
    }
    /**
     * @param {number} max_subs
     * @param {number} max_indels
     */
    constructor(max_subs, max_indels) {
        const ret = wasm.dualanchorscorer_new(max_subs, max_indels);
        this.__wbg_ptr = ret;
        DualAnchorScorerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Returns a Float64Array view onto the internal result buffer. Length is
     * `5 * site_count`. See struct doc for layout.
     * @returns {Float64Array}
     */
    resultView() {
        const ret = wasm.dualanchorscorer_resultView(this.__wbg_ptr);
        return ret;
    }
    /**
     * Score one read against every configured site. Writes results in-place
     * into the buffer aliased by `resultView()`.
     * @param {Uint8Array} seq
     */
    score(seq) {
        const ptr0 = passArray8ToWasm0(seq, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.dualanchorscorer_score(this.__wbg_ptr, ptr0, len0);
    }
}
if (Symbol.dispose) DualAnchorScorer.prototype[Symbol.dispose] = DualAnchorScorer.prototype.free;
exports.DualAnchorScorer = DualAnchorScorer;

class Scorer {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ScorerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_scorer_free(ptr, 0);
    }
    /**
     * Register one round. Call in the same order the TS side iterates rounds;
     * that order is the stable-sort tiebreaker on equal scores.
     * @param {Uint8Array} fw_anchor
     * @param {Uint8Array} fw_barcode
     */
    addRound(fw_anchor, fw_barcode) {
        const ptr0 = passArray8ToWasm0(fw_anchor, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(fw_barcode, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        wasm.scorer_addRound(this.__wbg_ptr, ptr0, len0, ptr1, len1);
    }
    constructor() {
        const ret = wasm.scorer_new();
        this.__wbg_ptr = ret;
        ScorerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
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
     * @returns {Float64Array}
     */
    resultView() {
        const ret = wasm.scorer_resultView(this.__wbg_ptr);
        return ret;
    }
    /**
     * Score one read against every round's (fw_anchor, fw_barcode). Mirrors
     * the Python and TS scoring exactly:
     *   - N in the read at a barcode position → +0.5 penalty
     *   - non-matching base (and not N)        → +1.0 penalty
     *   - missing barcode bases (read starts mid-barcode) → +1.0 per missing
     *
     * Ties go to the earliest-added round (stable, matching the TS path).
     * Writes results into `self.result` (read via `result_view()` on JS).
     * @param {Uint8Array} seq
     */
    score(seq) {
        const ptr0 = passArray8ToWasm0(seq, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.scorer_score(this.__wbg_ptr, ptr0, len0);
    }
}
if (Symbol.dispose) Scorer.prototype[Symbol.dispose] = Scorer.prototype.free;
exports.Scorer = Scorer;

/**
 * Exported flat-API wrapper for the TS test suite to verify Rust↔TS parity.
 * Returns a 4-element Float64Array: [found ? 1 : 0, start, end, score].
 * found==0 sets start/end/score to -1.
 * @param {Uint8Array} haystack
 * @param {Uint8Array} needle
 * @param {number} max_subs
 * @param {number} max_indels
 * @returns {Float64Array}
 */
function bandedAlign(haystack, needle, max_subs, max_indels) {
    const ptr0 = passArray8ToWasm0(haystack, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(needle, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.bandedAlign(ptr0, len0, ptr1, len1, max_subs, max_indels);
    var v3 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v3;
}
exports.bandedAlign = bandedAlign;

/**
 * @param {Uint8Array} qual
 * @returns {number}
 */
function meanPhred(qual) {
    const ptr0 = passArray8ToWasm0(qual, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.meanPhred(ptr0, len0);
    return ret;
}
exports.meanPhred = meanPhred;

/**
 * @param {Uint8Array} input
 * @returns {Uint8Array}
 */
function reverseComplement(input) {
    const ptr0 = passArray8ToWasm0(input, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.reverseComplement(ptr0, len0);
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}
exports.reverseComplement = reverseComplement;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_1506f2235d1bdba0: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(F64)) -> NamedExternref("Float64Array")`.
            const ret = getArrayF64FromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./cdna_core_wasm_bg.js": import0,
    };
}

const DualAnchorScorerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_dualanchorscorer_free(ptr, 1));
const ScorerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_scorer_free(ptr, 1));

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
function decodeText(ptr, len) {
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

const wasmPath = `${__dirname}/cdna_core_wasm_bg.wasm`;
const wasmBytes = require('fs').readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);
let wasmInstance = new WebAssembly.Instance(wasmModule, __wbg_get_imports());
let wasm = wasmInstance.exports;
wasm.__wbindgen_start();
