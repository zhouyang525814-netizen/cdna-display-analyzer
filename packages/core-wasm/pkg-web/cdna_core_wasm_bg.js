export class Scorer {
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

/**
 * @param {Uint8Array} qual
 * @returns {number}
 */
export function meanPhred(qual) {
    const ptr0 = passArray8ToWasm0(qual, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.meanPhred(ptr0, len0);
    return ret;
}

/**
 * @param {Uint8Array} input
 * @returns {Uint8Array}
 */
export function reverseComplement(input) {
    const ptr0 = passArray8ToWasm0(input, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.reverseComplement(ptr0, len0);
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}
export function __wbg___wbindgen_throw_1506f2235d1bdba0(arg0, arg1) {
    throw new Error(getStringFromWasm0(arg0, arg1));
}
export function __wbindgen_cast_0000000000000001(arg0, arg1) {
    // Cast intrinsic for `Ref(Slice(F64)) -> NamedExternref("Float64Array")`.
    const ret = getArrayF64FromWasm0(arg0, arg1);
    return ret;
}
export function __wbindgen_init_externref_table() {
    const table = wasm.__wbindgen_externrefs;
    const offset = table.grow(4);
    table.set(0, undefined);
    table.set(offset + 0, undefined);
    table.set(offset + 1, null);
    table.set(offset + 2, true);
    table.set(offset + 3, false);
}
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
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;


let wasm;
export function __wbg_set_wasm(val) {
    wasm = val;
}
