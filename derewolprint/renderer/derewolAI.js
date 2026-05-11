// derewolAI.js — Interface pour Derewol AI
const bridge =
  window.parent?.derewol || window.derewol || window.electron || {};

function invokeChannel(channel, ...args) {
  if (typeof bridge.invoke === "function") {
    return bridge.invoke(channel, ...args);
  }
  throw new Error("Bridge IPC non disponible");
}

// ── Variables globales ──────────────────────────────────────────
let currentPrinterId = null;

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
    document.querySelectorAll(".btn").forEach((btn) => (btn.disabled = true));

    // Appeler le handler approprié
    let handler = "";
    if (type === "document") handler = "ai:analyzeDocument";
    else if (type === "excel") handler = "ai:analyzeExcel";
    else if (type === "ocr") handler = "ai:ocrDocument";

    const response = await invokeChannel(handler, {
      filePath,
      printerId: currentPrinterId,
    });

    // Réactiver les boutons
    document.querySelectorAll(".btn").forEach((btn) => (btn.disabled = false));

    if (response.success) {
      afficherResultats(response.data);
      // Recharger les crédits après analyse
      await chargerCredits();
    } else {
      alert("Erreur lors de l'analyse : " + response.error);
    }
  } catch (err) {
    console.error("Erreur ouvrirFichier:", err);
    document.querySelectorAll(".btn").forEach((btn) => (btn.disabled = false));
    alert("Erreur lors de l'ouverture du fichier");
  }
}

// ── Afficher les résultats de l'analyse ──────────────────────────
function afficherResultats(data) {
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

  // Détails
  document.getElementById("orientation").textContent = data.orientation || "-";
  document.getElementById("mode").textContent = data.mode || "-";
  document.getElementById("content-type").textContent =
    data.type_contenu || data.contentType || "-";
  document.getElementById("format").textContent = data.format_recommande || "-";
}

// ── Gestion de la recharge de crédits ───────────────────────────
async function rechargerCredits(credits, amountXof) {
  try {
    if (!currentPrinterId) currentPrinterId = await getPrinterId();

    // Ici, simuler le paiement ou appeler un service de paiement
    // Pour l'exemple, on appelle directement ai:addCredits
    const response = await invokeChannel("ai:addCredits", {
      printerId: currentPrinterId,
      credits: credits,
      amountXof: amountXof,
      paymentRef: "simulation-" + Date.now(),
    });

    if (response.success) {
      alert(`Recharge réussie : ${credits} crédits ajoutés`);
      await chargerCredits(); // Recharger l'affichage
    } else {
      alert("Erreur lors de la recharge : " + response.error);
    }
  } catch (err) {
    console.error("Erreur rechargerCredits:", err);
    alert("Erreur lors de la recharge");
  }
}

// ── Événements ──────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  await chargerCredits();

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
});
