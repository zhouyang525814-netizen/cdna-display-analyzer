#!/usr/bin/env node
// Run wasm-pack only when the prebuilt outputs in pkg/ and pkg-web/ are
// missing. This lets CI environments without a Rust toolchain (Vercel,
// most Windows boxes) consume the checked-in artifacts directly, while
// developers who edit src/lib.rs can either delete the folders to trigger
// a rebuild or call `pnpm run build:wasm` explicitly.

const fs = require("node:fs");
const { execSync } = require("node:child_process");

const haveNode = fs.existsSync("pkg/cdna_core_wasm.js");
const haveBrowser = fs.existsSync("pkg-web/cdna_core_wasm.js");

if (haveNode && haveBrowser) {
  console.log("[core-wasm] prebuilt artifacts present, skipping wasm-pack");
  console.log('[core-wasm] (run "pnpm run build:wasm" to force a rebuild)');
  process.exit(0);
}

console.log("[core-wasm] artifacts missing — invoking wasm-pack via build:wasm");
execSync("pnpm run build:wasm", { stdio: "inherit" });
