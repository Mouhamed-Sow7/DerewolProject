/**
 * test-trial-ended.js
 * Simulates a trial period expiration for testing the UI/UX flow
 * Usage: node test-trial-ended.js [optional: printer-id]
 * Auto-detects printer ID from config if not provided
 */

const supabase = require("./services/supabase");
const { loadConfig } = require("./services/printerConfig");

async function simulateTrialEnded(printerId) {
  try {
    console.log(`[TEST] Simulating trial ended for printer: ${printerId}`);

    // Get current subscription
    const { data: sub, error: fetchErr } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("printer_id", printerId)
      .single();

    if (fetchErr || !sub) {
      console.error("[TEST] Subscription not found:", fetchErr?.message);
      return;
    }

    console.log("[TEST] Current subscription:", {
      id: sub.id,
      plan: sub.plan,
      expires_at: sub.expires_at,
    });

    // Set expiration to 1 hour ago to trigger trial ended
    const expiredAt = new Date(Date.now() - 3600000).toISOString();

    const { error: updateErr } = await supabase
      .from("subscriptions")
      .update({ expires_at: expiredAt })
      .eq("id", sub.id);

    if (updateErr) {
      console.error("[TEST] Update failed:", updateErr.message);
      return;
    }

    console.log("[TEST] ✅ Trial set to expired at:", expiredAt);
    console.log("[TEST] Now restart DerewolPrint to see the trial ended modal");
  } catch (e) {
    console.error("[TEST] Error:", e.message);
  }
}

// Get printer ID from command line or config
let printerId = process.argv[2];

if (!printerId) {
  // Try to auto-detect from local config
  try {
    const cfg = loadConfig();
    if (cfg?.id) {
      printerId = cfg.id;
      console.log("[TEST] Auto-detected printer ID from config:", printerId);
    }
  } catch (e) {
    // Config not found, user must provide it
  }
}

if (!printerId) {
  console.error("[TEST] ERROR: Printer ID not found!");
  console.error("[TEST] Usage: node test-trial-ended.js [printer-id-uuid]");
  console.error("[TEST] Or: Ensure you have run setup on DerewolPrint first");
  console.error(
    "[TEST] Example: node test-trial-ended.js 6fe05da3-b1c1-42cf-8b03-5dda515e2ef7",
  );
  process.exit(1);
}

simulateTrialEnded(printerId).then(() => process.exit(0));

simulateTrialEnded(printerId);
