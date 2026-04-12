const supabase = require("./supabase");
const { loadConfig, saveConfig } = require("./printerConfig");

const PLANS = {
  trial: { days: 15, amount: 0, label: "15 jours gratuits" },
  "1month": { days: 30, amount: 4000, label: "1 mois — 4 000 FCFA" },
  "2months": { days: 61, amount: 6500, label: "2 mois — 6 500 FCFA (-19%)" },
  "3months": { days: 92, amount: 9000, label: "3 mois — 9 000 FCFA (-25%)" },
};

const GRACE_DAYS = 3;

// ── Créer un trial SEULEMENT pour un NOUVEAU printer (appelé depuis setup:register) ──
async function ensureTrialOrSubscription(printerId) {
  try {
    const { data } = await supabase
      .from("subscriptions")
      .select("id")
      .eq("printer_id", printerId)
      .limit(1)
      .single();

    if (!data) {
      await supabase.rpc("create_trial_subscription", {
        p_printer_id: printerId,
      });
      console.log("[SUB] Période d'essai créée — 15 jours gratuits");
    }
  } catch (e) {
    console.warn("[SUB] ensureTrial:", e.message);
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
      .single();

    if (error || !data) {
      // ❌ IMPORTANT : aucune création ici
      // Effacer le cache local
      const currentCfg = loadConfig() || {};
      if (currentCfg.subscription) {
        console.log(
          "[SUB] Subscription supprimée dans Supabase — effacement cache local",
        );
        delete currentCfg.subscription;
        saveConfig(currentCfg);
      }
      return { valid: false, expired: true, daysLeft: 0 };
    }

    const now = new Date();
    const end = new Date(data.ends_at || data.expires_at);
    const diff = Math.ceil((end - now) / (1000 * 60 * 60 * 24));

    if (diff <= 0) {
      return { valid: false, expired: true, daysLeft: 0 };
    }

    return {
      valid: true,
      expired: false,
      daysLeft: diff,
      expiresAt: data.ends_at || data.expires_at,
      plan: data.plan,
      isTrial: data.plan === "trial",
    };
  } catch (e) {
    console.error("[SUB] Subscription check failed", e);
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
