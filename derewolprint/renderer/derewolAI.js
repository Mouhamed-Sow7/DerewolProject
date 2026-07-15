const bridge =
  window.parent?.derewol || window.derewol || window.electron || {};

function invokeChannel(channel, payload = {}) {
  if (bridge?.invoke) {
    return bridge.invoke(channel, payload);
  }

  return new Promise((resolve, reject) => {
    const requestId = Math.random().toString(36).slice(2);
    let timeoutId = null;

    function cleanup() {
      window.removeEventListener("message", handler);
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    }

    function handler(event) {
      if (event.data?.type !== "derewol-invoke-reply") return;
      if (event.data?.requestId !== requestId) return;
      cleanup();
      if (event.data.error) {
        reject(new Error(event.data.error));
      } else {
        resolve(event.data.result);
      }
    }

    window.addEventListener("message", handler);
    try {
      window.parent.postMessage(
        { type: "derewol-invoke", channel, payload, requestId },
        "*",
      );
    } catch (error) {
      cleanup();
      reject(error);
    }

    timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("IPC timeout"));
    }, 15000);
  });
}

const SUPPORTED_EXTENSIONS = [
  "pdf",
  "xlsx",
  "xls",
  "docx",
  "jpg",
  "jpeg",
  "png",
  "ppt",
  "pptx",
  "txt",
];

let currentPrinterId = null;
let currentPrinterName = "Imprimante active";
let currentCredits = { remaining: 0, purchased: 0, total: 0 };
let claudeEnabled = true;
let selectedFilePath = null;
let selectedFileType = null;
let analysisMode = null;
let lastOcrData = null;

function formatBytes(bytes) {
  if (bytes === 0) return "0 o";
  const sizes = ["o", "Ko", "Mo", "Go"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${Number((bytes / 1024 ** i).toFixed(1))} ${sizes[i]}`;
}

function getExtension(filePath) {
  return filePath.split(".").pop().toLowerCase();
}

function getFileType(filePath) {
  const ext = getExtension(filePath);
  if (["jpg", "jpeg", "png"].includes(ext)) return "image";
  if (["xlsx", "xls"].includes(ext)) return "excel";
  if (["pdf", "docx", "ppt", "pptx", "txt"].includes(ext)) return "document";
  return "document";
}

function getFileIcon(ext) {
  if (["pdf"].includes(ext)) return "📄";
  if (["xlsx", "xls"].includes(ext)) return "📊";
  if (["jpg", "jpeg", "png"].includes(ext)) return "🖼️";
  if (["docx", "ppt", "pptx", "txt"].includes(ext)) return "📎";
  return "📁";
}

function getCleanFileName(filePath) {
  return filePath.split(/[\\/]/).pop();
}

function setStatus(message, type = "info") {
  const status = document.getElementById("status-card");
  status.textContent = message;
  status.classList.remove("hidden");
  status.style.borderColor =
    type === "warning"
      ? "#f5a623"
      : type === "error"
        ? "#d9534f"
        : "var(--border)";
  status.style.color = type === "error" ? "#a33" : "var(--text)";
}

function clearStatus() {
  const status = document.getElementById("status-card");
  status.textContent = "";
  status.classList.add("hidden");
}

function toggleDarkMode() {
  document.body.classList.toggle("dark-mode", getParentThemeMode());
}

function getSelectedPrinterName() {
  try {
    return window.parent?.localStorage?.getItem("derewol:lastPrinter") || null;
  } catch {
    return null;
  }
}

function getParentThemeMode() {
  try {
    return window.parent?.document?.body?.classList?.contains("dark-mode");
  } catch (error) {
    return false;
  }
}

function setDropzoneEnabled(enabled) {
  const dropzone = document.getElementById("dropzone");
  if (enabled) {
    dropzone.classList.remove("disabled");
  } else {
    dropzone.classList.add("disabled");
  }
}

function showPreviewCard(show) {
  const card = document.getElementById("preview-card");
  card.classList.toggle("hidden", !show);
}

function showAnalysisCard(show) {
  document.getElementById("analysis-card").classList.toggle("hidden", !show);
}

function showOcrCard(show) {
  document.getElementById("ocr-card").classList.toggle("hidden", !show);
}

async function getPrinterConfig() {
  if (currentPrinterId) {
    return { id: currentPrinterId, name: currentPrinterName };
  }

  const config = await invokeChannel("printer:config");
  currentPrinterId = config?.id;
  currentPrinterName = config?.name || currentPrinterName;
  return config;
}

async function chargerCredits() {
  try {
    const config = await getPrinterConfig();
    if (!config?.id) {
      throw new Error("Configuration de l'imprimante introuvable");
    }
    const response = await invokeChannel("ai:checkCredits", {
      printerId: config.id,
    });
    if (response.success) {
      const { remaining, purchased } = response.data;
      currentCredits = {
        remaining: Number(remaining || 0),
        purchased: Number(purchased || 0),
        total: Number((remaining || 0) + (purchased || 0)),
      };
      document.getElementById("credits-display").textContent =
        `${currentCredits.total} crédits disponibles (${currentCredits.remaining} mensuels, ${currentCredits.purchased} achetés)`;
      updateInterfaceState();

      const statusCard = document.getElementById("status-card");
      if (
        statusCard &&
        statusCard.textContent.toLowerCase().includes("recharger") &&
        currentCredits.total > 0
      ) {
        statusCard.classList.add("hidden");
      }
    } else {
      document.getElementById("credits-display").textContent =
        "Erreur chargement crédits";
      updateInterfaceState(false);
    }
  } catch (error) {
    console.error("chargerCredits", error);
    document.getElementById("credits-display").textContent =
      "Erreur chargement crédits";
    updateInterfaceState(false);
  }
}

function updateInterfaceState(hasCredits = currentCredits.total > 0) {
  const rechargeSection = document.getElementById("recharge-section");
  rechargeSection.classList.toggle("hidden", hasCredits);
  const dropzoneEnabled = hasCredits && claudeEnabled;
  setDropzoneEnabled(dropzoneEnabled);
  if (!hasCredits) {
    showPreviewCard(false);
    showAnalysisCard(false);
    showOcrCard(false);
    setStatus("Rechargez vos crédits pour continuer.", "warning");
  } else {
    clearStatus();
    if (selectedFilePath) {
      showPreviewCard(true);
    }
  }
}

function renderFilePreview() {
  const name = getCleanFileName(selectedFilePath);
  const ext = getExtension(selectedFilePath);
  const badge = `${getFileIcon(ext)} ${ext.toUpperCase()}`;

  document.getElementById("file-name").textContent = name;
  document.getElementById("file-badge").textContent = badge;
  document.getElementById("file-size").textContent = "Calcul de la taille...";

  invokeChannel("file:getSize", { filePath: selectedFilePath })
    .then((response) => {
      if (response.success) {
        document.getElementById("file-size").textContent = formatBytes(
          response.size,
        );
      } else {
        document.getElementById("file-size").textContent = "Taille introuvable";
      }
    })
    .catch(() => {
      document.getElementById("file-size").textContent = "Taille introuvable";
    });

  showPreviewCard(true);
  clearStatus();
  showAnalysisCard(false);
  showOcrCard(false);
  analysisMode = null;
  lastOcrData = null;
}

function canPerformOcr() {
  return ["image", "document"].includes(selectedFileType);
}

function updateActionButtons() {
  const analyzeBtn = document.getElementById("btn-analyze");
  const ocrBtn = document.getElementById("btn-ocr");
  const active = currentCredits.total > 0 && claudeEnabled;

  analyzeBtn.disabled = !active || !selectedFilePath;
  ocrBtn.disabled = !active || !selectedFilePath || !canPerformOcr();
  ocrBtn.textContent = canPerformOcr()
    ? "🔍 Extraire le texte (OCR)"
    : "OCR indisponible";
}

function showLoadingOnDropzone(enabled) {
  const dropzone = document.getElementById("dropzone");
  if (enabled) {
    dropzone.innerHTML = '<div class="loader"></div>';
  } else {
    dropzone.innerHTML =
      '<div class="dropzone-icon">📁</div><div class="dropzone-text">Glissez votre fichier ici ou cliquez pour parcourir</div><div class="dropzone-hint">Formats acceptés : PDF, XLSX, XLS, DOCX, JPG, PNG, PPT, TXT</div>';
  }
}

function prepareSelectedFile(filePath) {
  selectedFilePath = filePath;
  selectedFileType = getFileType(filePath);
  renderFilePreview();
  updateActionButtons();
}

async function openFilePicker() {
  if (currentCredits.total <= 0) {
    setStatus(
      "Vous devez recharger vos crédits avant de sélectionner un fichier.",
      "warning",
    );
    return;
  }

  try {
    const result = await invokeChannel("dialog:openFile", {
      filters: [
        {
          name: "Fichiers supportés",
          extensions: SUPPORTED_EXTENSIONS,
        },
      ],
    });
    if (result?.filePaths?.length > 0) {
      prepareSelectedFile(result.filePaths[0]);
    }
  } catch (error) {
    console.error("openFilePicker", error);
    setStatus("Impossible d'ouvrir le sélecteur de fichier.", "error");
  }
}

function collapseResults() {
  showAnalysisCard(false);
  showOcrCard(false);
}

function renderSuggestions(suggestions = []) {
  const suggestionsList = document.getElementById("suggestions-list");

  suggestionsList.innerHTML = "";

  if (!suggestions.length) {
    const d = document.createElement("div");
    d.className = "sugg-item";
    d.textContent = "Aucune suggestion spécifique détectée.";
    suggestionsList.appendChild(d);
    return;
  }

  (suggestions || []).forEach((s) => {
    const d = document.createElement("div");
    d.className = "sugg-item";
    d.textContent = s;
    suggestionsList.appendChild(d);
  });
}

function renderWarnings(warnings = []) {
  const warningsList = document.getElementById("warnings-list");

  warningsList.innerHTML = "";

  if (warnings && warnings.length > 0) {
    warnings.forEach((w) => {
      const d = document.createElement("div");
      d.className = "warn-item";
      d.textContent = w;
      warningsList.appendChild(d);
    });

    document.getElementById("warnings-block").classList.remove("hidden");
    return;
  }

  document.getElementById("warnings-block").classList.add("hidden");
}

function renderAnalysisDetails(data) {
  document.getElementById("det-orient").textContent =
    data.orientation || data.orientation_recommandee || "-";
  document.getElementById("det-mode").textContent =
    data.mode || data.mode_recommande || data.contentType || "-";
  document.getElementById("det-format").textContent =
    data.format || data.format_recommande || "-";
  document.getElementById("det-scale").textContent =
    data.scale || data.echelle_recommandee || "-";
}

function displayAnalysisResult(data) {
  renderSuggestions(data.suggestions || data.issues || []);
  renderWarnings(data.warnings || data.issues || []);
  renderAnalysisDetails(data);
  showAnalysisCard(true);
  showOcrCard(false);
}

function displayOcrResult(data) {
  lastOcrData = data;
  document.getElementById("ocr-doc-type").textContent =
    `Document détecté : ${data.docType || "Autre"}`;
  document.getElementById("ocr-text").textContent =
    data.text || "Aucun texte extrait.";
  showOcrCard(true);
  showAnalysisCard(false);
  analysisMode = "ocr";
}

async function analyzeForPrint() {
  if (!claudeEnabled) {
    setStatus("Derewol AI est désactivé. Activez-le pour continuer.", "warning");
    return;
  }
  if (!selectedFilePath) {
    setStatus("Sélectionnez d'abord un fichier.", "warning");
    return;
  }
  if (currentCredits.total <= 0) {
    setStatus("Crédits insuffisants.", "warning");
    return;
  }

  try {
    clearStatus();
    showLoadingOnDropzone(true);
    const printerConfig = await getPrinterConfig();
    if (!printerConfig?.id) {
      throw new Error("Printer config missing");
    }
    let response;
    if (selectedFileType === "excel") {
      response = await invokeChannel("ai:analyzeExcel", {
        filePath: selectedFilePath,
        printerId: printerConfig.id,
      });
    } else {
      response = await invokeChannel("ai:analyzeDocument", {
        filePath: selectedFilePath,
        printerId: printerConfig.id,
      });
    }

    showLoadingOnDropzone(false);
    if (!response?.success) {
      throw new Error(response?.error || "Analyse échouée");
    }
    analysisMode = "print";
    displayAnalysisResult(response.data || {});
    await chargerCredits();
  } catch (error) {
    console.error("analyzeForPrint", error);
    showLoadingOnDropzone(false);
    setStatus(`Erreur d'analyse : ${error.message}`, "error");
  }
}

async function extractText() {
  if (!claudeEnabled) {
    setStatus("Derewol AI est désactivé. Activez-le pour continuer.", "warning");
    return;
  }
  if (!selectedFilePath) {
    setStatus("Sélectionnez d'abord un fichier.", "warning");
    return;
  }
  if (currentCredits.total <= 0) {
    setStatus("Crédits insuffisants.", "warning");
    return;
  }

  try {
    clearStatus();
    showLoadingOnDropzone(true);
    const printerConfig = await getPrinterConfig();
    if (!printerConfig?.id) {
      throw new Error("Printer config missing");
    }
    const response = await invokeChannel("ai:ocrDocument", {
      filePath: selectedFilePath,
      printerId: printerConfig.id,
    });
    showLoadingOnDropzone(false);
    if (!response?.success) {
      throw new Error(response?.error || "OCR échoué");
    }
    displayOcrResult(response.data || {});
    await chargerCredits();
  } catch (error) {
    console.error("extractText", error);
    showLoadingOnDropzone(false);
    setStatus(`Erreur OCR : ${error.message}`, "error");
  }
}

async function applyExcelFull() {
  try {
    if (!selectedFilePath) {
      throw new Error("Aucun fichier sélectionné");
    }
    console.log("[AI] Appel du handler ai:applyExcelFull avec filePath:", selectedFilePath);
    const result = await invokeChannel("ai:applyExcelFull", {
      filePath: selectedFilePath,
    });
    console.log("[AI] Résultat de ai:applyExcelFull:", result);
    if (!result?.success) {
      throw new Error(result?.error || "Échec de l'application Excel");
    }
    openActionModal(result.tempFilePath);
  } catch (error) {
    console.error("applyExcelFull", error);
    setStatus(`Erreur application Excel : ${error.message}`, "error");
  }
}

async function applyOcrImprovements(improvements = []) {
  try {
    if (!lastOcrData?.text) {
      throw new Error("Aucun texte OCR disponible");
    }
    const printerConfig = await getPrinterConfig();
    if (!printerConfig?.id) {
      throw new Error("Printer config missing");
    }
    const payload = {
      text: lastOcrData.text,
      docType: lastOcrData.docType || "Autre",
      improvements,
      printerId: printerConfig.id,
    };
    const response = await invokeChannel("ai:improveOcrText", payload);
    if (!response?.success) {
      throw new Error(response?.error || "Échec de l'amélioration OCR");
    }
    openActionModal(response.tempFilePath);
  } catch (error) {
    console.error("applyOcrImprovements", error);
    setStatus(`Erreur amélioration OCR : ${error.message}`, "error");
  }
}

async function preparePrintFile() {
  if (!selectedFilePath) {
    setStatus("Aucun fichier n'a été analysé.", "warning");
    return;
  }

  if (analysisMode === "ocr") {
    return applyOcrImprovements(getSelectedImprovements());
  }

  if (selectedFileType === "excel") {
    return applyExcelFull();
  }

  openActionModal(selectedFilePath);
}

function getSelectedImprovements() {
  const improvements = [];
  if (document.getElementById("opt-format").checked) {
    improvements.push("Corriger la mise en forme");
  }
  if (document.getElementById("opt-style").checked) {
    improvements.push("Améliorer le texte (orthographe, style)");
  }
  if (document.getElementById("opt-layout").checked) {
    improvements.push("Restructurer la mise en page");
  }
  return improvements;
}

function openActionModal(tempFilePath) {
  document.getElementById("modal-fname").textContent =
    `Nom du fichier : ${getCleanFileName(tempFilePath)}`;
  document.getElementById("modal-printer").textContent =
    `Imprimante : ${currentPrinterName}`;
  document.getElementById("modal-print").dataset.tempFilePath = tempFilePath;
  document.getElementById("modal-save").dataset.tempFilePath = tempFilePath;
  document.getElementById("modal-action").classList.remove("hidden");
}

function closeActionModal() {
  document.getElementById("modal-action").classList.add("hidden");
}

async function printTempFile(tempFilePath) {
  try {
    const result = await invokeChannel("print:local", {
      tempFilePath,
      printerName: getSelectedPrinterName(),
    });
    if (!result?.success) {
      throw new Error(result?.error || "Échec impression");
    }
    closeActionModal();
    setStatus("Fichier envoyé à l'imprimante.", "info");
  } catch (error) {
    console.error("printTempFile", error);
    setStatus(`Erreur impression : ${error.message}`, "error");
  }
}

async function saveTempFile(tempFilePath) {
  try {
    const result = await invokeChannel("file:saveToAIFolder", { tempFilePath });
    if (!result?.success) {
      throw new Error(result?.error || "Échec sauvegarde");
    }
    closeActionModal();
    setStatus("Fichier sauvegardé dans Documents/derewol-ai-files/.", "info");
  } catch (error) {
    console.error("saveTempFile", error);
    setStatus(`Erreur sauvegarde : ${error.message}`, "error");
  }
}

async function openWhatsAppContact() {
  const printerConfig = await getPrinterConfig();
  const message = encodeURIComponent(
    `Bonjour, je souhaite recharger mes crédits Derewol AI. ID boutique : ${printerConfig?.id || "inconnu"}`,
  );
  await invokeChannel("shell:openExternal", {
    url: `https://wa.me/+221781220391?text=${message}`,
  });
}

function resetInterface() {
  selectedFilePath = null;
  selectedFileType = null;
  analysisMode = null;
  lastOcrData = null;
  document.getElementById("file-name").textContent = "—";
  document.getElementById("file-badge").textContent = "—";
  document.getElementById("file-size").textContent = "—";
  showPreviewCard(false);
  collapseResults();
  updateActionButtons();
  clearStatus();
}

function setupDragAndDrop() {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");

  dropzone.addEventListener("click", () => {
    if (!claudeEnabled) {
      setStatus("Derewol AI est désactivé.", "warning");
      return;
    }
    openFilePicker();
  });

  dropzone.addEventListener("dragover", (event) => {
    if (!claudeEnabled) return;
    event.preventDefault();
    dropzone.classList.add("drag-over");
  });

  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("drag-over");
  });

  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropzone.classList.remove("drag-over");
    if (!claudeEnabled) {
      setStatus("Derewol AI est désactivé.", "warning");
      return;
    }
    const file = event.dataTransfer.files?.[0];
    if (file) {
      prepareSelectedFile(file.path);
    }
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) {
      prepareSelectedFile(file.path);
    }
  });
}

function setupToggle() {
  const toggle = document.getElementById("toggle-claude");
  const stored = localStorage.getItem("derewol_ai_enabled");
  claudeEnabled = stored === null ? true : stored === "1";
  toggle.classList.toggle("on", claudeEnabled);
  toggle.addEventListener("click", () => {
    claudeEnabled = !claudeEnabled;
    localStorage.setItem("derewol_ai_enabled", claudeEnabled ? "1" : "0");
    toggle.classList.toggle("on", claudeEnabled);
    if (!claudeEnabled) {
      setStatus("Derewol AI est désactivé. Activez-le pour continuer.", "warning");
    } else if (currentCredits.total > 0) {
      clearStatus();
    }
    updateInterfaceState();
    updateActionButtons();
  });
}

function setupButtons() {
  document
    .getElementById("btn-analyze")
    .addEventListener("click", analyzeForPrint);
  document.getElementById("btn-ocr").addEventListener("click", extractText);
  document
    .getElementById("btn-apply")
    .addEventListener("click", preparePrintFile);
  document
    .getElementById("btn-reset")
    .addEventListener("click", resetInterface);
  document
    .getElementById("btn-improve")
    .addEventListener("click", () =>
      applyOcrImprovements(getSelectedImprovements()),
    );
  document
    .getElementById("btn-use-as-is")
    .addEventListener("click", () => applyOcrImprovements([]));
  const rechargeContactButton = document.getElementById("btn-recharge-contact");
  if (rechargeContactButton) {
    rechargeContactButton.addEventListener("click", openWhatsAppContact);
  }

  document.getElementById("modal-print").addEventListener("click", (event) => {
    const filePath = event.currentTarget.dataset.tempFilePath;
    printTempFile(filePath);
  });
  document.getElementById("modal-save").addEventListener("click", (event) => {
    const filePath = event.currentTarget.dataset.tempFilePath;
    saveTempFile(filePath);
  });
  document
    .getElementById("modal-cancel")
    .addEventListener("click", closeActionModal);
}

function setupThemeObserver() {
  toggleDarkMode();
  try {
    const parentBody = window.parent.document.body;
    const observer = new MutationObserver(() => {
      toggleDarkMode();
    });
    observer.observe(parentBody, {
      attributes: true,
      attributeFilter: ["class"],
    });
  } catch (error) {
    setInterval(toggleDarkMode, 1000);
  }
}

window.addEventListener("message", (event) => {
  if (event.data?.type === "ai-credits-updated") {
    chargerCredits();
  }
});

function waitForBridgeAndInit() {
  const bridge = window.parent?.derewol || window.derewol || window.electron;
  if (bridge && typeof bridge.invoke === "function") {
    chargerCredits();
  } else {
    setTimeout(waitForBridgeAndInit, 150);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setupThemeObserver();
  setupDragAndDrop();
  setupToggle();
  setupButtons();
  waitForBridgeAndInit(); // ← remplace l'appel direct à chargerCredits()
  setInterval(chargerCredits, 30_000);
});
