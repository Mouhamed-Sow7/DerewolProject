/**
 * aiPrintAnalyzer.js — Derewol
 * Analyse un document avant impression via Claude Vision (Anthropic API)
 * Suggestions : couleur/NB, orientation, formatage, fautes, Excel VBA
 *
 * Utilisé dans : main/main.js via IPC 'ai:analyze-document'
 * Dépendances   : fs, path, Anthropic API key (chiffrée AES dans projet)
 */

const fs   = require('fs');
const path = require('path');

const LOG_PREFIX = '[AIPrintAnalyzer]';

// ─── Constantes ───────────────────────────────────────────────────────────────

const CLAUDE_MODEL   = 'claude-sonnet-4-20250514';  // Vision + texte
const MAX_TOKENS     = 1024;
const API_ENDPOINT   = 'https://api.anthropic.com/v1/messages';

// Taille max image encodée base64 (~4MB décodé = ~5.3MB base64)
const MAX_IMAGE_B64_BYTES = 5 * 1024 * 1024;

// Extensions supportées pour l'analyse visuelle
const IMAGE_EXTS  = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const PDF_EXT     = '.pdf';
const EXCEL_EXTS  = new Set(['.xlsx', '.xls', '.xlsm']);
const TEXT_EXTS   = new Set(['.txt', '.csv', '.md']);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Détecte le type de document
 * @param {string} filePath
 * @returns {'image'|'pdf'|'excel'|'text'|'unknown'}
 */
function detectDocumentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTS.has(ext))  return 'image';
  if (ext === PDF_EXT)       return 'pdf';
  if (EXCEL_EXTS.has(ext))  return 'excel';
  if (TEXT_EXTS.has(ext))   return 'text';
  return 'unknown';
}

/**
 * Encode un fichier en base64 avec vérification de taille
 * @param {string} filePath
 * @returns {{ data: string, mediaType: string }|null}
 */
function encodeFileBase64(filePath) {
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
  if (!mediaType) return null;

  const buffer = fs.readFileSync(filePath);
  if (buffer.length > MAX_IMAGE_B64_BYTES) {
    console.warn(`${LOG_PREFIX} Fichier trop grand (${buffer.length} bytes), analyse texte uniquement`);
    return null;
  }

  return {
    data:      buffer.toString('base64'),
    mediaType,
  };
}

/**
 * Construit le prompt système selon le type de document
 * @param {'image'|'pdf'|'excel'|'text'|'unknown'} docType
 * @param {string} fileName
 * @returns {string}
 */
function buildSystemPrompt(docType, fileName) {
  const base = `Tu es un assistant d'impression professionnel pour l'application Derewol.
Analyse le document "${fileName}" et fournis des recommandations d'impression concrètes.
Réponds UNIQUEMENT en JSON valide, sans markdown, sans preamble, sans backticks.`;

  const schema = `{
  "colorMode": "color" | "grayscale",
  "orientation": "portrait" | "landscape",
  "contentType": string,
  "issues": string[],
  "suggestions": string[],
  "macroVBA": string | null,
  "confidence": number
}`;

  const rules = {
    image:   'Analyse la qualité visuelle, détecte si NB suffit, vérifie l\'orientation optimale.',
    pdf:     'Vérifie la mise en page, colonnes, marges, densité de texte, graphiques couleur.',
    excel:   'Identifie les problèmes de formatage, colonnes mal alignées, données tronquées. Si des corrections sont nécessaires, génère une macro VBA dans le champ macroVBA.',
    text:    'Vérifie la lisibilité, propose une mise en page propre.',
    unknown: 'Analyse générale et propose des options d\'impression prudentes.',
  };

  return `${base}\n\nContexte : ${rules[docType] ?? rules.unknown}\n\nSchéma de réponse :\n${schema}`;
}

/**
 * Construit le message utilisateur pour l'API
 * @param {string} filePath
 * @param {'image'|'pdf'|'excel'|'text'|'unknown'} docType
 * @returns {object[]} — tableau de content blocks
 */
function buildUserContent(filePath, docType) {
  const fileName = path.basename(filePath);
  const textBlock = {
    type: 'text',
    text: `Analyse ce document pour l'impression : "${fileName}".`,
  };

  // Pour image et PDF : inclure le visuel
  if (docType === 'image' || docType === 'pdf') {
    const encoded = encodeFileBase64(filePath);
    if (encoded) {
      const imageBlock = {
        type:   'image',
        source: {
          type:       'base64',
          media_type: encoded.mediaType,
          data:       encoded.data,
        },
      };
      return [imageBlock, textBlock];
    }
  }

  // Pour Excel : inclure métadonnées nom fichier (pas d'encodage binaire XLSX)
  if (docType === 'excel') {
    return [{
      type: 'text',
      text: `Fichier Excel : "${fileName}". 
Génère des recommandations générales pour l'impression d'un fichier Excel et propose une macro VBA pour optimiser la mise en page avant impression (marges, ajustement des colonnes, orientation, zone d'impression).`,
    }];
  }

  // Texte brut : inclure le contenu si pas trop grand
  if (docType === 'text') {
    try {
      const content = fs.readFileSync(filePath, 'utf8').slice(0, 3000);
      return [{
        type: 'text',
        text: `Contenu du fichier "${fileName}" :\n\n${content}\n\nAnalyse pour l'impression.`,
      }];
    } catch {
      return [textBlock];
    }
  }

  return [textBlock];
}

// ─── Analyse principale ───────────────────────────────────────────────────────

/**
 * Analyse un document avant impression
 * @param {string} filePath         Chemin absolu du fichier
 * @param {string} anthropicApiKey  Clé Anthropic déchiffrée (AES → plaintext)
 * @returns {Promise<{
 *   colorMode: string,
 *   orientation: string,
 *   contentType: string,
 *   issues: string[],
 *   suggestions: string[],
 *   macroVBA: string|null,
 *   confidence: number,
 *   docType: string,
 *   fileName: string,
 *   error?: string
 * }>}
 */
async function analyzeDocumentForPrint(filePath, anthropicApiKey) {
  console.log(`${LOG_PREFIX} analyzeDocumentForPrint("${filePath}")`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Fichier introuvable : ${filePath}`);
  }
  if (!anthropicApiKey) {
    throw new Error('Clé API Anthropic manquante');
  }

  const fileName = path.basename(filePath);
  const docType  = detectDocumentType(filePath);
  console.log(`${LOG_PREFIX} Type détecté : ${docType}`);

  const systemPrompt  = buildSystemPrompt(docType, fileName);
  const userContent   = buildUserContent(filePath, docType);

  const requestBody = {
    model:      CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userContent }],
  };

  console.log(`${LOG_PREFIX} Appel API Claude (${CLAUDE_MODEL})…`);

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
    console.error(`${LOG_PREFIX} Fetch échoué :`, fetchErr.message);
    throw new Error(`Connexion API impossible : ${fetchErr.message}`);
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '(no body)');
    console.error(`${LOG_PREFIX} API HTTP ${response.status} :`, errText);
    throw new Error(`API Claude ${response.status} : ${errText}`);
  }

  const apiData = await response.json();
  const rawText = (apiData.content ?? [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  console.log(`${LOG_PREFIX} Réponse brute :`, rawText.slice(0, 300));

  // Parse JSON — nettoyer les éventuels backticks
  const cleanJson = rawText.replace(/```json|```/g, '').trim();
  let analysis;
  try {
    analysis = JSON.parse(cleanJson);
  } catch (parseErr) {
    console.error(`${LOG_PREFIX} JSON parse échoué :`, parseErr.message);
    // Retourner un résultat dégradé plutôt que de tout casser
    return {
      colorMode:   'color',
      orientation: 'portrait',
      contentType: 'unknown',
      issues:      ['Analyse IA indisponible'],
      suggestions: ['Vérifiez manuellement les paramètres d\'impression'],
      macroVBA:    null,
      confidence:  0,
      docType,
      fileName,
      error:       `Parse JSON échoué : ${parseErr.message}`,
    };
  }

  console.log(`${LOG_PREFIX} ✅ Analyse terminée → colorMode=${analysis.colorMode} orientation=${analysis.orientation}`);

  return {
    colorMode:   analysis.colorMode   ?? 'color',
    orientation: analysis.orientation ?? 'portrait',
    contentType: analysis.contentType ?? 'document',
    issues:      Array.isArray(analysis.issues)      ? analysis.issues      : [],
    suggestions: Array.isArray(analysis.suggestions) ? analysis.suggestions : [],
    macroVBA:    analysis.macroVBA    ?? null,
    confidence:  typeof analysis.confidence === 'number' ? analysis.confidence : 0.5,
    docType,
    fileName,
  };
}

// ─── Analyse Excel spécialisée ────────────────────────────────────────────────

/**
 * Analyse un fichier Excel et génère une macro VBA de correction
 * @param {string} filePath
 * @param {string} anthropicApiKey
 * @returns {Promise<{ issues: string[], macroSuggestion: string }>}
 */
async function analyzeExcel(filePath, anthropicApiKey) {
  console.log(`${LOG_PREFIX} analyzeExcel("${filePath}")`);

  const fileName = path.basename(filePath);

  const prompt = `Tu es un expert Excel/VBA. Génère une macro VBA robuste pour optimiser l'impression du fichier "${fileName}".
La macro doit :
1. Ajuster automatiquement la largeur de toutes les colonnes
2. Définir les marges (haut/bas 1.5cm, gauche/droite 2cm)
3. Centrer horizontalement sur la page
4. Ajuster l'échelle pour tenir sur une seule page en largeur
5. Ajouter un en-tête avec le nom du fichier et la date
6. Définir la qualité d'impression à 300dpi si disponible

Réponds UNIQUEMENT en JSON valide sans markdown :
{
  "issues": ["problème 1", "problème 2"],
  "macroSuggestion": "Sub OptimiserImpression()\\n...End Sub"
}`;

  const response = await fetch(API_ENDPOINT, {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         anthropicApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      messages:   [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`API Claude ${response.status}`);
  }

  const data    = await response.json();
  const rawText = (data.content ?? []).map(b => b.text ?? '').join('');
  const clean   = rawText.replace(/```json|```/g, '').trim();

  try {
    const parsed = JSON.parse(clean);
    return {
      issues:          Array.isArray(parsed.issues) ? parsed.issues : [],
      macroSuggestion: parsed.macroSuggestion ?? '',
    };
  } catch {
    return {
      issues:          ['Analyse indisponible'],
      macroSuggestion: '',
    };
  }
}

module.exports = { analyzeDocumentForPrint, analyzeExcel, detectDocumentType };
