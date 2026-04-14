/**
 * test-trial-ended.js
 *
 * Simulates trial expiration for testing the UI/UX flow
 * NO RESTART REQUIRED — app detects change within 1 second via polling
 *
 * Usage: node test-trial-ended.js [optional: printer-id]
 *
 * Features:
 * ✓ Works with plain Node (no Electron dependency)
 * ✓ Auto-detects printer ID from local config file
 * ✓ Triggers LIVE update (polling detects change instantly)
 * ✓ No app restart needed
 */

const supabase = require("./services/supabase");
const fs = require("fs");
const path = require("path");

// ── Get config file path (works on all platforms, no Electron needed) ──
function getConfigPath() {
  // Windows: C:\Users\[user]\AppData\Roaming\DerewolPrint
  // macOS/Linux: ~/.DerewolPrint
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA || process.env.HOME,
      "DerewolPrint",
      "derewol-config.json",
    );
  }
  return path.join(
    process.env.HOME || os.homedir(),
    ".config/DerewolPrint",
    "derewol-config.json",
  );
}

// ── Read config without Electron dependency ──
function readConfigFile() {
  try {
    const configPath = getConfigPath();
    if (!fs.existsSync(configPath)) {
      console.warn(`[TEST] Config file not found at: ${configPath}`);
      return null;
    }

    const raw = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw);
    console.log(`[TEST] ✓ Config loaded from: ${configPath}`);
    return config;
  } catch (e) {
    console.error("[TEST] Failed to read config:", e.message);
    return null;
  }
}

async function simulateTrialEnded(printerId) {
  try {
    console.log(
      `\n[TEST] 🧪 Simulating trial expiration for printer: ${printerId}\n`,
    );

    // Get current subscription
    const { data: sub, error: fetchErr } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("printer_id", printerId)
      .single();

    if (fetchErr || !sub) {
      console.error("[TEST] ❌ Subscription not found:", fetchErr?.message);
      return false;
    }

    console.log("[TEST] Current subscription status:");
    console.log(`  - Plan: ${sub.plan}`);
    console.log(`  - Expires at: ${sub.expires_at}`);
    console.log(`  - Status: ${sub.status || "N/A"}\n`);

    // Set expiration to 1 minute ago (instead of 1 hour)
    // → App will detect expired status within 1 second via polling
    const expiredAt = new Date(Date.now() - 60000).toISOString();

    const { error: updateErr } = await supabase
      .from("subscriptions")
      .update({ expires_at: expiredAt })
      .eq("id", sub.id);

    if (updateErr) {
      console.error("[TEST] ❌ Update failed:", updateErr.message);
      return false;
    }

    console.log("[TEST] ✅ SUCCESS!");
    console.log(`  - Expiration updated to: ${expiredAt}`);
    console.log(`  - App will detect change in ~1 second`);
    console.log(`  - Activation modal will appear LIVE (no restart)\n`);

    return true;
  } catch (e) {
    console.error("[TEST] ❌ Error:", e.message);
    return false;
  }
}

// ── Get printer ID from command line or auto-detect ──
let printerId = process.argv[2];

if (!printerId) {
  console.log("[TEST] No printer ID provided, auto-detecting from config...\n");
  const config = readConfigFile();

  if (config?.id) {
    printerId = config.id;
    console.log(`[TEST] ✓ Auto-detected printer ID: ${printerId}\n`);
  }
}

if (!printerId) {
  console.error("[TEST] ❌ ERROR: Printer ID not found!\n");
  console.error("Usage: node test-trial-ended.js [printer-id-uuid]");
  console.error(
    "       or: node test-trial-ended.js (auto-detect from config)\n",
  );
  console.error(
    "Example: node test-trial-ended.js 6fe05da3-b1c1-42cf-8b03-5dda515e2ef7\n",
  );
  process.exit(1);
}

// ── Run simulation ──
(async () => {
  const success = await simulateTrialEnded(printerId);
  process.exit(success ? 0 : 1);
})();
