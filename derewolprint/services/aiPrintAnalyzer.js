// ═══════════════════════════════════════════════════════════════
// DEREWOL AI — services/aiPrintAnalyzer.js
// Propulsé par Claude (Anthropic) — "AI powered by Claude"
// ═══════════════════════════════════════════════════════════════

const fs = require("fs");
const path = require("path");
const os = require("os");
const PDFDocument = require("pdfkit");
const { app } = require("electron");
const { createClient } = require("@supabase/supabase-js");

// ── Config ──────────────────────────────────────────────────────
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 1000;

// Coût approximatif par action (pour les logs)
const COST_PER_ACTION = {
  analyze_document: { tokens: 2000, usd: 0.03, xof: 18 },
  analyze_excel: { tokens: 3000, usd: 0.05, xof: 30 },
  ocr_document: { tokens: 2500, usd: 0.04, xof: 24 },
  improve_ocr_text: { tokens: 2800, usd: 0.05, xof: 30 },
};

// ── Clé API ─────────────────────────────────────────────────────
function getAnthropicKey() {
  // 1. Variables d'environnement (dev via .env)
  if (process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY;
  }

  // 2. config.json local (production packagée) — même logique que supabase.js
  try {
    const isPackaged = (() => {
      try {
        const { app } = require("electron");
        return app && app.isPackaged;
      } catch {
        return false;
      }
    })();

    const cfgPath = isPackaged
      ? path.join(process.resourcesPath, "config.json")
      : path.join(__dirname, "../config.json");

    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      if (cfg.anthropicApiKey) {
        console.warn("[DEREWOL AI] Clé Anthropic lue depuis config.json");
        return cfg.anthropicApiKey;
      }
    }
  } catch (e) {
    console.error("[DEREWOL AI] Erreur lecture config.json:", e.message);
  }

  // 3. Fallback variable d'environnement de production
  const fallbackKey = process.env.ANTHROPIC_API_KEY_PROD || "";
  if (fallbackKey) {
    console.warn("[DEREWOL AI] Utilisation de la clé Anthropic embarquée");
    return fallbackKey;
  }

  throw new Error(
    "ANTHROPIC_API_KEY manquante — configurez .env, config.json (anthropicApiKey) ou process.env.ANTHROPIC_API_KEY_PROD",
  );
}

// ── Supabase ─────────────────────────────────────────────────────
function getSupabase() {
  // 1. Variables d'environnement (dev)
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
  }

  // 2. Sans variables d'environnement : échec explicite plutôt qu'un secret
  // service_role embarqué en dur (ce code fait partie de l'app Electron
  // distribuée aux clients — jamais de clé admin dans un build packagé).
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error(
      "[DEREWOL AI] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquantes — Derewol AI ne pourra pas fonctionner sans ces variables d'environnement.",
    );
    return null;
  }
  return createClient(supabaseUrl, supabaseServiceKey);
}

// ═══════════════════════════════════════════════════════════════
// SYSTÈME DE CRÉDITS
// ═══════════════════════════════════════════════════════════════

/**
 * Vérifie si le printer a des crédits disponibles
 * @returns {Object} { hasCredits, remaining, purchased, total }
 */
async function getAICreditsCachePath() {
  const userDataPath = app.getPath("userData");
  return path.join(userDataPath, "ai-credits-cache.json");
}

function saveAICreditsCache(cacheData) {
  try {
    const cachePath = path.join(
      app.getPath("userData"),
      "ai-credits-cache.json",
    );
    fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2), "utf8");
    console.log("[DEREWOL AI] Cache crédits IA sauvegardé :", cachePath);
  } catch (cacheErr) {
    console.warn(
      "[DEREWOL AI] Impossible de sauvegarder le cache crédits IA:",
      cacheErr.message,
    );
  }
}

function loadAICreditsCache() {
  try {
    const cachePath = path.join(
      app.getPath("userData"),
      "ai-credits-cache.json",
    );
    if (!fs.existsSync(cachePath)) return null;
    const raw = fs.readFileSync(cachePath, "utf8");
    return JSON.parse(raw);
  } catch (cacheErr) {
    console.warn(
      "[DEREWOL AI] Impossible de lire le cache crédits IA:",
      cacheErr.message,
    );
    return null;
  }
}

async function checkAICredits(printerId) {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("subscriptions")
      .select("ai_credits_remaining, ai_credits_purchased")
      .eq("printer_id", printerId)
      .eq("status", "active")
      .single();

    if (error || !data) {
      throw error || new Error("Aucune donnée de crédits IA");
    }

    const remaining = data.ai_credits_remaining ?? 0;
    const purchased = data.ai_credits_purchased ?? 0;
    const total = remaining + purchased;
    const cachePayload = {
      remaining,
      purchased,
      cachedAt: new Date().toISOString(),
    };
    saveAICreditsCache(cachePayload);

    console.log("[AI CREDITS CHECK]", {
      remaining,
      purchased,
      total,
      hasCredits: total > 0,
    });

    return {
      hasCredits: total > 0,
      remaining,
      purchased,
      total,
      offline: false,
      cachedAt: cachePayload.cachedAt,
    };
  } catch (err) {
    console.error("[DEREWOL AI] Erreur checkAICredits:", err.message);
    const cache = loadAICreditsCache();
    if (cache) {
      const remaining = cache.remaining ?? 0;
      const purchased = cache.purchased ?? 0;
      const total = remaining + purchased;

      console.log("[AI CREDITS CHECK]", {
        remaining,
        purchased,
        total,
        hasCredits: total > 0,
      });

      return {
        hasCredits: total > 0,
        remaining,
        purchased,
        total,
        offline: true,
        cachedAt: cache.cachedAt,
      };
    }
    return {
      hasCredits: false,
      remaining: 0,
      purchased: 0,
      total: 0,
      offline: true,
    };
  }
}

/**
 * Consomme 1 crédit via la fonction Supabase
 * @returns {Object} { success, source, reason }
 */
async function consumeAICredit(printerId) {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc("consume_ai_credit", {
      p_printer_id: printerId,
    });

    if (error) throw error;
    return data; // { success, source, reason, remaining_after, purchased_after }
  } catch (err) {
    console.error("[DEREWOL AI] Erreur consumeAICredit:", err.message);
    return { success: false, reason: "db_error" };
  }
}

/**
 * Ajoute des crédits achetés (recharge client)
 * @returns {Object} { success, credits_added, new_purchased_total }
 */
async function addAICredits(printerId, credits, amountXof, paymentRef = null) {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc("add_ai_credits", {
      p_printer_id: printerId,
      p_credits: credits,
      p_amount_xof: amountXof,
      p_payment_ref: paymentRef,
    });

    if (error) throw error;
    return data;
  } catch (err) {
    console.error("[DEREWOL AI] Erreur addAICredits:", err.message);
    return { success: false };
  }
}

/**
 * Enregistre l'usage dans ai_usage_logs
 */
async function logAIUsage(
  printerId,
  action,
  fileName,
  creditSource,
  status = "success",
  errorMsg = null,
) {
  try {
    const supabase = getSupabase();
    const cost = COST_PER_ACTION[action] || { tokens: 0, usd: 0, xof: 0 };

    await supabase.from("ai_usage_logs").insert({
      printer_id: printerId,
      action,
      file_name: fileName,
      tokens_used: cost.tokens,
      cost_usd: cost.usd,
      cost_xof: cost.xof,
      credit_source: creditSource,
      status,
      error_message: errorMsg,
    });
  } catch (err) {
    console.error("[DEREWOL AI] Erreur logAIUsage:", err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// APPEL API ANTHROPIC
// ═══════════════════════════════════════════════════════════════

async function callClaude(
  prompt,
  imageBase64 = null,
  mediaType = "image/jpeg",
) {
  const key = getAnthropicKey();

  // Construction du message
  // ⚠️ Les PDF doivent être envoyés dans un bloc "document", pas "image"
  // (l'API Anthropic rejette media_type "application/pdf" sur une source image → 400).
  const userContent = imageBase64
    ? [
        mediaType === "application/pdf"
          ? {
              type: "document",
              source: {
                type: "base64",
                media_type: mediaType,
                data: imageBase64,
              },
            }
          : {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: imageBase64,
              },
            },
        { type: "text", text: prompt },
      ]
    : prompt;

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: `Tu es Derewol AI, l'assistant IA intégré à l'application Derewol pour les boutiques d'impression au Sénégal.
Tu analyses les documents avant impression et tu donnes des conseils pratiques.
Réponds TOUJOURS en français.
Réponds UNIQUEMENT en JSON valide, sans balises markdown, sans texte avant ou après.`,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const text = data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  // Nettoyer les éventuels ```json ... ```
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// ═══════════════════════════════════════════════════════════════
// FONCTION 1 : analyzeDocument
// PDF ou image → suggestions d'impression complètes
// ═══════════════════════════════════════════════════════════════

/**
 * Analyse un document avant impression
 * @param {string} filePath  - Chemin local du fichier (PDF ou image)
 * @param {string} printerId - UUID de l'imprimante dans Supabase
 * @returns {Object} { suggestions, warnings, mode, orientation, contentType, credits }
 */
async function analyzeDocument(filePath, printerId) {
  const FALLBACK = {
    suggestions: [],
    warnings: [],
    mode: "noir_blanc",
    orientation: "portrait",
    contentType: "document",
    error: "Analyse IA indisponible",
    credits: null,
  };

  try {
    // 1. Vérifier les crédits
    const creditCheck = await checkAICredits(printerId);
    if (!creditCheck.hasCredits) {
      return {
        ...FALLBACK,
        error: "credits_epuises",
        creditsRestants: 0,
        showRecharge: true,
      };
    }

    // 2. Lire le fichier
    if (!fs.existsSync(filePath))
      throw new Error(`Fichier introuvable: ${filePath}`);
    const fileBuffer = fs.readFileSync(filePath);
    const base64Data = fileBuffer.toString("base64");
    const ext = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath);

    // Déterminer le mediaType
    const mediaType =
      ext === ".png"
        ? "image/png"
        : ext === ".pdf"
          ? "application/pdf"
          : "image/jpeg";

    // 3. Prompt d'analyse complet
    const prompt = `Analyse ce document pour impression et retourne un JSON avec exactement cette structure :
{
  "orientation": "portrait" ou "paysage",
  "correction_orientation": true ou false,
  "mode": "noir_blanc" ou "couleur" ou "economie",
  "couleurs_inutiles": true ou false,
  "type_contenu": "document" ou "photo" ou "tableau" ou "formulaire" ou "cni",
  "marges": "description courte des marges",
  "colonnes": "ok" ou description du problème détecté,
  "fautes_detectees": ["liste des problèmes visuels détectés"],
  "suggestions": ["suggestion 1", "suggestion 2", "suggestion 3"],
  "warnings": ["warning 1 si critique"],
  "economie_encre": true ou false,
  "format_recommande": "A4" ou "A5" ou "autre"
}`;

    // 4. Appel Claude
    const result = await callClaude(prompt, base64Data, mediaType);

    // 5. Consommer le crédit
    const creditConsume = await consumeAICredit(printerId);

    // 6. Logger
    await logAIUsage(
      printerId,
      "analyze_document",
      fileName,
      creditConsume.source,
    );

    return {
      ...result,
      credits: {
        source: creditConsume.source,
        remainingMonthly: creditConsume.remaining_after,
        remainingPurchased: creditConsume.purchased_after,
      },
    };
  } catch (err) {
    console.error("[DEREWOL AI] analyzeDocument error:", err.message);
    await logAIUsage(
      printerId,
      "analyze_document",
      path.basename(filePath),
      null,
      "error",
      err.message,
    );
    return FALLBACK;
  }
}

// ═══════════════════════════════════════════════════════════════
// FONCTION 2 : analyzeExcel
// Fichier Excel → détection problèmes + macro VBA correctrice
// ═══════════════════════════════════════════════════════════════

/**
 * Analyse un fichier Excel avant impression
 * @param {string} filePath  - Chemin local du fichier .xlsx ou .xls
 * @param {string} printerId - UUID de l'imprimante
 * @returns {Object} { issues, macroSuggestion, credits }
 */
async function analyzeExcel(filePath, printerId) {
  const FALLBACK = {
    issues: [],
    macroSuggestion: null,
    error: "Analyse IA indisponible",
    credits: null,
  };

  try {
    // 1. Vérifier les crédits
    const creditCheck = await checkAICredits(printerId);
    if (!creditCheck.hasCredits) {
      return { ...FALLBACK, error: "credits_epuises", showRecharge: true };
    }

    const fileName = path.basename(filePath);

    // 2. Pour Excel, on passe le nom + demande des conseils généraux
    // (Excel binaire ne peut pas être lu directement par vision)
    // Le renderer devra passer un screenshot ou une image de l'aperçu
    const prompt = `Tu es un expert en mise en page Excel pour impression.
Un utilisateur veut imprimer un fichier Excel nommé "${fileName}".
Analyse les problèmes les plus probables liés à l'impression : colonnes trop larges, titres de colonnes, lignes répétées, orientations, marges, zones de tableau, et échelle.
Retourne uniquement du JSON valide sans texte de présentation.
{
  "issues": ["problème 1", "problème 2"],
  "warnings": ["warning 1", "warning 2"],
  "suggestions": ["suggestion 1", "suggestion 2"],
  "orientation_recommandee": "portrait" ou "paysage",
  "format_recommande": "A4" ou "Lettres",
  "echelle_recommandee": 90
}`;

    // 3. Appel Claude (sans image pour Excel)
    const result = await callClaude(prompt);

    // 4. Consommer le crédit
    const creditConsume = await consumeAICredit(printerId);

    // 5. Logger
    await logAIUsage(
      printerId,
      "analyze_excel",
      fileName,
      creditConsume.source,
    );

    return {
      ...result,
      credits: {
        source: creditConsume.source,
        remainingMonthly: creditConsume.remaining_after,
        remainingPurchased: creditConsume.purchased_after,
      },
    };
  } catch (err) {
    console.error("[DEREWOL AI] analyzeExcel error:", err.message);
    await logAIUsage(
      printerId,
      "analyze_excel",
      path.basename(filePath),
      null,
      "error",
      err.message,
    );
    return FALLBACK;
  }
}

// ═══════════════════════════════════════════════════════════════
// FONCTION 3 : ocrDocument
// Image ou scan → texte extrait → prêt pour PDF propre
// ═══════════════════════════════════════════════════════════════

/**
 * OCR d'une image ou d'un scan
 * @param {string} filePath  - Chemin local de l'image (jpg, png, pdf scanné)
 * @param {string} printerId - UUID de l'imprimante
 * @returns {Object} { text, confidence, language, credits }
 */
async function ocrDocument(filePath, printerId) {
  const FALLBACK = {
    text: "",
    confidence: 0,
    language: "fr",
    error: "OCR IA indisponible",
    credits: null,
  };

  try {
    // 1. Vérifier les crédits
    const creditCheck = await checkAICredits(printerId);
    if (!creditCheck.hasCredits) {
      return { ...FALLBACK, error: "credits_epuises", showRecharge: true };
    }

    // 2. Lire le fichier image
    if (!fs.existsSync(filePath))
      throw new Error(`Fichier introuvable: ${filePath}`);
    const fileBuffer = fs.readFileSync(filePath);
    const base64Data = fileBuffer.toString("base64");
    const ext = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath);
    const mediaType = ext === ".png" ? "image/png" : "image/jpeg";

    // 3. Prompt OCR
    const prompt = `Effectue une reconnaissance de texte (OCR) complète sur cette image.
Détecte également le type de document parmi : CV, Lettre administrative, Ordonnance, Devis, Tableau, Autre.
Retourne uniquement un JSON valide sans texte additionnel.
{
  "text": "texte complet extrait, avec sauts de ligne \n là où il y en a",
  "confidence": 95,
  "language": "fr" ou "ar" ou "wo" ou "en",
  "docType": "CV" ou "Lettre administrative" ou "Ordonnance" ou "Devis" ou "Tableau" ou "Autre",
  "blocks": [
    { "type": "titre" ou "paragraphe" ou "tableau" ou "liste", "content": "..." }
  ],
  "qualite_image": "bonne" ou "moyenne" ou "mauvaise",
  "suggestions": ["amélioration 1 si nécessaire"]
}`;

    // 4. Appel Claude Vision
    const result = await callClaude(prompt, base64Data, mediaType);

    // 5. Consommer le crédit
    const creditConsume = await consumeAICredit(printerId);

    // 6. Logger
    await logAIUsage(printerId, "ocr_document", fileName, creditConsume.source);

    return {
      ...result,
      credits: {
        source: creditConsume.source,
        remainingMonthly: creditConsume.remaining_after,
        remainingPurchased: creditConsume.purchased_after,
      },
    };
  } catch (err) {
    console.error("[DEREWOL AI] ocrDocument error:", err.message);
    await logAIUsage(
      printerId,
      "ocr_document",
      path.basename(filePath),
      null,
      "error",
      err.message,
    );
    return FALLBACK;
  }
}

async function improveOcrText(text, docType, improvements = [], printerId) {
  const FALLBACK = {
    improvedText: text || "",
    tempFilePath: null,
    error: "Amélioration OCR indisponible",
    credits: null,
  };

  try {
    const creditCheck = await checkAICredits(printerId);
    if (!creditCheck.hasCredits) {
      return { ...FALLBACK, error: "credits_epuises", showRecharge: true };
    }

    const improvementList = improvements.length
      ? improvements.map((item) => `- ${item}`).join("\n")
      : "- Nettoyer le texte\n- Corriger l'orthographe\n- Améliorer le style et la mise en page";

    const prompt = `Tu es un assistant expert en édition de documents.
Le texte suivant provient d'un document OCR de type : ${docType || "Autre"}.
Améliore le texte en appliquant les corrections suivantes :\n${improvementList}
Retourne uniquement un JSON valide sans aucune préface.
{
  "improvedText": "texte amélioré ..."
}`;

    const result = await callClaude(prompt);
    const improvedText = result.improvedText || text;
    const tempFilePath = path.join(os.tmpdir(), `dw-ai-${Date.now()}.pdf`);
    const pdfDoc = new PDFDocument({ size: "A4", margin: 40 });
    const writeStream = fs.createWriteStream(tempFilePath);
    pdfDoc.pipe(writeStream);
    pdfDoc
      .fontSize(16)
      .text(`${docType || "Document"} amélioré`, { align: "center" });
    pdfDoc.moveDown(1);
    pdfDoc.fontSize(11).text(improvedText, { align: "left", lineGap: 4 });
    pdfDoc.end();

    await new Promise((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    const creditConsume = await consumeAICredit(printerId);
    await logAIUsage(
      printerId,
      "improve_ocr_text",
      "ocr_text.pdf",
      creditConsume.source,
    );

    return {
      improvedText,
      tempFilePath,
      credits: {
        source: creditConsume.source,
        remainingMonthly: creditConsume.remaining_after,
        remainingPurchased: creditConsume.purchased_after,
      },
    };
  } catch (err) {
    console.error("[DEREWOL AI] improveOcrText error:", err.message);
    await logAIUsage(
      printerId,
      "improve_ocr_text",
      "ocr_text.pdf",
      null,
      "error",
      err.message,
    );
    return FALLBACK;
  }
}

// ═══════════════════════════════════════════════════════════════
// FONCTION 4 : analyzeOrientation
// PDF ou image → détection de rotation (0/90/180/270) via Claude Vision
// ═══════════════════════════════════════════════════════════════

/**
 * Détecte si un document est mal orienté avant impression.
 * @param {string} filePath  - Chemin local du fichier (PDF ou image)
 * @param {string} printerId - UUID de l'imprimante
 * @returns {Object} { rotation: 0|90|180|270, confidence, reason, credits }
 */
async function analyzeOrientation(filePath, printerId) {
  const FALLBACK = {
    rotation: 0,
    confidence: "faible",
    reason: "Analyse d'orientation indisponible",
    error: "orientation_unavailable",
    credits: null,
  };

  try {
    // 1. Vérifier les crédits
    const creditCheck = await checkAICredits(printerId);
    if (!creditCheck.hasCredits) {
      return { ...FALLBACK, error: "credits_epuises", showRecharge: true };
    }

    // 2. Lire le fichier → base64
    if (!fs.existsSync(filePath))
      throw new Error(`Fichier introuvable: ${filePath}`);
    const base64Data = fs.readFileSync(filePath).toString("base64");
    const ext = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath);
    const mediaType =
      ext === ".png"
        ? "image/png"
        : ext === ".pdf"
          ? "application/pdf"
          : "image/jpeg";

    // 3. Prompt orientation
    const prompt = `Tu es un expert en préparation de documents pour l'impression.
Observe l'orientation du contenu (texte, images, tableaux) de ce document.
Détermine de combien de degrés il faut le faire pivoter dans le sens horaire pour qu'il soit lu correctement (bien droit).
- 0 = déjà bien orienté
- 90 / 180 / 270 = mal orienté, rotation nécessaire
Retourne UNIQUEMENT ce JSON :
{
  "rotation": 0 ou 90 ou 180 ou 270,
  "confidence": "élevée" ou "moyenne" ou "faible",
  "reason": "explication courte en français"
}`;

    // 4. Appel Claude Vision
    const result = await callClaude(prompt, base64Data, mediaType);

    // 5. Consommer le crédit
    const creditConsume = await consumeAICredit(printerId);

    // 6. Logger
    await logAIUsage(
      printerId,
      "analyze_document",
      fileName,
      creditConsume.source,
    );

    // Normaliser la rotation à une valeur autorisée
    const allowed = [0, 90, 180, 270];
    const rotation = allowed.includes(Number(result.rotation))
      ? Number(result.rotation)
      : 0;

    return {
      rotation,
      confidence: result.confidence || "moyenne",
      reason: result.reason || "",
      credits: {
        source: creditConsume.source,
        remainingMonthly: creditConsume.remaining_after,
        remainingPurchased: creditConsume.purchased_after,
      },
    };
  } catch (err) {
    console.error("[DEREWOL AI] analyzeOrientation error:", err.message);
    await logAIUsage(
      printerId,
      "analyze_document",
      path.basename(filePath),
      null,
      "error",
      err.message,
    );
    return FALLBACK;
  }
}

// ═══════════════════════════════════════════════════════════════
// FONCTION 5 : analyzeJobOrientation
// Rasterise page 1 d'un PDF et analyse rapidement la rotation
// ═══════════════════════════════════════════════════════════════

/**
 * Analyse rapide d'orientation pour un job arrivant
 * Rasterise UNIQUEMENT la page 1 en image et envoie à Claude Vision
 * @param {string} filePath  - Chemin local du fichier PDF
 * @param {string} printerId - UUID de l'imprimante
 * @returns {Object} { rotation: 0|90|180|270, needsWarning: boolean }
 */
async function analyzeJobOrientation(filePath, printerId) {
  const FALLBACK = {
    rotation: 0,
    needsWarning: false,
  };

  try {
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== ".pdf") {
      return FALLBACK;
    }

    if (!fs.existsSync(filePath)) {
      throw new Error(`Fichier introuvable: ${filePath}`);
    }

    // Lire /Rotate directement dans le binaire PDF ? zero dependance
    const pdfBytes = fs.readFileSync(filePath, "utf8");
    const match = pdfBytes.match(/\/Rotate\s+(\d+)/);
    const rotation = match
      ? [0, 90, 180, 270].includes(Number(match[1]))
        ? Number(match[1])
        : 0
      : 0;
    console.log("[AI] orientation metadata PDF:", rotation, "deg");
    return { rotation, needsWarning: rotation !== 0 };
  } catch (err) {
    console.error("[DEREWOL AI] analyzeJobOrientation error:", err.message);
    return FALLBACK;
  }
}

// ???????????????????????????????????????????????????????????????
// EXPORTS
// ???????????????????????????????????????????????????????????????

module.exports = {
  analyzeDocument,
  analyzeExcel,
  ocrDocument,
  improveOcrText,
  analyzeOrientation,
  analyzeJobOrientation,
  checkAICredits,
  consumeAICredit,
  addAICredits,
  logAIUsage,
};
