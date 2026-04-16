/* renderer.js */

import jobStore from "./js/state/jobStore.js";
import renderJobs, { getFileCopies, setStoreRef } from "./js/ui/renderJobs.js";
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

  backdrop.classList.add("show");
  modal.classList.add("show");
  backdrop.onclick = null;
  backdrop.style.pointerEvents = "auto";

  console.log("[MODAL] ✅ Modal shown (persistent — no auto-close)");
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

let activationInitialized = false;
let acceptanceInitialized = false;
let isShowingModal = false;
let isReloading = false;

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
  if (trialBtn) {
    trialBtn.addEventListener("click", async () => {
      if (_modalState.isActivating) return;
      _modalState.isActivating = true;
      trialBtn.disabled = true;
      trialBtn.innerHTML =
        '<i class="fa-solid fa-spinner fa-spin"></i> Activation...';

      try {
        const res = await window.derewol.activateTrial();
        if (res?.success) {
          trialBtn.innerHTML = '<i class="fa-solid fa-check"></i> Activé!';
          localStorage.setItem("trialStarted", "true");
          setTimeout(() => hideActivationModal(), 1500);
        } else {
          alert(res?.error || "Erreur activation essai");
          trialBtn.disabled = false;
          trialBtn.innerHTML =
            '<i class="fa-solid fa-play"></i> Démarrer mon essai';
        }
      } catch (e) {
        alert("Erreur: " + e.message);
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

      const code = codeInput.value.replace(/[\s\-]/g, "");
      if (code.length < 10) {
        if (errorEl) {
          errorEl.innerHTML =
            '<i class="fa-solid fa-exclamation"></i> Code invalide';
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
          setTimeout(() => hideActivationModal(), 1500);
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

  const backdrop = document.getElementById("activation-backdrop");
  if (!backdrop) return;

  const slugEl = document.getElementById("act-printer-slug");
  if (slugEl) slugEl.textContent = window.__printerCfg?.slug || "—";

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
  const hasTrialPlan = sub && sub.plan === "trial"; // ← Key check: was there a trial?
  const hasHistory = sub && sub.status !== undefined; // ← Subscription row exists in DB

  if (isExpired || isInvalid) {
    console.log(
      "[MODAL] Trial/Subscription EXPIRED or INACTIVE — showing modal",
      { isExpired, isInvalid, hasTrialPlan, hasHistory },
    );
    showActivationModal(sub);
    if (!activationInitialized) bindActivationModal();

    // Lock trial tab ONLY if a trial subscription actually existed and expired
    // (not for fresh printers with no subscription row at all)
    if (isExpired && hasTrialPlan && hasHistory) {
      console.log("[MODAL] Locking trial tab — trial was used and expired");
      const trialTab = document.querySelector('[data-act-tab="trial"]');
      const trialPanel = document.getElementById("act-panel-trial");
      if (trialTab) {
        trialTab.style.opacity = "0.5";
        trialTab.style.pointerEvents = "none";
        trialTab.style.cursor = "not-allowed";
      }
      if (trialPanel) {
        const trialBtn = trialPanel.querySelector(".act-btn-activate");
        if (trialBtn) {
          trialBtn.disabled = true;
          trialBtn.innerHTML = '<i class="fa-solid fa-lock"></i> Essai utilisé';
          trialBtn.style.opacity = "0.6";
        }
      }
    } else if (!hasHistory) {
      // Fresh printer with no subscription → trial tab should be ENABLED
      console.log("[MODAL] Fresh printer — enabling trial tab");
      const trialTab = document.querySelector('[data-act-tab="trial"]');
      const trialPanel = document.getElementById("act-panel-trial");
      if (trialTab) {
        trialTab.style.opacity = "1";
        trialTab.style.pointerEvents = "auto";
        trialTab.style.cursor = "pointer";
      }
      if (trialPanel) {
        const trialBtn = trialPanel.querySelector(".act-btn-activate");
        if (trialBtn) {
          trialBtn.disabled = false;
          trialBtn.innerHTML =
            '<i class="fa-solid fa-play"></i> Démarrer mon essai';
          trialBtn.style.opacity = "1";
        }
      }
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

  // Accept button
  if (acceptBtn) {
    acceptBtn.addEventListener("click", async () => {
      const type = acceptBtn.dataset.type || "trial";
      acceptBtn.disabled = true;
      acceptBtn.innerHTML =
        '<i class="fa-solid fa-spinner fa-spin"></i> Traitement...';

      try {
        if (type === "trial") {
          const result = await window.derewol.activateTrial();
          if (result.success) {
            acceptBtn.innerHTML = '<i class="fa-solid fa-check"></i> Confirmé!';
            setTimeout(() => {
              hideAcceptanceModal();
            }, 1500);
          } else {
            alert(
              "Erreur: " + (result.error || "Impossible d\'activer l\'essai"),
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
            }, 1500);
          } else {
            alert(
              "Erreur: " +
                (result.error || "Impossible de confirmer le paiement"),
            );
            acceptBtn.disabled = false;
            acceptBtn.innerHTML =
              '<i class="fa-solid fa-check"></i> J\'accepte';
          }
        }
      } catch (e) {
        alert("Erreur: " + e.message);
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
  renderHistory();
});
document.getElementById("filter-date").addEventListener("change", (e) => {
  historyFilters.date = e.target.value;
  renderHistory();
});
document.getElementById("filter-status").addEventListener("change", (e) => {
  historyFilters.status = e.target.value;
  renderHistory();
});
document.getElementById("btn-filter-clear").addEventListener("click", () => {
  historyFilters = { client: "", date: "", status: "" };
  document.getElementById("filter-client").value = "";
  document.getElementById("filter-date").value = "";
  document.getElementById("filter-status").value = "";
  renderHistory();
});

// ── Paramètres ────────────────────────────────────────────────
function initSettings() {
  document.getElementById("setting-darkmode").checked = settings.darkmode;
  document.getElementById("setting-lang").value = settings.lang;
  document.getElementById("setting-sound").checked = settings.sound;
  document.getElementById("setting-polling").value = settings.polling;

  window.derewol.getPrinters().then((printers) => {
    const sel = document.getElementById("setting-printer");
    const blacklist = ["onenote", "pdf", "fax", "xps", "microsoft"];
    const real = printers.filter(
      (p) => !blacklist.some((b) => p.name.toLowerCase().includes(b)),
    );
    sel.innerHTML =
      '<option value="">Auto-détection</option>' +
      real
        .map(
          (p) =>
            `<option value="${p.name}" ${settings.printer === p.name ? "selected" : ""}>${p.name}</option>`,
        )
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
  const bar = document.getElementById("selection-bar");
  const countEl = document.getElementById("selection-count");
  if (checked.length > 0) {
    bar.style.display = "flex";
    countEl.textContent =
      checked.length + " sélectionné" + (checked.length > 1 ? "s" : "");
  } else {
    bar.style.display = "none";
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
function confirmJob(groupId, group) {
  if (printingGroups.has(groupId)) return;
  printingGroups.add(groupId);

  const card = document.getElementById(groupId);
  const btn = card.querySelector(".btn-print");
  const btnReject = card.querySelector(".btn-reject");
  const printerName = document.getElementById("printer-select").value;

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
  if (!canvas || !url) {
    console.warn("[QR] canvas introuvable ou URL vide");
    return;
  }

  try {
    // Call main process to generate QR code
    const result = await window.derewol.generateQR(url);
    if (!result || !result.success || !result.dataURL) {
      console.warn("[QR] generateQR échoué :", result?.error || "réponse vide");
      return;
    }
    const dataUrl = result.dataURL;
    const size = 240;
    canvas.width = size;
    canvas.height = size;
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
    };
    img.src = dataUrl;
  } catch (e) {
    console.error("[QR] Erreur génération :", e.message);
  }
}

function downloadQR(cfg) {
  const W = 800,
    H = 1000;
  const offscreen = document.createElement("canvas");
  offscreen.width = W;
  offscreen.height = H;
  const ctx = offscreen.getContext("2d");

  // Fond blanc
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // ── Logo haut ─────────────────────────────────────────────
  const sqSize = 64,
    sqX = W / 2 - 120,
    sqY = 80;
  ctx.fillStyle = "#f5c842";
  roundRect(ctx, sqX, sqY, sqSize, sqSize, 14);
  ctx.fill();

  ctx.textBaseline = "middle";
  ctx.font = "bold 40px serif";
  ctx.fillStyle = "#111510";
  const textY = sqY + sqSize / 2;
  ctx.fillText("Derewol", sqX + sqSize + 16, textY);
  ctx.fillStyle = "#1e4d2b";
  ctx.fillText(
    "Print",
    sqX + sqSize + 16 + ctx.measureText("Derewol").width,
    textY,
  );

  // ── QR centre ─────────────────────────────────────────────
  const sourceCanvas = document.getElementById("qr-canvas");
  const qrSize = 500,
    qrX = (W - qrSize) / 2,
    qrY = 220;

  ctx.fillStyle = "#ffffff";
  roundRect(ctx, qrX - 24, qrY - 24, qrSize + 48, qrSize + 48, 20);
  ctx.fill();
  ctx.strokeStyle = "#d4dbd2";
  ctx.lineWidth = 2;
  roundRect(ctx, qrX - 24, qrY - 24, qrSize + 48, qrSize + 48, 20);
  ctx.stroke();
  ctx.drawImage(sourceCanvas, qrX, qrY, qrSize, qrSize);

  // ── Nom boutique bas ──────────────────────────────────────
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#111510";
  ctx.font = "bold 44px sans-serif";
  ctx.fillText(cfg.name, W / 2, qrY + qrSize + 80);

  ctx.fillStyle = "#7a8c78";
  ctx.font = "22px monospace";
  ctx.fillText(cfg.url, W / 2, qrY + qrSize + 136);

  // ── Télécharge ────────────────────────────────────────────
  const link = document.createElement("a");
  link.download = `derewol-qr-${cfg.slug}.png`;
  link.href = offscreen.toDataURL("image/png", 1.0);
  link.click();
}

function printQR() {
  const printable = document.getElementById("qr-printable");
  const win = window.open("", "_blank", "width=600,height=800");
  win.document.write(`<!DOCTYPE html><html><head>
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=DM+Sans:wght@400;500&display=swap" rel="stylesheet">
    <style>
      body { margin:0; display:flex; justify-content:center; align-items:center; min-height:100vh; background:#fff; font-family:'DM Sans',sans-serif; }
      .qr-printable { text-align:center; padding:40px; }
      .qr-logo { display:flex; align-items:center; justify-content:center; gap:12px; margin-bottom:32px; }
      .qr-logo-mark { width:42px; height:42px; background:#f5c842; border-radius:10px; }
      .qr-logo-text { font-family:'Playfair Display',serif; font-size:24px; color:#111510; }
      .qr-logo-text b { color:#1e4d2b; }
      .qr-code-wrap { margin:0 auto 28px; display:inline-block; padding:16px; border:2px solid #d4dbd2; border-radius:16px; }
      canvas { display:block; }
      .qr-shop-name { font-size:28px; font-weight:700; color:#111510; margin-bottom:8px; }
      .qr-url { font-size:13px; color:#7a8c78; font-family:monospace; }
    </style>
  </head><body>${printable.outerHTML}</body></html>`);
  win.document.close();
  setTimeout(() => {
    win.print();
    win.close();
  }, 500);
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

  // Initialize language system
  initLang();

  // Initialize acceptance modal for trial & payment conditions
  bindAcceptanceModal();

  // Initialize activation modal
  bindActivationModal();

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

      console.log("[DEREWOL] Received show:activation-modal event", data);
      isShowingModal = true;
      window.showActivationModal(data);
      isShowingModal = false;
    });
  }

  // Listen for subscription status updates
  if (window.derewol?.onSubscriptionStatus) {
    window.derewol.onSubscriptionStatus((data) => {
      console.log("[DEREWOL] Received subscription:status event", data);
      handleSubscriptionStatus(data);
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
    });
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
  const dot = document.getElementById("printer-dot");
  const blacklist = ["onenote", "pdf", "fax", "xps", "microsoft"];
  const real = printers.filter(
    (p) => !blacklist.some((b) => p.name.toLowerCase().includes(b)),
  );

  if (real.length === 0) {
    select.innerHTML = "<option>Aucune imprimante physique</option>";
    dot.style.background = "#ff6b6b";
    return;
  }
  select.innerHTML = real
    .map((p) => `<option value="${p.name}">${p.name}</option>`)
    .join("");
  const preferred =
    settings.printer ||
    real.find((p) => p.name.toLowerCase().includes("hp"))?.name;
  if (preferred) select.value = preferred;
  dot.style.background = "var(--jaune)";
});

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
