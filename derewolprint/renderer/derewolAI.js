// derewolAI.js — Interface pour Derewol AI
const bridge =
  window.parent?.derewol || window.derewol || window.electron || {};

function invokeChannel(channel, ...args) {
  if (typeof bridge.invoke === "function") {
    return bridge.invoke(channel, ...args);
  }
  throw new Error("Bridge IPC non disponible");
}

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
    console.warn(
      "Impossible d'observer le thème parent, fallback polling",
      err,
    );
    setInterval(applyThemeMode, 1000);
  }
}

// ── Variables globales ──────────────────────────────────────────
let currentPrinterId = null;
let lastAnalyzedFilePath = null;
let lastSuggestions = null;

// ── Obtenir l'ID du printer actuel ──────────────────────────────
async function getPrinterId() {
  try {
    const config = await invokeChannel("printer:config");
    if (!config || !config.id) {
      throw new Error(
        "Configuration imprimeur manquante. Veuillez redémarrer l'application et compléter le setup.",
      );
    }
    return config.id;
  } catch (err) {
    console.error("Erreur obtention printerId:", err);
    // Afficher un message d'erreur à l'utilisateur au lieu d'un fallback
    alert(
      "Erreur : Configuration imprimeur introuvable. Redémarrez l'application.",
    );
    throw err; // Empêche l'exécution des fonctions suivantes
  }
}

// ── Charger et afficher les crédits ─────────────────────────────
async function chargerCredits() {
  try {
    if (!currentPrinterId) currentPrinterId = await getPrinterId();

    const response = await invokeChannel("ai:checkCredits", {
      printerId: currentPrinterId,
    });
    if (response.success) {
      const { remaining, purchased } = response.data;
      document.getElementById("credits-display").textContent =
        `${remaining} crédits ce mois · ${purchased} achetés`;

      // Afficher/cacher la section recharge
      const rechargeSection = document.getElementById("recharge-section");
      if (remaining + purchased === 0) {
        rechargeSection.classList.remove("hidden");
      } else {
        rechargeSection.classList.add("hidden");
      }
    } else {
      document.getElementById("credits-display").textContent =
        "Erreur chargement crédits";
    }
  } catch (err) {
    console.error("Erreur chargerCredits:", err);
    document.getElementById("credits-display").textContent =
      "Erreur chargement crédits";
  }
}

// ── Ouvrir un fichier et analyser ────────────────────────────────
async function ouvrirFichier(type) {
  try {
    if (!currentPrinterId) currentPrinterId = await getPrinterId();

    // Déterminer les filtres selon le type
    let filters = [];
    if (type === "document") {
      filters = [
        { name: "Documents", extensions: ["pdf", "jpg", "jpeg", "png"] },
      ];
    } else if (type === "excel") {
      filters = [{ name: "Fichiers Excel", extensions: ["xlsx", "xls"] }];
    } else if (type === "ocr") {
      filters = [{ name: "Images", extensions: ["jpg", "jpeg", "png", "pdf"] }];
    }

    const result = await invokeChannel("dialog:openFile", { filters });

    if (result.canceled || result.filePaths.length === 0) return;

    const filePath = result.filePaths[0];

    // Désactiver les boutons pendant l'analyse
    document
      .querySelectorAll(".btn-secondary, .btn-primary")
      .forEach((btn) => (btn.disabled = true));

    // Appeler le handler approprié
    let handler = "";
    if (type === "document") handler = "ai:analyzeDocument";
    else if (type === "excel") handler = "ai:analyzeExcel";
    else if (type === "ocr") handler = "ai:ocrDocument";

    const response = await invokeChannel(handler, {
      filePath,
      printerId: currentPrinterId,
    });

    // Debug: afficher le contenu brut retourné par l'IA (Claude)
    try {
      console.log("[AI DEBUG] suggestions reçues:", response?.data ?? response);
    } catch (e) {
      /* ignore */
    }

    // Réactiver les boutons
    document
      .querySelectorAll(".btn-secondary, .btn-primary")
      .forEach((btn) => (btn.disabled = false));

    if (response.success) {
      await afficherResultats(response.data, filePath);
      // Recharger les crédits après analyse
      await chargerCredits();
    } else {
      alert("Erreur lors de l'analyse : " + response.error);
    }
  } catch (err) {
    console.error("Erreur ouvrirFichier:", err);
    document
      .querySelectorAll(".btn-secondary, .btn-primary")
      .forEach((btn) => (btn.disabled = false));
    alert("Erreur lors de l'ouverture du fichier");
  }
}

// ── Afficher les résultats de l'analyse ──────────────────────────
async function afficherResultats(data, filePath) {
  const resultsDiv = document.getElementById("results");
  resultsDiv.classList.remove("hidden");

  // Suggestions
  const suggestionsList = document.getElementById("suggestions-list");
  suggestionsList.innerHTML = "";
  if (data.suggestions && data.suggestions.length > 0) {
    data.suggestions.forEach((sugg) => {
      const li = document.createElement("li");
      li.textContent = sugg;
      suggestionsList.appendChild(li);
    });
  } else {
    suggestionsList.innerHTML = "<li>Aucune suggestion</li>";
  }

  // Warnings
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

  // Debug: montrer le JSON brut reçu
  try {
    console.log("[AI DEBUG] raw data:", data);
  } catch (e) {
    /* ignore */
  }

  // Normaliser / tenter parsing si l'IA a renvoyé du texte libre
  let finalData = data;
  if (typeof finalData === "string") {
    try {
      finalData = JSON.parse(finalData);
      console.log("[AI DEBUG] parsed JSON string:", finalData);
    } catch (e) {
      // reste en string, on utilisera le fallback textuel plus bas
    }
  }

  // Save last analyzed file + normalized suggestion fields for Apply action
  lastAnalyzedFilePath = filePath;
  lastSuggestions = {
    orientation: finalData.orientation || finalData.orient || null,
    scale:
      finalData.echelle_recommandee ||
      finalData.scale ||
      finalData.zoom ||
      null,
    margins: finalData.marges || finalData.margins || null,
    printArea:
      finalData.printArea ||
      finalData.print_area ||
      finalData.zone_impression ||
      null,
    fitToPages: finalData.fitToPages || finalData.fit_to_pages || false,
  };

  // Si champs manquants, tenter d'extraire depuis le texte des suggestions
  let suggestionsText = "";
  if (Array.isArray(finalData.suggestions))
    suggestionsText = finalData.suggestions.join(" ");
  else if (typeof finalData.suggestions === "string")
    suggestionsText = finalData.suggestions;
  else if (typeof finalData === "string") suggestionsText = finalData;

  if (
    !lastSuggestions.orientation ||
    !lastSuggestions.scale ||
    !lastSuggestions.margins ||
    !lastSuggestions.printArea
  ) {
    const fallback = parseFallbackFromText(suggestionsText);
    lastSuggestions.orientation =
      lastSuggestions.orientation || fallback.orientation || null;
    lastSuggestions.scale = lastSuggestions.scale || fallback.scale || null;
    lastSuggestions.margins =
      lastSuggestions.margins || fallback.margins || null;
    lastSuggestions.printArea =
      lastSuggestions.printArea || fallback.printArea || null;
    lastSuggestions.fitToPages =
      lastSuggestions.fitToPages || fallback.fitToPages || false;
  }

  // Afficher les détails (utilise finalData si disponible, sinon fallback)
  const uiOrientation =
    finalData.orientation ||
    finalData.orient ||
    lastSuggestions.orientation ||
    "-";
  const uiMode = finalData.mode || "-";
  const uiContentType = finalData.type_contenu || finalData.contentType || "-";
  const uiFormat = finalData.format_recommande || finalData.format || "-";

  document.getElementById("orientation").textContent = uiOrientation;
  document.getElementById("mode").textContent = uiMode;
  document.getElementById("content-type").textContent = uiContentType;
  document.getElementById("format").textContent = uiFormat;

  // Toggle visibility of Apply button when suggestions present
  const applyBtn = document.getElementById("btn-apply-suggestions");
  if (data.suggestions && data.suggestions.length > 0) {
    applyBtn.classList.remove("hidden");
  } else {
    applyBtn.classList.add("hidden");
  }

  // Apply suggestions flow
  // NOTE: `applySuggestionsHandler` and `applyModalHandlers` moved to top-level
  // Analyser l'orientation du document
  try {
    const orientationData = await invokeChannel("ai:analyzeOrientation", {
      filePath,
      printerId: currentPrinterId,
    });
    const od = orientationData?.data || orientationData;
    if (od?.rotation !== 0 && od?.rotation !== undefined) {
      const orientWarning = document.getElementById("orientation-warning");
      document.getElementById("rotation-angle").textContent = od.rotation;
      document.getElementById("rotation-reason").textContent =
        od.reason || "Rotation détectée";
      orientWarning.classList.remove("hidden");
    } else {
      document.getElementById("orientation-warning").classList.add("hidden");
    }
  } catch (err) {
    console.warn("Erreur analyzeOrientation:", err);
    document.getElementById("orientation-warning").classList.add("hidden");
  }
}

// ── Apply suggestions handler (global, used by DOMContentLoaded) ──
async function applySuggestionsHandler() {
  if (!lastAnalyzedFilePath || !lastSuggestions) {
    alert("Aucun fichier analysé à appliquer");
    return;
  }

  try {
    const payload = {
      filePath: lastAnalyzedFilePath,
      suggestions: lastSuggestions,
    };

    const res = await invokeChannel("ai:applySuggestions", payload);
    if (!res || !res.success) {
      alert("Erreur application suggestions: " + (res?.error || "inconnu"));
      return;
    }

    // Show modal with temp file path
    const modal = document.getElementById("apply-modal");
    const pathEl = document.getElementById("apply-modal-path");
    pathEl.textContent = res.tempFilePath;
    modal.classList.remove("hidden");
  } catch (err) {
    console.error("applySuggestionsHandler:", err);
    alert("Erreur lors de l'application des suggestions");
  }
}

// ── Modal button handlers (global) ─────────────────────────────
async function applyModalHandlers() {
  const modal = document.getElementById("apply-modal");
  const cancelBtn = document.getElementById("apply-cancel");
  const printNowBtn = document.getElementById("apply-print-now");

  if (cancelBtn)
    cancelBtn.addEventListener("click", async () => {
      const path = document.getElementById("apply-modal-path").textContent;
      if (path) await invokeChannel("file:deleteTemp", { tempFilePath: path });
      modal.classList.add("hidden");
    });

  if (printNowBtn)
    printNowBtn.addEventListener("click", async () => {
      const path = document.getElementById("apply-modal-path").textContent;
      if (!path) return alert("Fichier introuvable");
      const r = await invokeChannel("print:local", { tempFilePath: path });
      if (!r || !r.success)
        return alert("Erreur impression: " + (r?.error || "inconnu"));
      modal.classList.add("hidden");
    });
}

// ── Fallback parser: tente d'extraire des champs depuis du texte libre ──
function parseFallbackFromText(text) {
  if (!text) return {};
  const t = String(text).toLowerCase();
  const out = {};

  // orientation
  if (t.includes("paysage") || t.includes("landscape"))
    out.orientation = "landscape";
  else if (t.includes("portrait")) out.orientation = "portrait";

  // fitToPages
  if (t.includes("fit to") || t.includes("ajuster") || t.includes("ajust"))
    out.fitToPages = true;

  // scale / echelle: look for percentages
  const pct = t.match(/(\d{1,3})\s?%/);
  if (pct) out.scale = pct[1] + "%";

  // margins: look for mm/cm/in values
  const mm = t.match(/(\d+(?:[\.,]\d+)?)\s?(mm|cm|in|cm\.)/);
  if (mm) out.margins = mm[1] + mm[2];

  // printArea: keywords
  if (
    t.includes("entière page") ||
    t.includes("full page") ||
    t.includes("whole page")
  )
    out.printArea = "full";
  if (t.includes("zone centrale") || t.includes("center area"))
    out.printArea = "center";

  return out;
}

// ── Gestion de la recharge de crédits ───────────────────────────
async function rechargerCredits(credits, amountXof) {
  if (!currentPrinterId) currentPrinterId = await getPrinterId();

  const message = encodeURIComponent(
    `Bonjour, je souhaite recharger ${credits} crédits Derewol AI (${amountXof} XOF). Mon ID boutique : ${currentPrinterId}`,
  );
  const whatsappUrl = `https://wa.me/+221781220391?text=${message}`;

  await invokeChannel("shell:openExternal", { url: whatsappUrl });
}

// ── Événements ──────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  watchParentThemeChanges();

  // ── Écouter les mises à jour de crédits depuis le parent ──
  window.addEventListener("message", (e) => {
    if (e.data?.type === "ai-credits-updated") {
      console.log("[AI] Mise à jour crédits reçue du parent → rechargement");
      chargerCredits();
    }
  });

  await chargerCredits();

  // ✅ Polling crédits IA toutes les 30s (détection recharge admin)
  let aiCreditsPollingInterval = setInterval(async () => {
    try {
      await chargerCredits();
      console.log("[AI] Polling crédits IA — rafraîchi");
    } catch (e) {
      console.warn("[AI] Polling crédits IA — erreur:", e.message);
    }
  }, 30_000);

  // Nettoyage si la page est déchargée
  window.addEventListener("beforeunload", () => {
    clearInterval(aiCreditsPollingInterval);
  });

  // ── Écouter les mises à jour de crédits après activation d'abonnement ──
  if (window.derewol?.onAICreditsUpdated) {
    window.derewol.onAICreditsUpdated(() => {
      console.log(
        "[AI] Événement credits-updated reçu — rechargement des crédits",
      );
      chargerCredits();
    });
  }

  // Boutons d'analyse
  document
    .getElementById("btn-analyze-doc")
    .addEventListener("click", () => ouvrirFichier("document"));
  document
    .getElementById("btn-analyze-excel")
    .addEventListener("click", () => ouvrirFichier("excel"));
  document
    .getElementById("btn-ocr")
    .addEventListener("click", () => ouvrirFichier("ocr"));

  // Boutons de recharge
  document.querySelectorAll(".recharge-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const credits = parseInt(btn.dataset.credits);
      const amount = parseInt(btn.dataset.amount);
      rechargerCredits(credits, amount);
    });
  });

  // Toggle Derewol AI control (persisted in localStorage)
  try {
    const toggle = document.getElementById("toggle-derewol-ai");
    const stored = localStorage.getItem("derewol_ai_enabled");
    toggle.checked = stored === null ? true : stored === "1";
    toggle.addEventListener("change", () => {
      localStorage.setItem("derewol_ai_enabled", toggle.checked ? "1" : "0");
    });
  } catch (err) {
    console.warn("Toggle Derewol AI init failed", err);
  }

  // Apply suggestions button
  const applyBtn = document.getElementById("btn-apply-suggestions");
  applyBtn.addEventListener("click", applySuggestionsHandler);
  applyModalHandlers();
});
