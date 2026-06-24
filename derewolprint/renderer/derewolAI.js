// derewolAI.js — Interface complète Derewol AI avec drag & drop unifiée
const bridge = window.parent?.derewol || window.derewol || window.electron || {};

function invokeChannel(channel, ...args) {
  return new Promise((resolve, reject) => {
    const requestId = Math.random().toString(36).slice(2);
    const payload = args[0];
    let attempts = 0;
    let timeout = null;

    function cleanup() {
      try {
        window.removeEventListener("message", handler);
      } catch (e) {}
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    }

    function handler(event) {
      if (event.data?.type !== "derewol-invoke-reply") return;
      if (event.data.requestId !== requestId) return;
      cleanup();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.result);
    }

    function doPost() {
      attempts += 1;
      console.debug(
        `[AI IPC] ${channel} (attempt ${attempts}) requestId=${requestId}`,
      );
      try {
        window.parent.postMessage(
          { type: "derewol-invoke", channel, payload, requestId },
          "*",
        );
      } catch (err) {
        cleanup();
        return reject(err);
      }

      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        if (attempts < 2) {
          console.warn(`[AI IPC] timeout for ${channel}, retrying...`);
          doPost();
          return;
        }
        cleanup();
        reject(new Error("IPC timeout"));
      }, 10000);
    }

    window.addEventListener("message", handler);
    doPost();
  });
}

// ── Theme sync ──────────────────────────────────────────────────
function getParentThemeMode() {
  try {
    return (
      window.parent?.document?.body?.classList?.contains("dark-mode") ?? false
    );
  } catch (err) {
    return false;
  }
}

function applyThemeMode() {
  document.body.classList.toggle("dark-mode", getParentThemeMode());
}

function watchParentThemeChanges() {
  applyThemeMode();
  try {
    const parentBody = window.parent.document.body;
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === "class") {
          applyThemeMode();
          break;
        }
      }
    });
    observer.observe(parentBody, {
      attributes: true,
      attributeFilter: ["class"],
    });
  } catch (err) {
    setInterval(applyThemeMode, 1000);
  }
}

// ── State global ───────────────────────────────────────────────────
let currentPrinterId = null;
let claudeEnabled = true;
let lastAnalyzedFile = null;
let lastSuggestions = null;
let isAnalyzing = false;

// ── Déterminer le type de fichier ───────────────────────────────
function getFileType(filePath) {
  const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
  if ([".pdf"].includes(ext)) return "document";
  if ([".xlsx", ".xls"].includes(ext)) return "excel";
  if ([".jpg", ".jpeg", ".png"].includes(ext)) return "image";
  if ([".docx", ".ppt", ".pptx", ".txt"].includes(ext)) return "document";
  return "document"; // fallback
}

// ── Récupérer l'ID de l'imprimante ────────────────────────────────
async function getPrinterId() {
  try {
    if (currentPrinterId) return currentPrinterId;
    const config = await invokeChannel("printer:config");
    if (!config?.id) throw new Error("Configuration imprimeur manquante");
    currentPrinterId = config.id;
    return currentPrinterId;
  } catch (err) {
    console.error("getPrinterId:", err);
    alert("Erreur : Configuration imprimeur introuvable. Redémarrez l'application.");
    throw err;
  }
}

// ── Charger et afficher les crédits ───────────────────────────────
async function loadCredits() {
  try {
    const printerId = await getPrinterId();
    const response = await invokeChannel("ai:checkCredits", { printerId });
    if (response.success) {
      const { remaining, purchased } = response.data;
      document.getElementById("credits-display").textContent =
        `${remaining} crédits ce mois · ${purchased} achetés`;

      const hasCredits = remaining + purchased > 0;
      updateDropzoneState(hasCredits);
      updateRechargeSection(!hasCredits);
    } else {
      document.getElementById("credits-display").textContent =
        "Erreur chargement crédits";
    }
  } catch (err) {
    console.error("loadCredits:", err);
    document.getElementById("credits-display").textContent =
      "Erreur chargement crédits";
  }
}

// ── Mettre à jour l'état de la dropzone ──────────────────────────
function updateDropzoneState(enabled) {
  const dropzone = document.getElementById("dropzone");
  if (enabled && claudeEnabled) {
    dropzone.classList.remove("disabled");
    dropzone.title = "";
  } else {
    dropzone.classList.add("disabled");
    if (!claudeEnabled) {
      dropzone.title = "Derewol AI est désactivé";
    } else {
      dropzone.title = "Crédits épuisés — rechargez pour continuer";
    }
  }
}

// ── Afficher/cacher la section recharge ──────────────────────────
function updateRechargeSection(show) {
  const section = document.getElementById("recharge-section");
  section.classList.toggle("hidden", !show);
}

// ── Analyser le fichier ──────────────────────────────────────────
async function analyzeFile(filePath) {
  if (isAnalyzing) return;
  isAnalyzing = true;

  try {
    const printerId = await getPrinterId();
    const fileType = getFileType(filePath);

    // Afficher le loading
    showLoading(true);
    clearResults();

    let response;
    if (fileType === "excel") {
      response = await invokeChannel("ai:analyzeExcel", {
        filePath,
        printerId,
      });
    } else if (fileType === "image") {
      response = await invokeChannel("ai:ocrDocument", {
        filePath,
        printerId,
      });
    } else {
      response = await invokeChannel("ai:analyzeDocument", {
        filePath,
        printerId,
      });
    }

    showLoading(false);

    if (response.success) {
      lastAnalyzedFile = filePath;
      lastSuggestions = response.data;
      displayResults(response.data);
      await loadCredits();
    } else {
      alert("Erreur lors de l'analyse : " + response.error);
    }
  } catch (err) {
    console.error("analyzeFile:", err);
    showLoading(false);
    alert("Erreur lors de l'analyse du fichier");
  } finally {
    isAnalyzing = false;
  }
}

// ── Afficher le loading ──────────────────────────────────────────
function showLoading(show) {
  const dropzone = document.getElementById("dropzone");
  if (show) {
    dropzone.innerHTML = '<div class="loading"></div>';
  } else {
    restoreDropzoneText();
  }
}

// ── Restaurer le texte de la dropzone ───────────────────────────
function restoreDropzoneText() {
  const dropzone = document.getElementById("dropzone");
  dropzone.innerHTML = `
    <div class="dropzone-icon">📁</div>
    <div class="dropzone-text">Glissez votre fichier ici ou cliquez pour parcourir</div>
    <div class="dropzone-hint">
      Formats acceptés : PDF, XLSX, XLS, DOCX, JPG, PNG, PPT, TXT
    </div>
  `;
}

// ── Effacer les résultats ────────────────────────────────────────
function clearResults() {
  document.getElementById("results-section").classList.add("hidden");
  document.getElementById("btn-apply").classList.add("hidden");
  document.getElementById("file-info").classList.add("hidden");
}

// ── Afficher les résultats ───────────────────────────────────────
function displayResults(data) {
  const resultsSection = document.getElementById("results-section");
  resultsSection.classList.remove("hidden");

  // Suggestions
  const suggestionsList = document.getElementById("suggestions-list");
  suggestionsList.innerHTML = "";
  if (data.suggestions && data.suggestions.length > 0) {
    data.suggestions.forEach((sugg) => {
      const li = document.createElement("li");
      li.textContent = sugg;
      suggestionsList.appendChild(li);
    });
    document.getElementById("btn-apply").classList.remove("hidden");
  } else {
    suggestionsList.innerHTML = "<li>Aucune suggestion spécifique</li>";
  }

  // Avertissements
  const warningsCard = document.getElementById("warnings-card");
  const warningsList = document.getElementById("warnings-list");
  warningsList.innerHTML = "";
  if (data.warnings && data.warnings.length > 0) {
    data.warnings.forEach((warn) => {
      const li = document.createElement("li");
      li.textContent = warn;
      warningsList.appendChild(li);
    });
    warningsCard.classList.remove("hidden");
  } else {
    warningsCard.classList.add("hidden");
  }

  // Détails
  document.getElementById("orientation").textContent =
    data.orientation || data.orient || "-";
  document.getElementById("mode").textContent = data.mode || "-";
  document.getElementById("content-type").textContent =
    data.type_contenu || data.contentType || "-";
  document.getElementById("format").textContent =
    data.format_recommande || data.format || "-";

  // Info fichier
  const fileInfo = document.getElementById("file-info");
  document.getElementById("file-name").textContent = lastAnalyzedFile
    ? lastAnalyzedFile.split(/[\\/]/).pop()
    : "";
  fileInfo.classList.remove("hidden");
}

// ── Appliquer les suggestions ────────────────────────────────────
async function applySuggestions() {
  if (!lastAnalyzedFile || !lastSuggestions) {
    alert("Aucun fichier analysé à appliquer");
    return;
  }

  try {
    const printerId = await getPrinterId();
    const payload = {
      filePath: lastAnalyzedFile,
      suggestions: lastSuggestions,
    };

    const res = await invokeChannel("ai:applySuggestions", payload);
    if (!res?.success) {
      alert("Erreur application suggestions: " + (res?.error || "inconnu"));
      return;
    }

    // Afficher la modale
    showActionModal(res.tempFilePath);
  } catch (err) {
    console.error("applySuggestions:", err);
    alert("Erreur lors de l'application des suggestions");
  }
}

// ── Afficher la modale action (imprimer/sauvegarder) ─────────────
function showActionModal(tempFilePath) {
  const modal = document.getElementById("modal-action");
  document.getElementById("modal-file-path").textContent = tempFilePath;
  modal.classList.remove("hidden");
}

// ── Fermer la modale ────────────────────────────────────────────
function closeActionModal() {
  document.getElementById("modal-action").classList.add("hidden");
}

// ── Imprimer le fichier ────────────────────────────────────────
async function printFile(tempFilePath) {
  try {
    const res = await invokeChannel("print:local", { tempFilePath });
    if (!res?.success) {
      alert("Erreur impression: " + (res?.error || "inconnu"));
      return;
    }
    closeActionModal();
    alert("Fichier envoyé à l'imprimante");
  } catch (err) {
    console.error("printFile:", err);
    alert("Erreur lors de l'impression");
  }
}

// ── Sauvegarder le fichier ─────────────────────────────────────
async function saveFile(tempFilePath) {
  try {
    const fileName = tempFilePath.split(/[\\/]/).pop();
    const res = await invokeChannel("file:saveToDocuments", {
      tempFilePath,
      fileName,
      subDir: "derewol-ai-files",
    });

    if (!res?.success) {
      alert("Erreur sauvegarde: " + (res?.error || "inconnu"));
      return;
    }

    closeActionModal();
    alert(`Fichier sauvegardé dans Documents/derewol-ai-files/`);
  } catch (err) {
    console.error("saveFile:", err);
    alert("Erreur lors de la sauvegarde");
  }
}

// ── Recharger les crédits (WhatsApp) ───────────────────────────
async function rechargeCredits(credits, amountXof) {
  try {
    const printerId = await getPrinterId();
    const message = encodeURIComponent(
      `Bonjour, je souhaite recharger ${credits} crédits Derewol AI (${amountXof} XOF). Mon ID boutique : ${printerId}`,
    );
    const whatsappUrl = `https://wa.me/+221781220391?text=${message}`;

    await invokeChannel("shell:openExternal", { url: whatsappUrl });
  } catch (err) {
    console.error("rechargeCredits:", err);
  }
}

// ── Setup drag & drop ────────────────────────────────────────────
function setupDragDrop() {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");

  // Click pour ouvrir dialog
  dropzone.addEventListener("click", () => {
    if (!claudeEnabled) {
      alert("Derewol AI est désactivé");
      return;
    }
    fileInput.click();
  });

  // Drag over
  dropzone.addEventListener("dragover", (e) => {
    if (!claudeEnabled) return;
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.add("drag-over");
  });

  // Drag leave
  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("drag-over");
  });

  // Drop
  dropzone.addEventListener("drop", (e) => {
    if (!claudeEnabled) {
      alert("Derewol AI est désactivé");
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove("drag-over");

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      fileInput.files = files;
      analyzeFile(file.path);
    }
  });

  // File input change
  fileInput.addEventListener("change", () => {
    if (fileInput.files.length > 0) {
      const file = fileInput.files[0];
      analyzeFile(file.path);
    }
  });
}

// ── Setup toggle Claude ──────────────────────────────────────────
function setupToggle() {
  const toggle = document.getElementById("toggle-claude");
  const stored = localStorage.getItem("derewol_ai_enabled");
  claudeEnabled = stored === null ? true : stored === "1";

  // Mettre à jour visuellement
  if (claudeEnabled) {
    toggle.classList.add("active");
  }

  toggle.addEventListener("click", () => {
    claudeEnabled = !claudeEnabled;
    localStorage.setItem("derewol_ai_enabled", claudeEnabled ? "1" : "0");
    toggle.classList.toggle("active");
    updateDropzoneState(
      !document
        .getElementById("recharge-section")
        .classList.contains("hidden"),
    );
    if (!claudeEnabled) {
      clearResults();
    }
  });

  // Mettre à jour l'état initial de la dropzone
  const rechargeShown = !document
    .getElementById("recharge-section")
    .classList.contains("hidden");
  updateDropzoneState(!rechargeShown);
}

// ── Setup boutons ────────────────────────────────────────────────
function setupButtons() {
  // Apply suggestions
  document
    .getElementById("btn-apply")
    .addEventListener("click", applySuggestions);

  // Modal actions
  document.getElementById("modal-btn-print").addEventListener("click", () => {
    const path = document.getElementById("modal-file-path").textContent;
    printFile(path);
  });

  document.getElementById("modal-btn-save").addEventListener("click", () => {
    const path = document.getElementById("modal-file-path").textContent;
    saveFile(path);
  });

  // Recharge buttons
  document.querySelectorAll(".btn-recharge").forEach((btn) => {
    btn.addEventListener("click", () => {
      const credits = parseInt(btn.dataset.credits);
      const amount = parseInt(btn.dataset.amount);
      rechargeCredits(credits, amount);
    });
  });
}

// ── Initialize ───────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  watchParentThemeChanges();

  try {
    await getPrinterId();
    await loadCredits();
  } catch (err) {
    console.error("Init error:", err);
  }

  setupToggle();
  setupDragDrop();
  setupButtons();

  // Polling crédits toutes les 30s
  setInterval(async () => {
    try {
      await loadCredits();
      console.log("[AI] Crédits rafraîchis");
    } catch (e) {
      console.warn("[AI] Polling crédits erreur:", e.message);
    }
  }, 30000);

  // Écouter les mises à jour de crédits du parent
  window.addEventListener("message", (e) => {
    if (e.data?.type === "ai-credits-updated") {
      console.log("[AI] Crédits mis à jour depuis le parent");
      loadCredits();
    }
  });

  // Callback si disponible
  if (window.derewol?.onAICreditsUpdated) {
    window.derewol.onAICreditsUpdated(() => {
      console.log("[AI] Événement credits-updated");
      loadCredits();
    });
  }
});
