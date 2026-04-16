const supabase = require("./supabase");
const { loadConfig, saveConfig } = require("./printerConfig");

const PLANS = {
  trial: { days: 7, amount: 0, label: "7 jours gratuits" },
  "1month": { days: 30, amount: 5000, label: "1 mois — 5 000 FCFA" },
  "3months": { days: 92, amount: 12500, label: "3 mois — 12 500 FCFA (-17%)" },
  "6months": { days: 183, amount: 25500, label: "6 mois — 25 500 FCFA (-28%)" },
};

const GRACE_DAYS = 3;

// ── Créer un trial SEULEMENT pour un NOUVEAU printer (appelé depuis setup:register) ──
// SECURITY: Only create trial if subscription does NOT exist at all
async function ensureTrialOrSubscription(printerId) {
  try {
    // 🔥 Check if subscription already exists (handle no-rows case)
    let { data, error: checkError } = await supabase
      .from("subscriptions")
      .select("id, plan, expires_at, status")
      .eq("printer_id", printerId)
      .limit(1);

    // If data exists, subscription already there
    if (data && data.length > 0) {
      console.log("[SUB] ✅ Subscription already exists:", {
        status: data[0].status,
        plan: data[0].plan,
        expires_at: data[0].expires_at,
      });
      return { success: false, error: "Subscription already exists" };
    }

    // First time only: create trial via direct INSERT (avoids RPC constraint issue)
    console.log(
      "[SUB] 🟡 No subscription found — creating trial for",
      printerId,
    );

    const trialCode = "TRIAL-" + printerId.substring(0, 8).toUpperCase();
    const expiresAt = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { error: insertError } = await supabase.from("subscriptions").insert({
      printer_id: printerId,
      activation_code: trialCode,
      plan: "trial",
      duration_days: 7,
      amount: 0,
      payment_method: "manual",
      status: "active",
      activated_at: new Date().toISOString(),
      expires_at: expiresAt,
    });

    if (insertError) {
      console.error("[SUB] ❌ INSERT error:", insertError);
      return { success: false, error: insertError.message };
    }

    // 🔥 CRITICAL: Wait for DB to commit the transaction
    await new Promise((r) => setTimeout(r, 500));

    console.log("[SUB] ✅ Période d'essai créée — 7 jours gratuits");

    // 🔥 Verify subscription was actually created
    const { data: verify } = await supabase
      .from("subscriptions")
      .select("id, plan, status, expires_at")
      .eq("printer_id", printerId)
      .limit(1);

    if (verify && verify.length > 0) {
      console.log("[SUB] ✅ Verification — Trial saved:", {
        plan: verify[0].plan,
        status: verify[0].status,
        expires_at: verify[0].expires_at,
      });
      return { success: true };
    } else {
      console.error("[SUB] ❌ Verification failed — trial not found");
      return { success: false, error: "Trial created but verification failed" };
    }
  } catch (e) {
    console.error("[SUB] ❌ ensureTrial exception:", e.message);
    return { success: false, error: e.message };
  }
}

// ── checkSubscription: PURE READ-ONLY ──
// ❌ INTERDIT: toute création automatique de trial
// ❌ INTERDIT: appel à ensureTrialOrSubscription
// Si le user/subscription est supprimé dans Supabase → accès bloqué
async function checkSubscription(printerId) {
  try {
    const { data, error } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("printer_id", printerId)
      .order("created_at", { ascending: false }) // Get most recent
      .limit(1)
      .single();

    if (error) {
      console.log("[SUB] ❌ No subscription found for", printerId);
      const currentCfg = loadConfig() || {};
      if (currentCfg.subscription) {
        console.log("[SUB] Clearing local cache");
        delete currentCfg.subscription;
        saveConfig(currentCfg);
      }
      return { valid: false, expired: true, daysLeft: 0 };
    }

    if (!data) {
      console.log("[SUB] ❌ Subscription data is null");
      return { valid: false, expired: true, daysLeft: 0 };
    }

    console.log("[SUB] Found subscription:", {
      plan: data.plan,
      status: data.status,
      expires_at: data.expires_at,
      createdAt: data.created_at,
    });

    // Check if subscription is expired
    const now = new Date();
    const expiresAt = data.expires_at;
    const end = new Date(expiresAt);
    const diff = Math.ceil((end - now) / (1000 * 60 * 60 * 24));

    console.log("[SUB] Date check:", {
      now: now.toISOString(),
      expiresAt: expiresAt,
      daysLeft: diff,
      isExpired: diff <= 0,
    });

    if (diff <= 0) {
      console.log("[SUB] ❌ Subscription expired");
      return { valid: false, expired: true, daysLeft: 0 };
    }

    console.log("[SUB] ✅ Subscription VALID", {
      plan: data.plan,
      daysLeft: diff,
    });

    return {
      valid: true,
      expired: false,
      daysLeft: diff,
      expiresAt: expiresAt,
      plan: data.plan,
      status: data.status,
      isTrial: data.plan === "trial",
    };
  } catch (e) {
    console.error("[SUB] checkSubscription error:", e.message);
    return { valid: false, expired: true, daysLeft: 0 };
  }
}

async function activateCode(printerId, code) {
  const normalized = (code || "").toUpperCase().trim();

  const { data, error } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("activation_code", normalized)
    .eq("status", "pending")
    .single();

  if (error || !data)
    return { success: false, error: "Code invalide ou déjà utilisé" };

  if (data.printer_id && data.printer_id !== printerId) {
    return { success: false, error: "Ce code n'est pas pour votre boutique" };
  }

  const plan = PLANS[data.plan] || PLANS["1month"];

  // Prolonge depuis expiration actuelle si abonnement actif
  let base = new Date();
  try {
    const { data: current } = await supabase
      .from("subscriptions")
      .select("expires_at")
      .eq("printer_id", printerId)
      .eq("status", "active")
      .order("expires_at", { ascending: false })
      .limit(1)
      .single();

    if (current?.expires_at && new Date(current.expires_at) > new Date()) {
      base = new Date(current.expires_at);
    }
  } catch (_) {}

  const expiresAt = new Date(base.getTime() + plan.days * 86400000);

  const { error: upErr } = await supabase
    .from("subscriptions")
    .update({
      printer_id: printerId,
      status: "active",
      activated_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
    })
    .eq("id", data.id);

  if (upErr) return { success: false, error: "Erreur activation" };

  const currentCfg = loadConfig() || {};
  saveConfig({
    ...currentCfg,
    subscription: {
      expiresAt: expiresAt.toISOString(),
      daysLeft: plan.days,
      plan: data.plan,
    },
  });

  return {
    success: true,
    expiresAt: expiresAt.toISOString(),
    daysLeft: plan.days,
    plan: data.plan,
    message: `Abonnement activé — ${plan.label} — expire le ${expiresAt.toLocaleDateString("fr-FR")}`,
  };
}

module.exports = {
  checkSubscription,
  activateCode,
  ensureTrialOrSubscription,
  PLANS,
};
