/**
 * ocrModule.js — Derewol
 * OCR via Claude Vision : image/scan → texte → PDF propre
 * Branché sur le système de crédits IA Supabase
 *
 * Utilisé dans : Fusion Modal (renderer)
 * IPC exposés   : 'ocr:extract-text', 'ocr:check-credits'
 */

const fs   = require('fs');
const path = require('path');

const LOG_PREFIX = '[OCRModule]';

const CLAUDE_MODEL  = 'claude-sonnet-4-20250514';
const API_ENDPOINT  = 'https://api.anthropic.com/v1/messages';
const MAX_TOKENS    = 4096;   // OCR peut être long

// Coût en crédits par opération OCR
const OCR_CREDIT_COST = 1;

// ─── Types de contenu OCR détectés ───────────────────────────────────────────

const OCR_CONTENT_TYPES = {
  INVOICE:    'invoice',       // Facture
  RECEIPT:    'receipt',       // Ticket de caisse
  LETTER:     'letter',        // Lettre/Courrier
  TABLE:      'table',         // Tableau de données
  HANDWRITTEN:'handwritten',   // Manuscrit
  FORM:       'form',          // Formulaire
  GENERIC:    'generic',       // Autre
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Encode une image en base64
 * @param {string} filePath
 * @returns {{ data: string, mediaType: string }}
 */
function encodeImage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mediaTypeMap = {
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif':  'image/gif',
    '.pdf':  'application/pdf',
  };

  const mediaType = mediaTypeMap[ext];
  if (!mediaType) throw new Error(`Format non supporté : ${ext}`);

  const buffer = fs.readFileSync(filePath);
  return { data: buffer.toString('base64'), mediaType };
}

/**
 * Prompt système OCR
 * @param {string} language — 'fr'|'en'|'wo' (wolof)
 */
function buildOCRSystemPrompt(language = 'fr') {
  const langLabel = { fr: 'français', en: 'English', wo: 'wolof' }[language] ?? 'français';

  return `Tu es un moteur OCR professionnel de haute précision.
Extrait tout le texte visible dans l'image avec fidélité maximale.
Langue principale attendue : ${langLabel}.

Réponds UNIQUEMENT en JSON valide, sans markdown, sans preamble :
{
  "text": "texte extrait complet avec sauts de ligne \\n respectés",
  "contentType": "invoice|receipt|letter|table|handwritten|form|generic",
  "language": "fr|en|wo|other",
  "confidence": 0.0 à 1.0,
  "structuredData": null | {
    "headers": ["col1", "col2"],
    "rows": [["val1", "val2"]]
  },
  "warnings": []
}

Règles :
- Préserve l'ordre de lecture naturel
- Pour les tableaux, remplis structuredData
- Pour les formulaires, extrais les paires label:valeur dans le texte
- Si le texte est illisible en partie, indique [illisible] à la position exacte
- confidence = proportion du texte lisible avec certitude`;
}

// ─── API principale ───────────────────────────────────────────────────────────

/**
 * Extrait le texte d'une image via Claude Vision
 * @param {Object} params
 * @param {string} params.filePath         Chemin absolu de l'image/scan/PDF
 * @param {string} params.anthropicApiKey  Clé Anthropic déchiffrée
 * @param {string} [params.language]       'fr'|'en'|'wo'
 * @param {string} [params.userId]         ID utilisateur (pour crédits Supabase)
 * @param {Function} [params.onCreditDeduct]  Callback async pour déduire crédits
 * @returns {Promise<{
 *   text: string,
 *   contentType: string,
 *   language: string,
 *   confidence: number,
 *   structuredData: object|null,
 *   warnings: string[],
 *   creditsUsed: number,
 *   fileName: string
 * }>}
 */
async function extractTextFromImage({
  filePath,
  anthropicApiKey,
  language       = 'fr',
  userId         = null,
  onCreditDeduct = null,
}) {
  console.log(`${LOG_PREFIX} extractTextFromImage("${filePath}", lang=${language})`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Fichier introuvable : ${filePath}`);
  }
  if (!anthropicApiKey) {
    throw new Error('Clé API Anthropic manquante');
  }

  const fileName = path.basename(filePath);

  // Encoder l'image
  let encoded;
  try {
    encoded = encodeImage(filePath);
  } catch (encErr) {
    throw new Error(`Encodage image impossible : ${encErr.message}`);
  }

  const requestBody = {
    model:      CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    system:     buildOCRSystemPrompt(language),
    messages:   [{
      role:    'user',
      content: [
        {
          type:   'image',
          source: {
            type:       'base64',
            media_type: encoded.mediaType,
            data:       encoded.data,
          },
        },
        {
          type: 'text',
          text: `Extrait tout le texte de cette image. Fichier : "${fileName}"`,
        },
      ],
    }],
  };

  console.log(`${LOG_PREFIX} Appel API Claude Vision…`);

  let response;
  try {
    response = await fetch(API_ENDPOINT, {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody),
    });
  } catch (fetchErr) {
    throw new Error(`Connexion API impossible : ${fetchErr.message}`);
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`API Claude ${response.status} : ${errText}`);
  }

  const apiData = await response.json();
  const rawText = (apiData.content ?? [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  console.log(`${LOG_PREFIX} Réponse OCR brute (${rawText.length} chars) :`, rawText.slice(0, 200));

  // Parse JSON
  const clean = rawText.replace(/```json|```/g, '').trim();
  let ocrResult;
  try {
    ocrResult = JSON.parse(clean);
  } catch (parseErr) {
    console.error(`${LOG_PREFIX} JSON parse échoué, retour texte brut`);
    ocrResult = {
      text:           rawText,
      contentType:    OCR_CONTENT_TYPES.GENERIC,
      language:       language,
      confidence:     0.5,
      structuredData: null,
      warnings:       ['Résultat JSON malformé, texte brut retourné'],
    };
  }

  // Déduire les crédits APRÈS succès API
  let creditsUsed = 0;
  if (onCreditDeduct && userId) {
    try {
      await onCreditDeduct(userId, OCR_CREDIT_COST);
      creditsUsed = OCR_CREDIT_COST;
      console.log(`${LOG_PREFIX} ${OCR_CREDIT_COST} crédit(s) déduit(s) pour userId=${userId}`);
    } catch (creditErr) {
      console.error(`${LOG_PREFIX} Déduction crédits échouée :`, creditErr.message);
      ocrResult.warnings = ocrResult.warnings ?? [];
      ocrResult.warnings.push('Déduction de crédit échouée — vérifiez votre solde');
    }
  }

  console.log(`${LOG_PREFIX} ✅ OCR terminé → contentType=${ocrResult.contentType} confidence=${ocrResult.confidence}`);

  return {
    text:           ocrResult.text          ?? '',
    contentType:    ocrResult.contentType   ?? OCR_CONTENT_TYPES.GENERIC,
    language:       ocrResult.language      ?? language,
    confidence:     ocrResult.confidence    ?? 0,
    structuredData: ocrResult.structuredData ?? null,
    warnings:       ocrResult.warnings      ?? [],
    creditsUsed,
    fileName,
  };
}

/**
 * Vérifie le solde de crédits IA d'un utilisateur via Supabase
 * @param {object} supabase  — client Supabase initialisé
 * @param {string} userId
 * @returns {Promise<{ credits: number, canUseOCR: boolean }>}
 */
async function checkOCRCredits(supabase, userId) {
  if (!supabase || !userId) {
    return { credits: 0, canUseOCR: false };
  }

  try {
    const { data, error } = await supabase
      .from('ai_credits')
      .select('balance')
      .eq('user_id', userId)
      .single();

    if (error) throw error;

    const credits = data?.balance ?? 0;
    console.log(`${LOG_PREFIX} Crédits IA userId=${userId} : ${credits}`);

    return { credits, canUseOCR: credits >= OCR_CREDIT_COST };
  } catch (err) {
    console.error(`${LOG_PREFIX} checkOCRCredits échoué :`, err.message);
    return { credits: 0, canUseOCR: false };
  }
}

/**
 * Déduit les crédits IA via Supabase (à passer comme onCreditDeduct)
 * @param {object} supabase
 * @returns {Function} async (userId, amount) => void
 */
function makeSupabaseCreditDeductor(supabase) {
  return async (userId, amount) => {
    const { error } = await supabase.rpc('deduct_ai_credits', {
      p_user_id: userId,
      p_amount:  amount,
    });
    if (error) throw error;
  };
}

module.exports = {
  extractTextFromImage,
  checkOCRCredits,
  makeSupabaseCreditDeductor,
  OCR_CREDIT_COST,
  OCR_CONTENT_TYPES,
};
