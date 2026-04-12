/* renderer.js */

import jobStore from "./js/state/jobStore.js";
import renderJobs, { getFileCopies, setStoreRef } from "./js/ui/renderJobs.js";
import { initBridge } from "./js/bridge/derewolBridge.js";

const printingGroups = new Set();
setStoreRef((id) => jobStore.getJobs().find((g) => g.id === id));

// ════════════════════════════════════════════════════════════════
// ACTIVATION MODAL FUNCTIONS ═════════════════════════════════════
// ════════════════════════════════════════════════════════════════

function showActivationModal(subscription) {
  const backdrop = document.getElementById("activation-backdrop");
  const modal = document.getElementById("activation-modal");

  if (!backdrop || !modal) return;

  const titleEl = modal.querySelector(".act-title");
  const descEl = modal.querySelector(".act-description");

  if (subscription && subscription.valid === true) {
    titleEl.textContent = "Abonnement actif";
    descEl.textContent =
      "Votre abonnement est actif.\nMerci de votre confiance!";
  } else if (subscription && subscription.trial_active === true) {
    const daysLeft = Math.ceil(
      (new Date(subscription.trial_expires_at) - new Date()) /
        (1000 * 60 * 60 * 24),
    );
    titleEl.textContent = "Période d'essai";
    descEl.textContent = `Vous avez ${daysLeft} jour${daysLeft > 1 ? "s" : ""} d\'essai gratuit.`;
  } else {
    titleEl.textContent = "Activation Derewol Print";
    descEl.textContent = "Démarrez votre essai gratuit ou activez votre code.";
  }

  backdrop.classList.add("show");
}

function hideActivationModal() {
  const backdrop = document.getElementById("activation-backdrop");
  if (backdrop) backdrop.classList.remove("show");
}

function toggleActivationTab(tabName) {
  const tabs = document.querySelectorAll(".act-tab");
  const panels = document.querySelectorAll(".act-panel");

  tabs.forEach((tab) => tab.classList.remove("active"));
  panels.forEach((panel) => panel.classList.remove("active"));

  document
    .querySelector(`[data-act-tab="${tabName}"]`)
    ?.classList.add("active");
  document.getElementById(`act-panel-${tabName}`)?.classList.add("active");
}

function formatActivationCode(input) {
  let full = input.value.replace(/[^0-9A-Z]/gi, "").toUpperCase();
  if (full.length > 4) full = full.substring(0, 4) + "-" + full.substring(4);
  if (full.length > 9) full = full.substring(0, 9) + "-" + full.substring(9);
  if (full.length > 14)
    full = full.substring(0, 14) + "-" + full.substring(14, 18);
  input.value = full;
}

function bindActivationModal(printerSlug) {
  const backdrop = document.getElementById("activation-backdrop");
  const modal = document.getElementById("activation-modal");

  if (!backdrop || !modal) return;

  // Tab switching
  const tabs = modal.querySelectorAll(".act-tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      toggleActivationTab(tab.dataset.actTab);
    });
  });

  // Trial button
  const trialBtn = modal.querySelector(".act-btn-activate");
  if (trialBtn) {
    trialBtn.addEventListener("click", () => {
      // Show acceptance modal for trial conditions first
      hideActivationModal();
      showAcceptanceModal("trial");
    });
  }

  // WhatsApp button
  const whatsappBtn = modal.querySelector("#act-whatsapp-link");
  if (whatsappBtn) {
    whatsappBtn.addEventListener("click", () => {
      const phone = "+221775000000";
      const message = `Bonjour! Je voudrais en savoir plus sur les abonnements Derewol Print pour l'imprimante: ${printerSlug}`;
      const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
      window.open(url, "_blank");
    });
  }

  // Code input formatting
  const codeInput = modal.querySelector(".act-code-input");
  if (codeInput) {
    codeInput.addEventListener("input", (e) => formatActivationCode(e.target));
  }

  // Code submit button
  const codeBtn = modal.querySelector(".act-code-btn");
  const codeError = modal.querySelector(".act-code-error");

  if (codeBtn) {
    codeBtn.addEventListener("click", async () => {
      const code = codeInput.value.replace(/-/g, "");
      if (!code || code.length !== 16) {
        if (codeError) {
          codeError.textContent = "Code invalide (format: DW-XXXX-XXXX-XXXX)";
          codeError.classList.add("show");
        }
        return;
      }

      codeBtn.disabled = true;
      codeBtn.textContent = "Vérification...";

      try {
        const result = await window.derewol.subscriptionActivate(code);
        if (result.success) {
          codeBtn.textContent = "✓ Activé!";
          codeInput.value = "";
          if (codeError) codeError.classList.remove("show");
          setTimeout(() => {
            hideActivationModal();
            location.reload();
          }, 1500);
        } else {
          if (codeError) {
            codeError.textContent = result.error || "Code invalide";
            codeError.classList.add("show");
          }
          codeBtn.disabled = false;
          codeBtn.textContent = "Activer";
        }
      } catch (e) {
        if (codeError) {
          codeError.textContent = "Erreur: " + e.message;
          codeError.classList.add("show");
        }
        codeBtn.disabled = false;
        codeBtn.textContent = "Activer";
      }
    });
  }

  // Close on backdrop click
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) hideActivationModal();
  });
}

function handleSubscriptionStatus(subscription, printerSlug) {
  const modal = document.getElementById("activation-modal");
  if (!modal) return;

  const blocked =
    subscription &&
    subscription.valid !== true &&
    subscription.trial_active !== true;

  if (blocked) {
    showActivationModal(subscription);
  } else {
    hideActivationModal();
    bindActivationModal(printerSlug);
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
  console.log("bindAcceptanceModal called");

  const backdrop = document.getElementById("acceptance-backdrop");
  const modal = document.getElementById("acceptance-modal");

  console.log("Looking for modal elements...");
  console.log("backdrop:", backdrop);
  console.log("modal:", modal);

  if (!backdrop || !modal) {
    console.error("Modal elements not found in bindAcceptanceModal!");
    return;
  }

  console.log("Modal elements found, binding events...");

  const cancelBtn = modal.querySelector("#acc-btn-cancel");
  const acceptBtn = modal.querySelector("#acc-btn-accept");

  console.log("cancelBtn:", cancelBtn);
  console.log("acceptBtn:", acceptBtn);

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
              location.reload();
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
              location.reload();
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

  // Close on backdrop click
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) hideAcceptanceModal();
  });
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
        <div class="empty-icon">📋</div>
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
          👤 ${h.display_id || h.owner_id}
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
});
document.getElementById("setting-sound").addEventListener("change", (e) => {
  settings.sound = e.target.checked;
  saveSettings();
  window.__derewolSoundEnabled = e.target.checked;
});
document.getElementById("setting-polling").addEventListener("change", (e) => {
  settings.polling = parseInt(e.target.value);
  saveSettings();
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
    btn.textContent = "🖨️ Imprimer tout";
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
      btn.textContent = "✅ Copié !";
      setTimeout(() => (btn.textContent = "🔗 Copier le lien"), 2000);
    });

    document
      .getElementById("btn-print-qr")
      .addEventListener("click", () => printQR());
  }
}

function generateQR(url) {
  const canvas = document.getElementById("qr-canvas");
  if (!canvas || typeof qrcode === "undefined") {
    console.warn("[QR] qrcode-generator non chargé");
    return;
  }

  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();

  const size = 240;
  const cells = qr.getModuleCount();
  const cell = Math.floor(size / cells);
  const offset = Math.floor((size - cell * cells) / 2);

  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#111510";

  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      if (qr.isDark(r, c)) {
        ctx.fillRect(offset + c * cell, offset + r * cell, cell, cell);
      }
    }
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

initBridge();

// Initialize acceptance modal for trial & payment conditions
// Wait for DOM to be ready before binding
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindAcceptanceModal);
} else {
  bindAcceptanceModal();
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
