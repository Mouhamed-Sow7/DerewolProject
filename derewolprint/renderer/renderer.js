/* renderer.js */

import jobStore from "./js/state/jobStore.js";
import renderJobs, {
  getFileCopies,
  setStoreRef,
  setPrinterStatus,
  setJobOrientationDataRef,
} from "./js/ui/renderJobs.js";
import { initBridge } from "./js/bridge/derewolBridge.js";
import { initLang, setLang, t } from "./i18n.js";

const printingGroups = new Set();
setStoreRef((id) => jobStore.getJobs().find((g) => g.id === id));

// ════════════════════════════════════════════════════════════════
// ACTIVATION MODAL FUNCTIONS ═════════════════════════════════════
// ════════════════════════════════════════════════════════════════

function showActivationModal(subscription) {
  const backdrop = document.getElementById("activation-backdrop");
  const modal = document.getElementById("activation-modal");

  console.log("[MODAL] showActivationModal called");

  if (!backdrop || !modal) {
    console.error("[MODAL] ERROR: Elements not found");
    return;
  }

  // Disable transitions for immediate display
  backdrop.style.transition = "none";
  modal.style.transition = "none";

  backdrop.classList.add("show");
  modal.classList.add("show");
  backdrop.onclick = null;
  backdrop.style.pointerEvents = "auto";

  // ✅ FIX : Nom de boutique à chaque ouverture du modal
  const nameEl = document.getElementById("act-printer-name");
  if (nameEl) {
    const displayName =
      window.__printerCfg?.name || window.__printerCfg?.slug || "—";
    nameEl.textContent = displayName;
  }

  // Re-enable transitions after a brief moment
  setTimeout(() => {
    backdrop.style.transition = "";
    modal.style.transition = "";
  }, 50);

  console.log(
    "[MODAL] ✅ Modal shown immediately (transitions disabled temporarily)",
  );
}

function hideActivationModal() {
  const backdrop = document.getElementById("activation-backdrop");
  const modal = document.getElementById("activation-modal");

  if (backdrop) {
    backdrop.classList.remove("show");
    if (modal) modal.classList.remove("show");
    console.log("[MODAL] Modal hidden");
  }
}

function formatActivationCode(input) {
  let full = input.value.replace(/[^0-9A-Z]/gi, "").toUpperCase();
  if (full.length > 4) full = full.substring(0, 4) + "-" + full.substring(4);
  if (full.length > 9) full = full.substring(0, 9) + "-" + full.substring(9);
  if (full.length > 14)
    full = full.substring(0, 14) + "-" + full.substring(14, 18);
  input.value = full;
}

function toggleActivationTab(tabName) {
  const tabs = document.querySelectorAll(".act-tab");
  const panels = document.querySelectorAll(".act-panel");
  tabs.forEach((tab) => tab.classList.remove("active"));
  panels.forEach((panel) => panel.classList.remove("active"));
  const activeTab = document.querySelector(`[data-act-tab="${tabName}"]`);
  const activePanel = document.getElementById(`act-panel-${tabName}`);
  if (activeTab) activeTab.classList.add("active");
  if (activePanel) activePanel.classList.add("active");
}

// ─── Z-INDEX CONSTANTS ───────────────────────────────────
const MODAL_Z_INDEXES = {
  backdrop: "99999",
  activation: "100000",
  acceptance: "100001",
  cgu: "100002",
};

// 🔥 STATE MANAGER: Prevent variable conflicts from double loads
const _modalState = {
  modalAutoCloseTimeout: null,
  isModalClosing: false,
  lastModalShowTime: 0,
  MODAL_RESHOW_DELAY: 10000,
  isActivating: false,
  trialAlreadyUsed: false,
};

let latestSubscriptionStatus = null;
let activationModalHoldTimer = null;
let activationModalPending = null;
const ACTIVATION_MODAL_WAIT_MS = 0;

function isSubscriptionActive(sub) {
  return sub?.valid === true;
}

let activationInitialized = false;
let acceptanceInitialized = false;
let isShowingModal = false;
let isReloading = false;

function showOfflineBanner(show) {
  let banner = document.getElementById("offline-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "offline-banner";
    banner.innerHTML = `
      <span>⚠️ Mode hors-ligne — réception des jobs suspendue</span>
    `;
    banner.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0;
      background: #f59e0b;
      color: #1c1917;
      text-align: center;
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 600;
      z-index: 99999;
      display: none;
      transition: all 0.3s ease;
    `;
    document.body.appendChild(banner);
  }
  banner.style.display = show ? "block" : "none";
}

// ─────────────────────────────────────────────────────────────
// │ IMMEDIATE MODAL DISPLAY WITH CACHE — NO DELAYS             │
// └─────────────────────────────────────────────────────────────┘
function showModalIfNeeded() {
  // Check localStorage cache first for immediate display
  const cachedStatus = localStorage.getItem("derewol_subscription_status");
  if (cachedStatus) {
    try {
      const sub = JSON.parse(cachedStatus);
      if (!isSubscriptionActive(sub)) {
        console.log(
          "[MODAL] Showing modal immediately from cache (inactive subscription)",
        );
        // NE PAS montrer le modal si mode hors ligne
        const isOfflineMode =
          localStorage.getItem("derewol_offline_mode") === "true";
        if (!isOfflineMode) {
          isShowingModal = true;
          window.showActivationModal(sub);
          isShowingModal = false;
        } else {
          console.log("[MODAL] Suppression du modal en mode offline");
        }
        return;
      } else {
        console.log("[MODAL] Skipping modal from cache (active subscription)");
        return;
      }
    } catch (e) {
      console.warn("[MODAL] Invalid cached status, ignoring", e);
    }
  }

  // No cache or cache shows active - wait for real status, but show modal if triggered
  console.log(
    "[MODAL] No valid cache, will show modal when triggered by main process",
  );
}

// ┌─────────────────────────────────────────────────────────────┐
// │ ACTIVATION MODAL BINDING — WITH TABS (TRIAL & SUBSCRIPTION) │
// └─────────────────────────────────────────────────────────────┘
function bindActivationModal() {
  if (activationInitialized) return;
  activationInitialized = true;
  console.log("[MODAL] Binding — persistent with tabs (trial & subscription)");

  const modal = document.getElementById("activation-modal");
  const backdrop = document.getElementById("activation-backdrop");

  if (modal) modal.style.zIndex = MODAL_Z_INDEXES.activation;
  if (backdrop) backdrop.style.zIndex = MODAL_Z_INDEXES.backdrop;

  // Prevent ESC
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && backdrop?.classList.contains("show")) {
      e.preventDefault();
    }
  });

  if (backdrop) {
    backdrop.onclick = null;
    backdrop.style.pointerEvents = "auto";
  }

  // ── Tab switching ──
  const tabs = document.querySelectorAll(".act-tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const tabName = tab.dataset.actTab;
      if (tabName) toggleActivationTab(tabName);
    });
  });

  // ── Trial button ──
  const trialBtn = document.querySelector(".act-btn-activate");
  const trialNotice = document.getElementById("act-trial-notice");

  function showTrialNotice(message, type = "error") {
    if (!trialNotice) return;
    trialNotice.textContent = message;
    trialNotice.classList.remove("error", "success");
    trialNotice.classList.add(type);
    trialNotice.style.display = "block";
  }

  if (trialBtn) {
    trialBtn.addEventListener("click", async () => {
      if (_modalState.isActivating) return;
      _modalState.isActivating = true;
      trialBtn.disabled = true;
      trialBtn.innerHTML =
        '<i class="fa-solid fa-spinner fa-spin"></i> Activation...';
      if (trialNotice) trialNotice.style.display = "none";

      try {
        const res = await window.derewol.activateTrial();
        if (res?.success) {
          trialBtn.innerHTML = '<i class="fa-solid fa-check"></i> Activé!';
          if (trialNotice) {
            ((trialNotice.textContent = "Votre essai est activé."),
              trialNotice.classList.add("success"));
            trialNotice.style.display = "block";
          }
          localStorage.setItem("trialStarted", "true");
          setTimeout(() => {
            hideActivationModal();
            showCguModal();
          }, 1500);
        } else {
          showTrialNotice(res?.error || "Erreur activation essai", "error");
          trialBtn.disabled = false;
          trialBtn.innerHTML =
            '<i class="fa-solid fa-play"></i> Démarrer mon essai';
        }
      } catch (e) {
        showTrialNotice("Erreur: " + e.message, "error");
        trialBtn.disabled = false;
        trialBtn.innerHTML =
          '<i class="fa-solid fa-play"></i> Démarrer mon essai';
      } finally {
        _modalState.isActivating = false;
      }
    });
  }

  // ── Code input ──
  const codeInput = document.getElementById("act-code-input");
  const codeBtn = document.getElementById("act-code-btn");
  const errorEl = document.getElementById("act-code-error");

  if (codeBtn) {
    codeBtn.addEventListener("click", async () => {
      if (!codeInput || _modalState.isActivating) return;

      const code = codeInput.value.trim().toUpperCase();
      const codeFormat = /^DW-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i;
      if (!codeFormat.test(code)) {
        if (errorEl) {
          errorEl.innerHTML =
            '<i class="fa-solid fa-exclamation"></i> Format du code invalide. Exemple : DW-ABCD-1234-EFGH';
          errorEl.style.display = "block";
        }
        return;
      }

      _modalState.isActivating = true;
      codeBtn.disabled = true;
      codeBtn.innerHTML =
        '<i class="fa-solid fa-spinner fa-spin"></i> Vérification...';
      if (errorEl) errorEl.style.display = "none";

      try {
        const res = await window.derewol.subscriptionActivate(code);
        if (res?.success) {
          codeBtn.innerHTML = '<i class="fa-solid fa-check"></i> Activé!';
          localStorage.setItem("trialStarted", "true");
          setTimeout(() => {
            hideActivationModal();
            showCguModal();
          }, 1500);
        } else {
          if (errorEl) {
            errorEl.innerHTML = `<i class="fa-solid fa-exclamation"></i> ${res?.error || "Code invalide"}`;
            errorEl.style.display = "block";
          }
          codeBtn.disabled = false;
          codeBtn.innerHTML = '<i class="fa-solid fa-check"></i> Valider';
        }
      } catch (e) {
        if (errorEl) {
          errorEl.innerHTML =
            '<i class="fa-solid fa-exclamation"></i> Erreur réseau';
          errorEl.style.display = "block";
        }
        codeBtn.disabled = false;
        codeBtn.innerHTML = '<i class="fa-solid fa-check"></i> Valider';
      } finally {
        _modalState.isActivating = false;
      }
    });
  }

  // ── WhatsApp link ──
  const waLink = document.getElementById("act-whatsapp-link");
  if (waLink) {
    const slug = window.__printerCfg?.slug || "—";
    waLink.href = `https://wa.me/221781220391?text=${encodeURIComponent(`Bonjour, je veux activer DerewolPrint.\nBoutique: ${slug}\nMerci.`)}`;
  }

  console.log("[MODAL] ✅ Binding complete — persistent modal");
}

function handleSubscriptionStatus(sub) {
  if (isReloading || _modalState.isActivating) return;

  // Cache the subscription status in localStorage for immediate display
  if (sub) {
    localStorage.setItem("derewol_subscription_status", JSON.stringify(sub));
  }

  const backdrop = document.getElementById("activation-backdrop");
  if (!backdrop) return;

  // Afficher le nom de la boutique (depuis config locale) au lieu de l'ID
  const nameEl = document.getElementById("act-printer-name");
  if (nameEl && window.__printerCfg) {
    // Priorité : name (ex: "medz"), sinon slug, sinon "—"
    const displayName =
      window.__printerCfg.name || window.__printerCfg.slug || "—";
    nameEl.textContent = displayName;
  }

  // ✅ TRIAL OR SUBSCRIPTION ACTIVE → Hide modal
  if (sub && sub.valid === true) {
    console.log("[MODAL] Trial/Subscription is ACTIVE — hiding modal");
    if (backdrop.classList.contains("show")) {
      hideActivationModal();
    }
    // Lock trial tab if it's a paid subscription
    if (!sub.isTrial) {
      const trialTab = document.querySelector('[data-act-tab="trial"]');
      if (trialTab) {
        trialTab.style.opacity = "0.5";
        trialTab.style.pointerEvents = "none";
        trialTab.style.cursor = "not-allowed";
      }
    }
    return;
  }

  // ❌ EXPIRED OR INACTIVE → Show modal
  const isExpired = sub && sub.expired === true;
  const isInvalid = sub && sub.valid === false;
  const hasTrialPlan = sub && sub.plan === "trial"; // ← Clé : un essai a-t-il existé ?
  const hasHistory = sub && sub.status !== undefined; // ← Une souscription existe en DB

  if (isExpired || isInvalid) {
    console.log(
      "[MODAL] Trial/Subscription EXPIRED or INACTIVE — showing modal",
      { isExpired, isInvalid, hasTrialPlan, hasHistory },
    );

    // NE PAS montrer le modal si mode hors ligne
    const isOfflineMode =
      localStorage.getItem("derewol_offline_mode") === "true";
    if (!isOfflineMode) {
      showActivationModal(sub);
      if (!activationInitialized) bindActivationModal();
    } else {
      console.log("[MODAL] Suppression du modal en mode offline");
    }

    // CAS B : Client existant (config locale présente) avec essai épuisé ou abonnement expiré
    // → Cacher tab Trial, afficher directement Abonnement, adapter titres
    if (hasHistory && (isExpired || isInvalid)) {
      console.log(
        "[MODAL] Cas B (Client en renouvellement) — adaptation du modal",
      );

      // Cacher le tab Essai gratuit et Abonnement actif par défaut
      const trialTab = document.querySelector('[data-act-tab="trial"]');
      const subscriptionTab = document.querySelector(
        '[data-act-tab="subscription"]',
      );
      const trialPanel = document.getElementById("act-panel-trial");
      const subscriptionPanel = document.getElementById(
        "act-panel-subscription",
      );

      if (trialTab) {
        trialTab.style.display = "none"; // Cacher complètement
      }

      // Afficher directement le tab Abonnement
      if (subscriptionTab) {
        subscriptionTab.classList.add("active");
      }
      if (trialPanel) {
        trialPanel.classList.remove("active");
      }
      if (subscriptionPanel) {
        subscriptionPanel.classList.add("active");
      }

      // Changer les titres du modal
      const actTitle = document.querySelector(".act-title");
      if (actTitle) {
        actTitle.textContent = "Renouveler votre abonnement";
      }

      const actDescription = document.querySelector(".act-description");
      if (actDescription) {
        actDescription.textContent = "Choisissez un plan pour continuer";
      }

      // Supprimer le lien "← Retour à l'essai gratuit"
      const backToTrialLink = document.getElementById("act-back-to-trial");
      if (backToTrialLink) {
        backToTrialLink.style.display = "none";
      }
    } else if (!hasHistory) {
      // CAS A : Nouveau client (pas d'historique) → Afficher les 2 tabs normalement
      console.log("[MODAL] Cas A (Nouveau client) — affichage normal");

      // Restaurer les titres par défaut
      const actTitle = document.querySelector(".act-title");
      if (actTitle) {
        actTitle.textContent = "Activation";
      }

      const actDescription = document.querySelector(".act-description");
      if (actDescription) {
        actDescription.textContent = "Choisissez comment démarrer";
      }

      // Afficher les 2 tabs
      const trialTab = document.querySelector('[data-act-tab="trial"]');
      if (trialTab) {
        trialTab.style.display = "block";
      }

      // Show the "Back to trial" link
      const backToTrialLink = document.getElementById("act-back-to-trial");
      if (backToTrialLink) {
        backToTrialLink.style.display = "block";
      }

      // Tab Trial actif par défaut
      const trialTab2 = document.querySelector('[data-act-tab="trial"]');
      const subscriptionTab = document.querySelector(
        '[data-act-tab="subscription"]',
      );
      const trialPanel = document.getElementById("act-panel-trial");
      const subscriptionPanel = document.getElementById(
        "act-panel-subscription",
      );

      if (trialTab2) trialTab2.classList.add("active");
      if (subscriptionTab) subscriptionTab.classList.remove("active");
      if (trialPanel) trialPanel.classList.add("active");
      if (subscriptionPanel) subscriptionPanel.classList.remove("active");
    }
  }
}

// ════════════════════════════════════════════════════════════════
// ACCEPTANCE MODAL FUNCTIONS (Trial & Payment) ═════════════════
// ════════════════════════════════════════════════════════════════

function showAcceptanceModal(type = "trial") {
  const backdrop = document.getElementById("acceptance-backdrop");
  const modal = document.getElementById("acceptance-modal");

  console.log("showAcceptanceModal called with type:", type);
  console.log("backdrop element:", backdrop);
  console.log("modal element:", modal);

  if (!backdrop || !modal) {
    console.error("Modal elements not found!");
    return;
  }

  const trialSection = modal.querySelector("#acc-trial");
  const paymentSection = modal.querySelector("#acc-payment");
  const acceptBtn = modal.querySelector("#acc-btn-accept");

  if (type === "trial") {
    trialSection.style.display = "block";
    paymentSection.style.display = "none";
    acceptBtn.dataset.type = "trial";
  } else if (type === "payment") {
    trialSection.style.display = "none";
    paymentSection.style.display = "block";
    acceptBtn.dataset.type = "payment";
  }

  backdrop.classList.add("show");
  console.log("Modal backdrop 'show' class added");
}

function hideAcceptanceModal() {
  const backdrop = document.getElementById("acceptance-backdrop");
  if (backdrop) backdrop.classList.remove("show");
}

let cguTextCache = null;
let cguLoaded = false;

async function loadCguText() {
  if (cguLoaded && cguTextCache) return cguTextCache;
  try {
    cguTextCache = await window.derewol.invoke("cgu:get-text");
    cguLoaded = true;
  } catch (err) {
    console.warn("[CGU] Impossible de charger le texte des CGU :", err.message);
    cguTextCache =
      "Impossible de charger les conditions générales. Veuillez réessayer plus tard.";
    cguLoaded = true;
  }
  return cguTextCache;
}

function clearRegistrationData() {
  try {
    localStorage.removeItem("trialStarted");
    localStorage.removeItem("derewol_subscription_status");
    localStorage.removeItem("skipActivationModalOnce");
  } catch (err) {
    console.warn(
      "[CGU] Erreur lors de la suppression des données locales :",
      err.message,
    );
  }
}

function hideCguModal() {
  const backdrop = document.getElementById("cgu-backdrop");
  if (backdrop) backdrop.classList.remove("show");
}

async function showCguModal() {
  const backdrop = document.getElementById("cgu-backdrop");
  const modal = document.getElementById("cgu-modal");
  const cguText = document.getElementById("cgu-text");

  if (!backdrop || !modal || !cguText) {
    console.error("[CGU] Modal elements not found!");
    return;
  }

  if (!cguLoaded) {
    cguText.textContent = "Chargement des CGU...";
    const text = await loadCguText();
    cguText.textContent = text;
  } else {
    cguText.textContent = cguTextCache || "Aucune CGU disponible.";
  }

  modal.style.zIndex = MODAL_Z_INDEXES.cgu;
  backdrop.style.zIndex = MODAL_Z_INDEXES.backdrop;
  backdrop.classList.add("show");
  backdrop.onclick = null;
  backdrop.style.pointerEvents = "auto";
}

function bindCguModal() {
  const backdrop = document.getElementById("cgu-backdrop");
  const modal = document.getElementById("cgu-modal");
  const acceptBtn = document.getElementById("cgu-btn-accept");
  const refuseBtn = document.getElementById("cgu-btn-refuse");

  if (!backdrop || !modal || !acceptBtn || !refuseBtn) {
    console.error("[CGU] Modal binding failed — missing elements");
    return;
  }

  modal.style.zIndex = MODAL_Z_INDEXES.cgu;
  backdrop.style.zIndex = MODAL_Z_INDEXES.backdrop;

  const cguEscHandler = (e) => {
    if (e.key === "Escape" && backdrop?.classList.contains("show")) {
      e.preventDefault();
      console.log("[CGU] ESC prevented while CGU modal is open");
    }
  };
  document.addEventListener("keydown", cguEscHandler);

  acceptBtn.addEventListener("click", () => {
    hideCguModal();
  });

  refuseBtn.addEventListener("click", async () => {
    const confirmed = window.confirm(
      "Si vous refusez les CGU, l'activation sera annulée et l'application se fermera. Continuer?",
    );
    if (!confirmed) return;

    clearRegistrationData();
    try {
      await window.derewol.invoke("app:clear-data-and-quit");
    } catch (err) {
      console.error("[CGU] Impossible de quitter l'application :", err.message);
    }
  });
}

function bindAcceptanceModal() {
  if (acceptanceInitialized) {
    console.log("[MODAL] bindAcceptanceModal already called — skipping");
    return;
  }
  acceptanceInitialized = true;

  console.log("[MODAL] bindAcceptanceModal called");

  const backdrop = document.getElementById("acceptance-backdrop");
  const modal = document.getElementById("acceptance-modal");

  console.log("[MODAL] Looking for modal elements...");
  console.log("[MODAL] backdrop:", backdrop);
  console.log("[MODAL] modal:", modal);

  if (!backdrop || !modal) {
    console.error("[MODAL] Modal elements not found in bindAcceptanceModal!");
    return;
  }

  // Set z-index for acceptance modal
  modal.style.zIndex = MODAL_Z_INDEXES.acceptance;
  backdrop.style.zIndex = MODAL_Z_INDEXES.backdrop;

  console.log("[MODAL] Modal elements found, binding events...");

  const cancelBtn = modal.querySelector("#acc-btn-cancel");
  const acceptBtn = modal.querySelector("#acc-btn-accept");

  console.log("[MODAL] cancelBtn:", cancelBtn);
  console.log("[MODAL] acceptBtn:", acceptBtn);

  // Prevent ESC key from closing modal
  const acceptanceEscHandler = (e) => {
    if (e.key === "Escape" && backdrop?.classList.contains("show")) {
      e.preventDefault();
      console.log("[MODAL] ESC key prevented on acceptance modal");
    }
  };
  document.addEventListener("keydown", acceptanceEscHandler);

  // Cancel button
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      hideAcceptanceModal();
    });
  }

  const acceptanceNotice = modal.querySelector("#acc-notice");

  function showAcceptanceNotice(message, type = "error") {
    if (!acceptanceNotice) return;
    acceptanceNotice.textContent = message;
    acceptanceNotice.classList.remove("hidden", "error", "success");
    acceptanceNotice.classList.add(type);
    acceptanceNotice.style.display = "block";
  }

  // Accept button
  if (acceptBtn) {
    acceptBtn.addEventListener("click", async () => {
      const type = acceptBtn.dataset.type || "trial";
      acceptBtn.disabled = true;
      acceptBtn.innerHTML =
        '<i class="fa-solid fa-spinner fa-spin"></i> Traitement...';
      if (acceptanceNotice) acceptanceNotice.classList.add("hidden");

      try {
        if (type === "trial") {
          const result = await window.derewol.activateTrial();
          if (result.success) {
            acceptBtn.innerHTML = '<i class="fa-solid fa-check"></i> Confirmé!';
            setTimeout(() => {
              hideAcceptanceModal();
              showCguModal();
            }, 1500);
          } else {
            showAcceptanceNotice(
              result.error || "Impossible d'activer l'essai",
              "error",
            );
            acceptBtn.disabled = false;
            acceptBtn.innerHTML =
              '<i class="fa-solid fa-check"></i> J\'accepte';
          }
        } else if (type === "payment") {
          // Payment acceptance - call API to enable auto-renewal
          const result =
            (await window.derewol.subscriptionEnableAutoRenewal?.()) || {
              success: true,
            };
          if (result.success) {
            acceptBtn.innerHTML = '<i class="fa-solid fa-check"></i> Confirmé!';
            setTimeout(() => {
              hideAcceptanceModal();
              showCguModal();
            }, 1500);
          } else {
            showAcceptanceNotice(
              result.error || "Impossible de confirmer le paiement",
              "error",
            );
            acceptBtn.disabled = false;
            acceptBtn.innerHTML =
              '<i class="fa-solid fa-check"></i> J\'accepte';
          }
        }
      } catch (e) {
        showAcceptanceNotice("Erreur: " + e.message, "error");
        acceptBtn.disabled = false;
        acceptBtn.innerHTML = '<i class="fa-solid fa-check"></i> J\'accepte';
      }
    });
  }

  // Prevent backdrop click from closing modal (but allow closing via button)
  backdrop.onclick = null;
  backdrop.style.pointerEvents = "auto";
  console.log("[MODAL] bindAcceptanceModal complete");
}

// ── Paramètres persistants ────────────────────────────────────
const settings = {
  darkmode: false,
  lang: "fr",
  printer: "",
  sound: true,
  polling: 10000,
};

function loadSettings() {
  try {
    const saved = localStorage.getItem("derewol_settings");
    if (saved) Object.assign(settings, JSON.parse(saved));
  } catch (e) {}
}

function saveSettings() {
  localStorage.setItem("derewol_settings", JSON.stringify(settings));
}

function applyPollingInterval() {
  if (!window.derewol?.setPollingInterval) return;
  const interval = Math.max(1000, Number(settings.polling) || 1000);
  window.derewol.setPollingInterval(interval);
}

function applyDarkMode(enabled) {
  document.body.classList.toggle("dark-mode", enabled);
}

// ── Navigation vues ───────────────────────────────────────────
let currentView = "jobs";

function showView(viewName) {
  document.querySelectorAll(".view").forEach((v) => (v.style.display = "none"));
  document
    .querySelectorAll(".nav-item")
    .forEach((n) => n.classList.remove("active"));

  document.getElementById(`view-${viewName}`).style.display = "flex";
  document.querySelector(`[data-view="${viewName}"]`).classList.add("active");
  currentView = viewName;

  if (window.derewol?.invoke) {
    window.derewol
      .invoke("app:save-active-tab", viewName)
      .catch((err) =>
        console.warn("[APP] save-active-tab failed:", err.message),
      );
  }

  if (viewName === "history") loadHistory();
  if (viewName === "settings") initSettings();
  if (viewName === "qr") initQRView();
}

document.querySelectorAll(".nav-item[data-view]").forEach((item) => {
  item.addEventListener("click", () => showView(item.dataset.view));
});

// ── Historique ────────────────────────────────────────────────
let historyData = [];
let historyFilters = { client: "", date: "", status: "" };
let selectedHistoryIds = new Set();
let historyRenderTimeoutId = null;

function scheduleRenderHistory() {
  if (historyRenderTimeoutId) {
    clearTimeout(historyRenderTimeoutId);
  }
  historyRenderTimeoutId = window.setTimeout(() => {
    historyRenderTimeoutId = null;
    renderHistory();
  }, 120);
}

async function loadHistory() {
  const list = document.getElementById("history-list");
  const countEl = document.getElementById("history-count");
  list.innerHTML = '<div class="loading-state">Chargement...</div>';

  try {
    const result = await window.derewol.getHistory();
    historyData = result || [];
    renderHistory();
  } catch (e) {
    list.innerHTML =
      '<div class="empty-state"><p>Erreur de chargement</p></div>';
  }
}

function renderHistory() {
  const list = document.getElementById("history-list");
  const countEl = document.getElementById("history-count");

  let filtered = historyData.filter((h) => {
    if (
      historyFilters.client &&
      !h.display_id?.toLowerCase().includes(historyFilters.client.toLowerCase())
    )
      return false;
    if (historyFilters.status && h.status !== historyFilters.status)
      return false;
    if (historyFilters.date) {
      const itemDate = new Date(h.printed_at).toISOString().split("T")[0];
      if (itemDate !== historyFilters.date) return false;
    }
    return true;
  });

  countEl.textContent = `${filtered.length} entrée${filtered.length > 1 ? "s" : ""}`;

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"><i class="fa-solid fa-clipboard"></i></div>
        <p>Aucun résultat</p>
        <span>Modifiez les filtres ou attendez des impressions</span>
      </div>`;
    return;
  }

  const statusMap = {
    completed: { label: "Terminé", color: "#166534", bg: "#f0fdf4" },
    rejected: { label: "Rejeté", color: "#e53935", bg: "#fef2f2" },
    expired: { label: "Expiré", color: "#6b7280", bg: "#f3f4f6" },
  };

  list.innerHTML = filtered
    .map((h) => {
      const s = statusMap[h.status] || statusMap.completed;
      const date = new Date(h.printed_at);
      const dateStr = date.toLocaleDateString("fr-FR");
      const timeStr = date.toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
      });
      return `
    <div class="history-item">
      <div class="history-select"><input type="checkbox" data-id="${h.id}" class="history-checkbox" ${selectedHistoryIds.has(String(h.id)) ? "checked" : ""}></div>
      <div class="history-item-left">
        <div class="history-file-name" title="${h.file_name}">${h.file_name}</div>
        <div class="history-meta">
          <i class="fa-solid fa-user"></i> ${h.display_id || h.owner_id}
          ${h.copies > 0 ? ` · ${h.copies} copie${h.copies > 1 ? "s" : ""}` : ""}
          ${h.printer_name ? ` · ${h.printer_name}` : ""}
        </div>
        <div class="history-date">${dateStr} à ${timeStr}</div>
      </div>
      <span class="history-badge" style="background:${s.bg};color:${s.color}">${s.label}</span>
    </div>`;
    })
    .join("");
}

document.getElementById("filter-client").addEventListener("input", (e) => {
  historyFilters.client = e.target.value;
  scheduleRenderHistory();
});
document.getElementById("filter-date").addEventListener("change", (e) => {
  historyFilters.date = e.target.value;
  renderHistory();
});
document.getElementById("filter-status").addEventListener("change", (e) => {
  historyFilters.status = e.target.value;
  renderHistory();
});
const btnFilterClearEl = document.getElementById("btn-filter-clear");
if (btnFilterClearEl) {
  btnFilterClearEl.addEventListener("click", () => {
    historyFilters = { client: "", date: "", status: "" };
    const fc = document.getElementById("filter-client");
    const fd = document.getElementById("filter-date");
    const fs = document.getElementById("filter-status");
    if (fc) fc.value = "";
    if (fd) fd.value = "";
    if (fs) fs.value = "";
    renderHistory();
  });
}

const historyListEl = document.getElementById("history-list");
if (historyListEl) {
  historyListEl.addEventListener("change", (e) => {
    const target = e.target;
    if (!target || !target.classList.contains("history-checkbox")) return;
    const id = String(target.dataset.id);
    if (!id) return;
    if (target.checked) selectedHistoryIds.add(id);
    else selectedHistoryIds.delete(id);
  });
}

// Delete selected history items
const deleteSelectedBtn = document.getElementById(
  "btn-history-delete-selected",
);
if (deleteSelectedBtn) {
  deleteSelectedBtn.addEventListener("click", async () => {
    if (selectedHistoryIds.size === 0) {
      alert("Aucune entrée sélectionnée.");
      return;
    }
    const confirmed = window.confirm(
      "Supprimer les entrées sélectionnées ? Cette action est irréversible.",
    );
    if (!confirmed) return;
    try {
      const ids = Array.from(selectedHistoryIds);
      const res = await window.derewol.invoke("history:delete", ids);
      if (res?.success) {
        selectedHistoryIds.clear();
        await loadHistory();
      } else {
        alert("Suppression échouée: " + (res?.error || "Erreur inconnue"));
      }
    } catch (err) {
      console.error("Erreur suppression historique:", err);
      alert("Erreur suppression: " + err.message);
    }
  });
}

// Delete all history for this printer
const deleteAllBtn = document.getElementById("btn-history-delete-all");
if (deleteAllBtn) {
  deleteAllBtn.addEventListener("click", async () => {
    const confirmed = window.confirm(
      "Supprimer tout l'historique local serveur pour cette boutique ? Cette action est irréversible.",
    );
    if (!confirmed) return;
    try {
      const res = await window.derewol.invoke("history:delete-all");
      if (res?.success) {
        selectedHistoryIds.clear();
        await loadHistory();
      } else {
        alert("Suppression échouée: " + (res?.error || "Erreur inconnue"));
      }
    } catch (err) {
      console.error("Erreur suppression tout historique:", err);
      alert("Erreur suppression: " + err.message);
    }
  });
}

// ── Paramètres ────────────────────────────────────────────────
const ALWAYS_HIDDEN_PRINTERS = [
  "microsoft print to pdf",
  "onenote",
  "anydesk printer",
  "xps document writer",
  "fax",
];

const VIRTUAL_PRINTER_KEYWORDS = [
  "microsoft print to pdf",
  "onenote",
  "anydesk printer",
  "xps document writer",
  "fax",
  "mp-pdf",
  "mp pdf",
];

function shouldAlwaysHide(name) {
  const lower = (name || "").toLowerCase();
  return ALWAYS_HIDDEN_PRINTERS.some((keyword) => lower.includes(keyword));
}

function isVirtualPrinterName(name) {
  const lower = (name || "").toLowerCase();
  return VIRTUAL_PRINTER_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function shouldShowPrinter(name) {
  if (shouldAlwaysHide(name)) return false;
  const isDev = window.derewol?.isDev?.() ?? false;
  if (isDev) return true;
  if (!name) return false;
  return !isVirtualPrinterName(name);
}

function initSettings() {
  document.getElementById("setting-darkmode").checked = settings.darkmode;
  document.getElementById("setting-lang").value = settings.lang;
  document.getElementById("setting-sound").checked = settings.sound;
  document.getElementById("setting-polling").value = settings.polling;

  window.derewol.getPrinters().then((printers) => {
    const sel = document.getElementById("setting-printer");
    const real = printers.filter((p) => {
      const name = typeof p === "string" ? p : p?.name;
      return shouldShowPrinter(name);
    });
    sel.innerHTML =
      '<option value="">Auto-détection</option>' +
      real
        .map((p) => {
          const name = typeof p === "string" ? p : p.name;
          return `<option value="${name}" ${settings.printer === name ? "selected" : ""}>${name}</option>`;
        })
        .join("");
  });
}

document.getElementById("setting-darkmode").addEventListener("change", (e) => {
  settings.darkmode = e.target.checked;
  applyDarkMode(settings.darkmode);
  saveSettings();
});
document.getElementById("setting-lang").addEventListener("change", (e) => {
  settings.lang = e.target.value;
  saveSettings();
  // Apply translations instantly (no reload)
  setLang(e.target.value);
});
document.getElementById("setting-sound").addEventListener("change", (e) => {
  settings.sound = e.target.checked;
  saveSettings();
  window.__derewolSoundEnabled = e.target.checked;
});
document.getElementById("setting-polling").addEventListener("change", (e) => {
  settings.polling = parseInt(e.target.value);
  saveSettings();
  applyPollingInterval();
});
document.getElementById("setting-printer").addEventListener("change", (e) => {
  settings.printer = e.target.value;
  if (e.target.value) {
    const main = document.getElementById("printer-select");
    if (main) main.value = e.target.value;
  }
  saveSettings();
});

// ── Modale ────────────────────────────────────────────────────
let pendingReject = null;

function showModal(title, subtitle) {
  document.querySelector("#modal-overlay .modal h3").textContent = title;
  document.querySelector("#modal-overlay .modal p").textContent =
    subtitle || "";
  document.getElementById("modal-overlay").classList.add("active");
}

function closeModal() {
  pendingReject = null;
  document.getElementById("modal-overlay").classList.remove("active");
}

function updateSelectionBar() {
  const checked = document.querySelectorAll(".job-checkbox:checked");
  const all = document.querySelectorAll(".job-checkbox");
  const bar = document.getElementById("selection-bar");
  const countEl = document.getElementById("selection-count");
  const btnSelectAll = document.getElementById("btn-select-all");

  if (checked.length > 0) {
    bar.style.display = "flex";
    countEl.textContent =
      checked.length + " sélectionné" + (checked.length > 1 ? "s" : "");
    btnSelectAll.textContent =
      checked.length === all.length
        ? "Tout désélectionner"
        : "Tout sélectionner";
  } else {
    bar.style.display = "none";
    btnSelectAll.textContent = "Tout sélectionner";
  }
}
window.updateSelectionBar = updateSelectionBar;

// ── Rejet ─────────────────────────────────────────────────────
function handleRejectGroup(groupId) {
  const group = jobStore.getJobs().find((g) => g.id === groupId);
  if (!group) return;
  pendingReject = { type: "group", groupId };
  showModal(
    "Rejeter tout le groupe ?",
    `${group.items.length} fichier${group.items.length > 1 ? "s" : ""} de ${group.clientId} seront supprimés.`,
  );
}

function handleRejectFile({ jobId, fileId, fileName, groupId }) {
  pendingReject = { type: "file", jobId, fileId, fileName, groupId };
  showModal("Retirer ce fichier ?", `"${fileName}" sera supprimé de la liste.`);
}

async function confirmReject() {
  if (!pendingReject) return;

  if (pendingReject.type === "group") {
    const { groupId } = pendingReject;
    const group = jobStore.getJobs().find((g) => g.id === groupId);
    if (!group) {
      closeModal();
      return;
    }
    animateRemove(groupId);
    const jobIds = [...new Set(group.items.map((i) => i.jobId))];
    for (const jid of jobIds) await window.derewol?.rejectJob?.(jid);
    jobStore.removeJob(groupId);
    updateSelectionBar();
  } else if (pendingReject.type === "file") {
    const { jobId, fileId, fileName, groupId } = pendingReject;
    const row = document.getElementById(`file-row-${jobId}-${fileId}`);
    if (row) {
      row.style.transition = "opacity 0.2s";
      row.style.opacity = "0";
      setTimeout(() => row.remove(), 200);
    }
    await window.derewol?.rejectJob?.(jobId);
    const groups = jobStore.getJobs();
    const group = groups.find((g) => g.id === groupId);
    if (group) {
      group.items = group.items.filter(
        (i) => !(i.jobId === jobId && i.fileId === fileId),
      );
      if (group.items.length === 0) {
        animateRemove(groupId);
        jobStore.removeJob(groupId);
      } else {
        const t = document.querySelector(`#${groupId} .job-time`);
        if (t)
          t.textContent = `${group.time} · ${group.items.length} fichier${group.items.length > 1 ? "s" : ""}`;
        jobStore.setJobs(groups);
      }
    }
  } else if (pendingReject.type === "group-multi") {
    for (const groupId of pendingReject.groupIds) {
      const group = jobStore.getJobs().find((g) => g.id === groupId);
      if (!group) continue;
      animateRemove(groupId);
      const jobIds = [...new Set(group.items.map((i) => i.jobId))];
      for (const jid of jobIds) await window.derewol?.rejectJob?.(jid);
      jobStore.removeJob(groupId);
    }
    updateSelectionBar();
  }

  closeModal();
}

function animateRemove(id) {
  const card = document.getElementById(id);
  if (!card) return;
  card.style.transition = "opacity 0.3s, height 0.3s, margin 0.3s";
  card.style.opacity = "0";
  card.style.height = card.offsetHeight + "px";
  requestAnimationFrame(() => {
    card.style.height = "0";
    card.style.margin = "0";
    card.style.padding = "0";
  });
  setTimeout(() => card.remove(), 300);
}

// ── Impression ────────────────────────────────────────────────
async function confirmJob(groupId, group) {
  if (printingGroups.has(groupId)) return;

  const printerName = document.getElementById("printer-select").value;

  // ⚠️ Guard: Vérifier qu'une imprimante est sélectionnée
  if (!printerName || printerName.trim() === "") {
    showModal(
      "⚠️ Aucune imprimante sélectionnée",
      "Vous devez sélectionner une imprimante avant de pouvoir imprimer. Veuillez choisir une imprimante et réessayer.",
    );
    return;
  }

  printingGroups.add(groupId);

  const card = document.getElementById(groupId);
  const btn = card.querySelector(".btn-print");
  const btnReject = card.querySelector(".btn-reject");

  const jobCopies = group.items.map((item) => ({
    jobId: item.jobId,
    fileGroupId: item.fileGroupId,
    fileName: item.fileName,
    copies: getFileCopies(item.jobId, item.fileId),
  }));

  btn.textContent = `⏳ ${group.items.length} fichier${group.items.length > 1 ? "s" : ""}...`;
  btn.disabled = true;
  btn.style.opacity = "0.7";
  if (btnReject) {
    btnReject.disabled = true;
    btnReject.style.opacity = "0.3";
  }
  card.querySelectorAll(".btn-reject-file").forEach((b) => {
    b.disabled = true;
    b.style.opacity = "0.3";
  });

  const btnCancel = document.createElement("button");
  btnCancel.textContent = "Annuler";
  btnCancel.className = "btn-cancel";
  btnCancel.addEventListener("click", () => {
    printingGroups.delete(groupId);
    btn.innerHTML = '<i class="fa-solid fa-print"></i> Imprimer tout';
    btn.disabled = false;
    btn.style.opacity = "1";
    if (btnReject) {
      btnReject.disabled = false;
      btnReject.style.opacity = "1";
    }
    card.querySelectorAll(".btn-reject-file").forEach((b) => {
      b.disabled = false;
      b.style.opacity = "1";
    });
    btnCancel.remove();
  });
  card.querySelector(".job-actions").appendChild(btnCancel);

  // Synchroniser les options vers main process avant impression
  if (window._filesPrintOptions) {
    await window.derewol.setPrintOptions(window._filesPrintOptions);
  }

  window.derewol?.confirmPrint?.(groupId, printerName, 1, jobCopies);
}

// ── QR Code ───────────────────────────────────────────────────
let qrInitialized = false;
let qrConfig = null;

async function initQRView() {
  // Charge la config une seule fois
  if (!qrConfig) {
    qrConfig = await window.derewol.getPrinterConfig();
  }
  if (!qrConfig) {
    document.getElementById("qr-shop-name").textContent =
      "Configuration manquante";
    document.getElementById("qr-url").textContent = "Redémarrez l'application";
    return;
  }

  // Toujours mettre à jour les textes
  document.getElementById("qr-shop-name").textContent = qrConfig.name;
  document.getElementById("qr-url").textContent = qrConfig.url;

  // Génère le QR (canvas se redessine à chaque visite)
  generateQR(qrConfig.url);

  // Listeners : une seule fois
  if (!qrInitialized) {
    qrInitialized = true;

    document
      .getElementById("btn-download-qr")
      .addEventListener("click", () => downloadQR(qrConfig));

    document.getElementById("btn-copy-url").addEventListener("click", () => {
      navigator.clipboard.writeText(qrConfig.url);
      const btn = document.getElementById("btn-copy-url");
      btn.innerHTML = '<i class="fa-solid fa-check"></i> Copié !';
      setTimeout(
        () =>
          (btn.innerHTML = '<i class="fa-solid fa-link"></i> Copier le lien'),
        2000,
      );
    });

    document
      .getElementById("btn-print-qr")
      .addEventListener("click", () => printQR());
  }
}

async function generateQR(url) {
  const canvas = document.getElementById("qr-canvas");
  if (!canvas) return;

  try {
    const result = await window.derewol.generateQR(url);
    if (!result?.dataURL) return;

    // Stocker le dataURL pour réutilisation dans print/download
    canvas.dataset.qrDataUrl = result.dataURL;

    const img = new Image();
    img.onload = () => {
      canvas.width = 300;
      canvas.height = 300;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, 300, 300);
      ctx.drawImage(img, 0, 0, 300, 300);
    };
    img.src = result.dataURL;
  } catch (e) {
    console.error("[QR] Erreur génération :", e.message);
  }
}

function downloadQR(cfg) {
  const canvas = document.getElementById("qr-canvas");
  const qrDataUrl = canvas?.dataset.qrDataUrl;
  if (!qrDataUrl) {
    console.error("[QR] Pas de QR généré");
    return;
  }

  const W = 600,
    H = 720;
  const off = document.createElement("canvas");
  off.width = W;
  off.height = H;
  const ctx = off.getContext("2d");

  // ── Fond blanc ─────────────────────────────────────────────
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // ── Fond vert haut ─────────────────────────────────────────
  ctx.fillStyle = "#1e4d2b";
  ctx.beginPath();
  ctx.roundRect(0, 0, W, 160, [20, 20, 0, 0]);
  ctx.fill();

  // ── Logo texte ─────────────────────────────────────────────
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 32px Georgia, serif";
  ctx.textAlign = "center";
  ctx.fillText("Derewol", W / 2 - 28, 80);

  ctx.fillStyle = "#f5c842";
  ctx.font = "bold 32px Georgia, serif";
  ctx.fillText("Print", W / 2 + 50, 80);

  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = "16px Arial, sans-serif";
  ctx.fillText("Envoyez vos fichiers en un scan", W / 2, 118);

  // ── Carte blanche QR ───────────────────────────────────────
  const cardX = 60,
    cardY = 180,
    cardW = W - 120,
    cardH = 380;
  ctx.fillStyle = "#f8faf7";
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardW, cardH, 16);
  ctx.fill();

  ctx.strokeStyle = "#d4dbd2";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardW, cardH, 16);
  ctx.stroke();

  // ── QR Code centré dans la carte ───────────────────────────
  const qrSize = 260;
  const qrX = (W - qrSize) / 2;
  const qrY = cardY + 20;

  const qrImg = new Image();
  qrImg.onload = () => {
    ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

    // ── Nom boutique ──────────────────────────────────────────
    ctx.fillStyle = "#111510";
    ctx.font = "bold 22px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText(cfg.name || "Ma Boutique", W / 2, qrY + qrSize + 36);

    // ── URL ───────────────────────────────────────────────────
    ctx.fillStyle = "#7a8c78";
    ctx.font = "13px Arial, sans-serif";
    ctx.fillText(cfg.url || "", W / 2, qrY + qrSize + 60);

    // ── Footer ────────────────────────────────────────────────
    ctx.fillStyle = "#7a8c78";
    ctx.font = "12px Arial, sans-serif";
    ctx.fillText(
      "derewol.com • Plateforme d'impression sécurisée",
      W / 2,
      H - 24,
    );

    // ── Télécharger ───────────────────────────────────────────
    const link = document.createElement("a");
    link.download = `qr-${cfg.slug || "boutique"}.png`;
    link.href = off.toDataURL("image/png", 1.0);
    link.click();
  };
  qrImg.src = qrDataUrl;
}

function printQR() {
  const canvas = document.getElementById("qr-canvas");
  const qrDataUrl = canvas?.dataset.qrDataUrl;
  const cfg = qrConfig || {};

  if (!qrDataUrl) {
    console.error("[QR] Pas de QR généré pour impression");
    return;
  }

  const win = window.open(
    "",
    "_blank",
    "popup,width=620,height=820,menubar=no,toolbar=no,location=no,status=no,scrollbars=no,resizable=no",
  );
  if (!win) return;

  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>QR Code — ${cfg.name || "DerewolPrint"}</title>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=DM+Sans:wght@400;500&display=swap" rel="stylesheet"/>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      font-family: 'DM Sans', sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .card {
      width: 380px;
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 8px 40px rgba(0,0,0,0.12);
      border: 1px solid #d4dbd2;
    }
    .card-header {
      background: #1e4d2b;
      padding: 24px 32px;
      text-align: center;
    }
    .card-logo {
      font-family: 'Playfair Display', serif;
      font-size: 24px;
      color: #fff;
    }
    .card-logo span { color: #f5c842; }
    .card-tagline {
      font-size: 12px;
      color: rgba(255,255,255,0.7);
      margin-top: 4px;
    }
    .card-body {
      background: #f8faf7;
      padding: 24px;
      text-align: center;
    }
    .qr-wrap {
      background: #fff;
      border-radius: 12px;
      padding: 16px;
      display: inline-block;
      border: 1px solid #d4dbd2;
      margin-bottom: 16px;
    }
    .qr-wrap img {
      width: 220px;
      height: 220px;
      display: block;
    }
    .shop-name {
      font-family: 'Playfair Display', serif;
      font-size: 20px;
      color: #111510;
      margin-bottom: 4px;
    }
    .shop-url {
      font-size: 11px;
      color: #7a8c78;
      font-family: monospace;
      margin-bottom: 16px;
    }
    .card-footer {
      background: #fff;
      padding: 12px;
      text-align: center;
      border-top: 1px solid #d4dbd2;
      font-size: 11px;
      color: #7a8c78;
    }
    @media print {
      body { margin: 0; }
      .card { box-shadow: none; }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="card-header">
      <div class="card-logo">Derewol<span>Print</span></div>
      <div class="card-tagline">Envoyez vos fichiers en un scan</div>
    </div>
    <div class="card-body">
      <div class="qr-wrap">
        <img src="${qrDataUrl}" alt="QR Code"/>
      </div>
      <div class="shop-name">${cfg.name || "Ma Boutique"}</div>
      <div class="shop-url">${cfg.url || ""}</div>
    </div>
    <div class="card-footer">derewol.com • Plateforme d'impression sécurisée</div>
  </div>
</body>
</html>`);

  win.document.close();
  setTimeout(() => {
    win.focus();
    win.print();
    setTimeout(() => win.close(), 1000);
  }, 600);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Init ──────────────────────────────────────────────────────
loadSettings();
applyDarkMode(settings.darkmode);
window.__derewolSoundEnabled = settings.sound;
applyPollingInterval();

initBridge();

// ═══════════════════════════════════════════════════════════════
// REALTIME JOB NOTIFICATIONS ════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
function showJobNotification(message) {
  const msg = message || "🖨️ Nouveau job reçu !";
  if (typeof showUploadToast === "function") {
    showUploadToast(msg, "success");
  }
  if (typeof playNotification === "function") {
    playNotification();
  }
}

// ═══════════════════════════════════════════════════════════════
// EXPOSE MODAL FUNCTIONS GLOBALLY ═══════════════════════════════
// ═══════════════════════════════════════════════════════════════

window.showActivationModal = showActivationModal;
window.hideActivationModal = hideActivationModal;
window.toggleActivationTab = toggleActivationTab;
window.formatActivationCode = formatActivationCode;

window.showAcceptanceModal = showAcceptanceModal;
window.hideAcceptanceModal = hideAcceptanceModal;

// Log for debugging
console.log("[DEREWOL] Modal functions exposed globally:", {
  showActivationModal: typeof window.showActivationModal,
  hideActivationModal: typeof window.hideActivationModal,
  toggleActivationTab: typeof window.toggleActivationTab,
  formatActivationCode: typeof window.formatActivationCode,
});

// ═══════════════════════════════════════════════════════════════
// INITIALIZE MODALS ═════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════

document.addEventListener("DOMContentLoaded", () => {
  console.log("[DEREWOL] DOM READY — Initializing i18n & modals");

  // Check cache and show modal immediately if needed (no delays)
  showModalIfNeeded();

  // Initialize language system
  initLang();

  // Initialize acceptance modal for trial & payment conditions
  bindAcceptanceModal();

  // Initialize CGU modal
  bindCguModal();

  // Initialize activation modal
  bindActivationModal();

  // EN DERNIER — restaurer le tab actif sauvegardé après toutes les initialisations
  (async () => {
    try {
      if (window.derewol?.invoke) {
        const savedTab = await window.derewol.invoke("app:get-active-tab");
        if (savedTab && savedTab !== "jobs") {
          setTimeout(() => showView(savedTab), 100);
        }
      }
    } catch (err) {
      console.warn("[APP] Failed to restore active tab:", err.message);
    }
  })();

  // Auto-show activation modal for testing (will be removed in production)
  setTimeout(() => {
    console.log("[DEREWOL] Testing modal visibility (delayed 1 second)");
    // Uncomment to test auto-show:
    // window.showActivationModal({ status: "inactive" });
  }, 1000);

  // Listen for activation modal trigger from main process
  if (window.derewol?.onShowActivationModal) {
    window.derewol.onShowActivationModal((data) => {
      // 🔥 PREVENT MODAL REOPEN LOOP: Skip if already activating or reloading
      if (_modalState.isActivating || isReloading) {
        console.warn(
          "[DEREWOL] Modal reopen blocked (_modalState.isActivating=" +
            _modalState.isActivating +
            ", isReloading=" +
            isReloading +
            ")",
        );
        return;
      }

      // SECURITY: Skip modal if language reload triggered it
      const skipModal = localStorage.getItem("skipActivationModalOnce");
      if (skipModal === "true") {
        localStorage.removeItem("skipActivationModalOnce");
        console.log("[DEREWOL] Skipped modal (language change reload)");
        return;
      }

      if (isSubscriptionActive(latestSubscriptionStatus)) {
        console.log(
          "[DEREWOL] Suppressing activation modal because subscription is already active",
          latestSubscriptionStatus,
        );
        return;
      }

      console.log("[DEREWOL] Received show:activation-modal event", data);

      // Wait briefly for the subscription status event to arrive before showing,
      // to avoid a flash when an active trial is verified quickly.
      if (latestSubscriptionStatus === null) {
        activationModalPending = data;
        if (activationModalHoldTimer) clearTimeout(activationModalHoldTimer);
        activationModalHoldTimer = setTimeout(() => {
          activationModalHoldTimer = null;
          activationModalPending = null;
          if (isSubscriptionActive(latestSubscriptionStatus)) {
            console.log(
              "[DEREWOL] Activation modal cancelled after status arrived active",
              latestSubscriptionStatus,
            );
            return;
          }
          isShowingModal = true;
          window.showActivationModal(data);
          isShowingModal = false;
        }, ACTIVATION_MODAL_WAIT_MS);
        return;
      }

      isShowingModal = true;
      window.showActivationModal(data);
      isShowingModal = false;
    });
  }

  // Listen for subscription status updates
  if (window.derewol?.onSubscriptionStatus) {
    window.derewol.onSubscriptionStatus((data) => {
      console.log("[DEREWOL] Received subscription:status event", data);
      latestSubscriptionStatus = data || null;

      if (
        activationModalHoldTimer &&
        isSubscriptionActive(latestSubscriptionStatus)
      ) {
        clearTimeout(activationModalHoldTimer);
        activationModalHoldTimer = null;
        activationModalPending = null;
        console.log(
          "[DEREWOL] Cancelled pending activation modal because subscription is active",
          latestSubscriptionStatus,
        );
      }

      handleSubscriptionStatus(data);
    });
  }

  // Listen for hide activation modal from main process
  if (window.derewol?.onHideActivationModal) {
    window.derewol.onHideActivationModal(() => {
      console.log("[DEREWOL] Received hide:activation-modal event");
      hideActivationModal();
    });
  }

  // Récupérer la config locale et la stocker globalement
  if (window.derewol?.getPrinterConfig) {
    window.derewol
      .getPrinterConfig()
      .then((cfg) => {
        if (cfg && cfg.name) {
          window.__printerCfg = cfg;
          console.log("[DEREWOL] Printer config loaded:", cfg);
        } else {
          // Retry après 1s si config nulle ou sans nom
          console.log("[DEREWOL] Config nulle, retry dans 1s...");
          setTimeout(() => {
            window.derewol
              .getPrinterConfig()
              .then((retryCfg) => {
                window.__printerCfg = retryCfg || {
                  name: null,
                  slug: null,
                  id: null,
                };
                console.log(
                  "[DEREWOL] Printer config loaded after retry:",
                  window.__printerCfg,
                );
              })
              .catch((err) => {
                console.warn(
                  "[DEREWOL] Failed to load printer config after retry:",
                  err,
                );
                window.__printerCfg = { name: null, slug: null, id: null };
              });
          }, 1000);
        }
      })
      .catch((err) => {
        console.warn("[DEREWOL] Failed to load printer config:", err);
      });
  }

  // Listen for app ready signal
  if (window.derewol?.onAppReady) {
    window.derewol.onAppReady((data) => {
      console.log("[DEREWOL] App ready signal received", data);
      // App is ready — if trial or subscription active, main UI visible
      if (data.status === "active" || data.status === "trial") {
        console.log("[DEREWOL] Access granted — app visible");
      }
      // Vérifier le flag offline
      if (data.isOffline === true) {
        console.log(
          "[DEREWOL] Mode hors ligne détecté — modal d'activation masqué",
        );
        localStorage.setItem("derewol_offline_mode", "true");
        showOfflineBanner(true);
        // Masquer le modal d'activation en mode offline
        const backdrop = document.getElementById("activation-backdrop");
        if (backdrop && backdrop.classList.contains("show")) {
          hideActivationModal();
        }
      } else {
        showOfflineBanner(false);
      }
    });
  }

  // Écouter les avertissements offline et revoked
  if (window.derewol?.onOfflineWarning) {
    window.derewol.onOfflineWarning?.((message) => {
      console.warn("[DEREWOL] Offline warning:", message);
      showOfflineBanner(true);
      // En cas d'erreur réseau, l'app démarre quand même
      // Affichage d'un badge ou notification optionnel
    });
  }

  if (window.derewol?.onRevokedWarning) {
    window.derewol.onRevokedWarning?.((message) => {
      console.warn("[DEREWOL] Revoked warning:", message);
      // Afficher message : "Accès suspendu — contactez Derewol"
      // Sans fermer l'app, juste notification
    });
  }

  if (window.derewol?.onAppOnline) {
    window.derewol.onAppOnline(() => {
      console.log("[DEREWOL] Connexion rétablie — masquage banner offline");
      showOfflineBanner(false);
      localStorage.removeItem("derewol_offline_mode");
    });
  }

  // ── Orientation analysis results ───────────────────────────
  if (window.derewol?.onJobOrientationAnalyzed) {
    window.derewol.onJobOrientationAnalyzed((data) => {
      console.log("[JOBS] Orientation analyzed:", data);
      if (data?.jobId) {
        jobOrientationData.set(data.jobId, {
          rotation: data.rotation,
          needsWarning: data.needsWarning,
        });
        window.derewol.requestJobRefresh?.();
      }
    });
  }

  // ── Realtime jobs ────────────────────────────────────────
  if (window.derewol?.onJobsNew) {
    window.derewol.onJobsNew((job) => {
      console.log("[JOBS] Realtime INSERT:", job?.id);
      showJobNotification("🖨️ Nouveau job d'impression reçu !");
      window.derewol.requestJobRefresh?.();
    });
  }

  if (window.derewol?.onJobsNewGroup) {
    window.derewol.onJobsNewGroup((group) => {
      console.log("[JOBS] Realtime nouveau groupe:", group?.id);
      showJobNotification("📂 Nouveau client en attente !");
      window.derewol.requestJobRefresh?.();
    });
  }

  if (window.derewol?.onJobsUpdated) {
    window.derewol.onJobsUpdated((job) => {
      console.log("[JOBS] Realtime UPDATE:", job?.id, "→", job?.status);
      // Refresh silencieux, pas de notification pour les updates
    });
  }

  // ── Relayer ai:credits-updated vers l'iframe derewolAI ──
  if (window.derewol?.onAICreditsUpdated) {
    window.derewol.onAICreditsUpdated(() => {
      const iframeAI = document.getElementById("iframe-derewol-ai");
      if (iframeAI && iframeAI.contentWindow) {
        iframeAI.contentWindow.postMessage({ type: "ai-credits-updated" }, "*");
        console.log("[RENDERER] Relayed ai:credits-updated to iframe");
      }
    });
  }
});

// ── Relay postMessage from iframe to main via preload invoke ──
// Allow channels coming from iframe that match secure prefixes.
// IMPORTANT: This MUST be registered IMMEDIATELY, not inside DOMContentLoaded,
// because the iframe may load before DOM is ready.
const ALLOWED_PREFIXES = [
  "ai:",
  "printer:",
  "derewol:",
  "dialog:",
  "print:",
  "shell:",
  "file:",
];

window.addEventListener("message", async (event) => {
  try {
    console.log("[RELAY] message reçu:", event.data?.type, event.data?.channel);
    if (event.data?.type !== "derewol-invoke") return;
    const { channel, payload, requestId } = event.data;
    if (typeof channel !== "string") return;
    if (!ALLOWED_PREFIXES.some((p) => channel.startsWith(p))) return;

    try {
      const result = await window.derewol.invoke(channel, payload);
      console.log("[RELAY] résultat:", channel, result);
      // Use event.source to send back to the iframe, not document.getElementById
      // because the iframe element may not be in the DOM yet when this runs
      event.source.postMessage(
        { type: "derewol-invoke-reply", requestId, result },
        "*",
      );
    } catch (err) {
      console.log("[RELAY] erreur invoke:", channel, err?.message);
      event.source.postMessage(
        {
          type: "derewol-invoke-reply",
          requestId,
          error: err?.message || String(err),
        },
        "*",
      );
    }
  } catch (e) {
    console.warn("[RENDERER] Error handling iframe message:", e);
  }
});

// If DOM is already loaded, initialize immediately
if (document.readyState !== "loading") {
  console.log("[DEREWOL] DOM already loaded — Initializing modals & i18n");
  initLang();
  bindAcceptanceModal();
  bindActivationModal();
}

// Imprimantes sidebar
window.derewol.getPrinters().then((printers) => {
  const select = document.getElementById("printer-select");
  const dot = document.getElementById("printer-status-dot");
  const real = printers.filter((p) => {
    const name = typeof p === "string" ? p : p?.name;
    return shouldShowPrinter(name);
  });

  if (real.length === 0) {
    select.innerHTML = "<option>Aucune imprimante physique</option>";
    dot.style.background = "#ff6b6b";
    return;
  }
  select.innerHTML = real
    .map((p) => {
      const name = typeof p === "string" ? p : p.name;
      return `<option value="${name}">${name}</option>`;
    })
    .join("");
  const lastPrinter =
    localStorage.getItem("derewol:lastPrinter") || settings.printer;
  const preferred =
    real.find((p) => (typeof p === "string" ? p : p.name) === lastPrinter)
      ?.name ||
    real.find((p) => {
      const name = typeof p === "string" ? p : p.name;
      return name.toLowerCase().includes("hp");
    })?.name ||
    (typeof real[0] === "string" ? real[0] : real[0]?.name);
  if (preferred) {
    select.value = preferred;
    localStorage.setItem("derewol:lastPrinter", preferred);
  }
  dot.style.background = "var(--jaune)";

  // Recheck immédiat du statut quand l'utilisateur change d'imprimante
  select.addEventListener("change", async () => {
    const selected = select.value;
    localStorage.setItem("derewol:lastPrinter", selected);
    console.log("[Renderer] Changement imprimante →", selected);
    setPrinterDotState("checking");
    await new Promise((resolve) => setTimeout(resolve, 200));
    await checkPrinterOnce();
  });

  // Démarrer la surveillance du statut de l'imprimante
  startPrinterStatusPolling();
});

// Statut global de l'imprimante
let currentPrinterStatus = { online: true, reason: "Initialisation..." };

const PRINTER_POLL_MS = 30_000;
let _printerPollTimer = null;

// ── Données d'orientation des jobs ───────────────────────────
const jobOrientationData = new Map();

// Passer la map d'orientation à renderJobs
setJobOrientationDataRef(() => jobOrientationData);

function setPrinterDotState(state, tooltip = "") {
  const dot = document.getElementById("printer-status-dot");
  if (!dot) {
    console.error(
      "[Renderer][PrinterDot] #printer-status-dot INTROUVABLE dans le DOM",
    );
    return;
  }

  // Toujours visible — jamais caché
  dot.style.display = "inline-block";
  dot.style.opacity = "1";
  dot.style.visibility = "visible";
  dot.style.background = "";
  dot.style.backgroundColor = "";
  dot.style.boxShadow = "";

  dot.classList.remove(
    "dot-checking",
    "dot-online",
    "dot-offline",
    "dot-warning",
  );

  switch (state) {
    case "online":
      dot.classList.add("dot-online");
      break;
    case "offline":
      dot.classList.add("dot-offline");
      break;
    case "warning":
      dot.classList.add("dot-warning");
      break;
    case "checking":
    default:
      dot.classList.add("dot-checking");
      break;
  }

  if (tooltip) dot.title = tooltip;

  console.log(
    `[Renderer][PrinterDot] classList après update : ${dot.className} | title: ${dot.title}`,
  );
}

async function checkPrinterOnce() {
  const printerDropdown = document.getElementById("printer-select");
  const selectedPrinter = printerDropdown?.value || null;
  console.log(
    "[Renderer][PrinterDot] checkPrinterOnce() → démarré pour :",
    selectedPrinter,
  );

  try {
    setPrinterDotState("checking", "Vérification de l'imprimante…");

    const result = await window.derewol.checkPrinterStatus(selectedPrinter);
    console.log("[Renderer][PrinterDot] résultat reçu :", result);

    if (!result || typeof result.online !== "boolean") {
      console.error("[Renderer][PrinterDot] résultat invalide → rouge forcé");
      setPrinterDotState("offline", "Réponse invalide");
      updatePrintButtons(false);
      return;
    }

    const state = result.dotState || (result.online ? "online" : "offline");
    const tooltip = result.name
      ? `${result.name} — ${
          state === "online"
            ? "En ligne"
            : state === "warning"
              ? "Détectée mais pas prête"
              : "Hors ligne"
        } (status:${result.status})`
      : result.online
        ? "Imprimante en ligne"
        : "Imprimante hors ligne";

    console.log(`[Renderer][PrinterDot] → setPrinterDotState('${state}')`);
    setPrinterDotState(state, tooltip);
    updatePrintButtons(result.online);
  } catch (err) {
    console.error("[Renderer][PrinterDot] erreur :", err.message);
    setPrinterDotState("offline", `Erreur : ${err.message}`);
    updatePrintButtons(false);
  }
}

function startPrinterStatusPolling() {
  console.log("[Renderer][PrinterDot] startPrinterStatusPolling() initialisé");
  if (_printerPollTimer) {
    clearInterval(_printerPollTimer);
    _printerPollTimer = null;
  }

  checkPrinterOnce();

  _printerPollTimer = setInterval(() => {
    console.log("[Renderer][PrinterDot] tick polling 30s");
    checkPrinterOnce();
  }, PRINTER_POLL_MS);
}

function stopPrinterStatusPolling() {
  if (_printerPollTimer) {
    clearInterval(_printerPollTimer);
    _printerPollTimer = null;
    console.log("[Renderer][PrinterDot] polling arrêté");
  }
}

function updatePrintButtons(online) {
  const buttons = document.querySelectorAll(".btn-print[data-id]");
  buttons.forEach((btn) => {
    if (!online) {
      btn.disabled = true;
      btn.title = "Imprimante hors ligne";
      btn.style.opacity = "0.5";
      btn.style.cursor = "not-allowed";
    } else {
      btn.disabled = false;
      btn.title = "";
      btn.style.opacity = "";
      btn.style.cursor = "";
    }
  });
}

// Store → UI
jobStore.subscribe((groups) => {
  const filtered = groups.filter((g) => !printingGroups.has(g.id));
  renderJobs(filtered, {
    onPrint: confirmJob,
    onReject: handleRejectGroup,
    onRejectFile: handleRejectFile,
  });
});

// Sélection multiple
document.getElementById("btn-select-all").addEventListener("click", () => {
  const cbs = document.querySelectorAll(".job-checkbox");
  const all = [...cbs].every((cb) => cb.checked);
  cbs.forEach((cb) => (cb.checked = !all));
  document.getElementById("btn-select-all").textContent = all
    ? "Tout sélectionner"
    : "Tout désélectionner";
  updateSelectionBar();
});

document.getElementById("btn-reject-selected").addEventListener("click", () => {
  const checked = document.querySelectorAll(".job-checkbox:checked");
  if (!checked.length) return;
  pendingReject = {
    type: "group-multi",
    groupIds: [...checked].map((cb) => cb.dataset.id),
  };
  showModal(
    `Rejeter ${checked.length} groupe${checked.length > 1 ? "s" : ""} ?`,
    "Tous les fichiers associés seront supprimés.",
  );
});

document.getElementById("modal-cancel").addEventListener("click", closeModal);
document
  .getElementById("modal-confirm")
  .addEventListener("click", confirmReject);

// ===== AUTO-UPDATE NOTIFICATIONS =====
if (window.electronAPI?.onUpdateAvailable) {
  window.electronAPI.onUpdateAvailable((data) => {
    showUpdateToast(
      `Mise à jour ${data.version} disponible — téléchargement...`,
    );
  });
}

if (window.electronAPI?.onUpdateDownloaded) {
  window.electronAPI.onUpdateDownloaded((data) => {
    showUpdateToast(
      `✅ Version ${data.version} prête — Redémarrer maintenant ?`,
      true,
    );
  });
}

if (window.electronAPI?.onUpdateProgress) {
  window.electronAPI.onUpdateProgress((data) => {
    console.log(`[UPDATE] ${data.percent}%`);
  });
}

function showUpdateToast(message, withButton = false) {
  const existing = document.getElementById("update-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "update-toast";
  toast.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; z-index: 9999;
    background: #1a3a2a; color: white; border-radius: 12px;
    padding: 16px 20px; max-width: 320px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.3);
    font-family: system-ui, sans-serif; font-size: 14px;
    display: flex; flex-direction: column; gap: 10px;
    animation: slideIn 0.3s ease;
  `;

  toast.innerHTML = `
    <span>${message}</span>
    ${
      withButton
        ? `
      <div style="display:flex; gap:8px;">
        <button onclick="window.electronAPI.installUpdate()" style="
          background:#f5c842; color:#1a3a2a; border:none;
          border-radius:8px; padding:8px 16px; font-weight:700;
          cursor:pointer; flex:1;
        ">Redémarrer</button>
        <button onclick="document.getElementById('update-toast').remove()" style="
          background:transparent; color:#9ca3af; border:1px solid #374151;
          border-radius:8px; padding:8px 12px; cursor:pointer;
        ">Plus tard</button>
      </div>
    `
        : ""
    }
  `;

  document.body.appendChild(toast);

  if (!withButton) {
    setTimeout(() => toast?.remove(), 6000);
  }
}

// ═══════════════════════════════════════════════════════════════
// AUTO-UPDATE — Notification + barre de progression
// ═══════════════════════════════════════════════════════════════

const UPDATE_TEXTS = {
  fr: {
    available: (v) => `Nouvelle version ${v} disponible`,
    downloading: "Téléchargement de la mise à jour…",
    ready: "Mise à jour prête — redémarrage requis",
    installBtn: "Installer et redémarrer",
    downloadBtn: "Télécharger maintenant",
    laterBtn: "Plus tard",
    error: "Erreur de mise à jour",
  },
  en: {
    available: (v) => `New version ${v} available`,
    downloading: "Downloading update…",
    ready: "Update ready — restart required",
    installBtn: "Install and restart",
    downloadBtn: "Download now",
    laterBtn: "Later",
    error: "Update error",
  },
  wo: {
    available: (v) => `Versioŋ bu bees ${v} am na`,
    downloading: "Yebbi ngir update bi…",
    ready: "Update bi parow na — laajum restart",
    installBtn: "Installeel te restart",
    downloadBtn: "Yebbi leegi",
    laterBtn: "Ginnaaw",
    error: "Njuumte ci update bi",
  },
};

function getUpdateLang() {
  const stored = localStorage.getItem("derewol_lang");
  return ["fr", "en", "wo"].includes(stored) ? stored : "fr";
}

function ensureUpdateBanner() {
  let el = document.getElementById("dw-update-banner");
  if (el) return el;

  el = document.createElement("div");
  el.id = "dw-update-banner";
  el.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 999999;
    background: var(--card-bg, #ffffff);
    border: 1.5px solid var(--jaune, #f5a623);
    border-radius: 14px;
    padding: 14px 16px;
    width: 320px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.18);
    font-family: "DM Sans", sans-serif;
    display: none;
  `;
  document.body.appendChild(el);
  return el;
}

function renderUpdateBanner(state, payload = {}) {
  const t = UPDATE_TEXTS[getUpdateLang()];
  const el = ensureUpdateBanner();
  el.style.display = "block";

  if (state === "available") {
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <span style="font-size:18px;">✨</span>
        <strong style="font-size:13px;color: var(--text, #1a2e1f);">${t.available(payload.version)}</strong>
      </div>
      <div style="display:flex;gap:8px;">
        <button id="dw-update-download-btn" style="
          flex:1;background:var(--jaune,#f5a623);color:#1a2e1f;border:none;
          padding:8px 12px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;">
          ${t.downloadBtn}
        </button>
        <button id="dw-update-later-btn" style="
          background:transparent;color:var(--text-muted,#5a6e5f);border:1px solid var(--border,#d4c9a8);
          padding:8px 12px;border-radius:8px;font-size:12px;cursor:pointer;">
          ${t.laterBtn}
        </button>
      </div>`;
    document.getElementById("dw-update-download-btn").onclick = async () => {
      renderUpdateBanner("downloading", { percent: 0 });
      await window.derewol.startUpdateDownload();
    };
    document.getElementById("dw-update-later-btn").onclick = () => {
      el.style.display = "none";
    };
  }

  if (state === "downloading") {
    const pct = payload.percent ?? 0;
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <span style="font-size:18px;">⬇️</span>
        <strong style="font-size:13px;color: var(--text, #1a2e1f);">${t.downloading}</strong>
      </div>
      <div style="background: var(--bg,#f5f0e8); border-radius:8px; height:8px; overflow:hidden; margin-bottom:6px;">
        <div style="background: var(--jaune,#f5a623); height:100%; width:${pct}%; transition: width 0.3s;"></div>
      </div>
      <div style="font-size:11px; color: var(--text-muted,#5a6e5f); text-align:right;">${pct}%</div>`;
  }

  if (state === "ready") {
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <span style="font-size:18px;">✅</span>
        <strong style="font-size:13px;color: var(--vert, #2d6a4f);">${t.ready}</strong>
      </div>
      <button id="dw-update-install-btn" style="
        width:100%;background:var(--vert,#2d6a4f);color:#fff;border:none;
        padding:9px 12px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;">
        ${t.installBtn}
      </button>`;
    document.getElementById("dw-update-install-btn").onclick = () => {
      window.derewol.installUpdateNow();
    };
  }

  if (state === "error") {
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:18px;">⚠️</span>
        <strong style="font-size:13px;color:#b00;">${t.error}</strong>
      </div>`;
    setTimeout(() => {
      el.style.display = "none";
    }, 6000);
  }
}

if (window.derewol?.onUpdateAvailable) {
  window.derewol.onUpdateAvailable((data) =>
    renderUpdateBanner("available", data),
  );
  window.derewol.onUpdateProgress((data) =>
    renderUpdateBanner("downloading", data),
  );
  window.derewol.onUpdateDownloaded((data) =>
    renderUpdateBanner("ready", data),
  );
  window.derewol.onUpdateError((data) => renderUpdateBanner("error", data));
}
