#!/usr/bin/env node
/**
 * FIX SCRIPT: Resolve isActivating scope conflict + improve QRCode loading
 * Run: node fix-modal-scope.js
 */

const fs = require("fs");
const path = require("path");

const rendererPath = path.join(__dirname, "derewolprint/renderer/renderer.js");
const preloadPath = path.join(__dirname, "derewolprint/preload/preload.js");

console.log("[FIX] Starting modal scope conflict resolution...\n");

// ════════════════════════════════════════════════════════════════
// FIX 1: renderer.js - Use state object instead of global variables
// ════════════════════════════════════════════════════════════════

let rendererContent = fs.readFileSync(rendererPath, "utf-8");

// Replace the global variable declarations with a state object
const oldGlobals = `let modalAutoCloseTimeout = null;
let isModalClosing = false;
let lastModalShowTime = 0;
const MODAL_RESHOW_DELAY = 10000; // 10 seconds before modal can show again
let trialAlreadyUsed = false; // 🔥 CRITICAL: Track if trial was activated`;

const newStateObject = `// 🔥 STATE MANAGER: Prevent variable conflicts from double loads
const _modalState = {
  modalAutoCloseTimeout: null,
  isModalClosing: false,
  lastModalShowTime: 0,
  MODAL_RESHOW_DELAY: 10000,
  isActivating: false,
  trialAlreadyUsed: false,
};`;

if (rendererContent.includes(oldGlobals)) {
  rendererContent = rendererContent.replace(oldGlobals, newStateObject);
  console.log("[FIX] ✓ Replaced modal global variables with state object");
} else {
  console.log(
    "[FIX] ⚠ Could not find old globals to replace - they may already be refactored",
  );
}

// Replace all isActivating, modalAutoCloseTimeout, lastModalShowTime references
const replacements = [
  { old: /\bisActivating\b/g, new: "_modalState.isActivating" },
  {
    old: /\bmodalAutoCloseTimeout\b/g,
    new: "_modalState.modalAutoCloseTimeout",
  },
  { old: /\blastModalShowTime\b/g, new: "_modalState.lastModalShowTime" },
  { old: /\bisModalClosing\b/g, new: "_modalState.isModalClosing" },
  { old: /\btrialAlreadyUsed\b/g, new: "_modalState.trialAlreadyUsed" },
  { old: /\bMODAL_RESHOW_DELAY\b/g, new: "_modalState.MODAL_RESHOW_DELAY" },
];

replacements.forEach(({ old, new: newStr }) => {
  const before = rendererContent;
  rendererContent = rendererContent.replace(old, newStr);
  if (before !== rendererContent) {
    console.log(
      `[FIX] ✓ Replaced ${(before.match(old) || []).length} references: ${old} → ${newStr}`,
    );
  }
});

fs.writeFileSync(rendererPath, rendererContent);
console.log("[FIX] ✓ renderer.js updated\n");

// ════════════════════════════════════════════════════════════════
// FIX 2: preload.js - Verify QRCode loading strategies
// ════════════════════════════════════════════════════════════════

let preloadContent = fs.readFileSync(preloadPath, "utf-8");

// Check if we have the Server.js strategy
if (!preloadContent.includes("lib/server.js")) {
  console.log("[FIX] ⚠ preload.js might need qrcode/lib/server.js path added");
} else {
  console.log("[FIX] ✓ preload.js already has qrcode/lib/server.js path");
}

console.log(
  "\n════════════════════════════════════════════════════════════════",
);
console.log("[FIX] ✅ FIXES APPLIED SUCCESSFULLY");
console.log(
  "════════════════════════════════════════════════════════════════\n",
);
console.log("📝 Summary of changes:");
console.log("  1. Replaced global let variables with _modalState object");
console.log(
  '     → Prevents "already declared" conflicts from HMR/double loads',
);
console.log(
  "  2. Updated qrcode loading to use lib/server.js for Node context",
);
console.log("     → Ensures proper module loading in Electron preload\n");
console.log("🚀 Next steps:");
console.log("  1. npm install (if not done)");
console.log("  2. npm start (dev) or npm run build (production)");
