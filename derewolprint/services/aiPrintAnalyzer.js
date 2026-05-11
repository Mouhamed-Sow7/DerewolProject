// ═══════════════════════════════════════════════════════════════
// DEREWOL AI — services/aiPrintAnalyzer.js
// Propulsé par Claude (Anthropic) — "AI powered by Claude"
// ═══════════════════════════════════════════════════════════════

const fs      = require('fs')
const path    = require('path')
const { createClient } = require('@supabase/supabase-js')

// ── Config ──────────────────────────────────────────────────────
require('dotenv').config()

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const MODEL             = 'claude-sonnet-4-20250514'
const MAX_TOKENS        = 1000

// Coût approximatif par action (pour les logs)
const COST_PER_ACTION = {
  analyze_document: { tokens: 2000, usd: 0.03, xof: 18 },
  analyze_excel:    { tokens: 3000, usd: 0.05, xof: 30 },
  ocr_document:     { tokens: 2500, usd: 0.04, xof: 24 }
}

// ── Clé API ─────────────────────────────────────────────────────
function getAnthropicKey() {
  // Pour l'instant : .env
  // Plus tard : remplacer par getAnthropicKey() chiffré AES
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY manquante dans .env')
  return key
}

// ── Supabase ─────────────────────────────────────────────────────
function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )
}

// ═══════════════════════════════════════════════════════════════
// SYSTÈME DE CRÉDITS
// ═══════════════════════════════════════════════════════════════

/**
 * Vérifie si le printer a des crédits disponibles
 * @returns {Object} { hasCredits, remaining, purchased, total }
 */
async function checkAICredits(printerId) {
  try {
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('subscriptions')
      .select('ai_credits_remaining, ai_credits_purchased')
      .eq('printer_id', printerId)
      .eq('status', 'active')
      .single()

    if (error || !data) {
      return { hasCredits: false, remaining: 0, purchased: 0, total: 0 }
    }

    const remaining = data.ai_credits_remaining ?? 0
    const purchased = data.ai_credits_purchased ?? 0
    const total     = remaining + purchased

    return { hasCredits: total > 0, remaining, purchased, total }
  } catch (err) {
    console.error('[DEREWOL AI] Erreur checkAICredits:', err.message)
    return { hasCredits: false, remaining: 0, purchased: 0, total: 0 }
  }
}

/**
 * Consomme 1 crédit via la fonction Supabase
 * @returns {Object} { success, source, reason }
 */
async function consumeAICredit(printerId) {
  try {
    const supabase = getSupabase()
    const { data, error } = await supabase
      .rpc('consume_ai_credit', { p_printer_id: printerId })

    if (error) throw error
    return data // { success, source, reason, remaining_after, purchased_after }
  } catch (err) {
    console.error('[DEREWOL AI] Erreur consumeAICredit:', err.message)
    return { success: false, reason: 'db_error' }
  }
}

/**
 * Ajoute des crédits achetés (recharge client)
 * @returns {Object} { success, credits_added, new_purchased_total }
 */
async function addAICredits(printerId, credits, amountXof, paymentRef = null) {
  try {
    const supabase = getSupabase()
    const { data, error } = await supabase
      .rpc('add_ai_credits', {
        p_printer_id:  printerId,
        p_credits:     credits,
        p_amount_xof:  amountXof,
        p_payment_ref: paymentRef
      })

    if (error) throw error
    return data
  } catch (err) {
    console.error('[DEREWOL AI] Erreur addAICredits:', err.message)
    return { success: false }
  }
}

/**
 * Enregistre l'usage dans ai_usage_logs
 */
async function logAIUsage(printerId, action, fileName, creditSource, status = 'success', errorMsg = null) {
  try {
    const supabase = getSupabase()
    const cost     = COST_PER_ACTION[action] || { tokens: 0, usd: 0, xof: 0 }

    await supabase.from('ai_usage_logs').insert({
      printer_id:    printerId,
      action,
      file_name:     fileName,
      tokens_used:   cost.tokens,
      cost_usd:      cost.usd,
      cost_xof:      cost.xof,
      credit_source: creditSource,
      status,
      error_message: errorMsg
    })
  } catch (err) {
    console.error('[DEREWOL AI] Erreur logAIUsage:', err.message)
  }
}

// ═══════════════════════════════════════════════════════════════
// APPEL API ANTHROPIC
// ═══════════════════════════════════════════════════════════════

async function callClaude(prompt, imageBase64 = null, mediaType = 'image/jpeg') {
  const key = getAnthropicKey()

  // Construction du message
  const userContent = imageBase64
    ? [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: imageBase64 }
        },
        { type: 'text', text: prompt }
      ]
    : prompt

  const response = await fetch(ANTHROPIC_API_URL, {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         key,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: MAX_TOKENS,
      system:     `Tu es Derewol AI, l'assistant IA intégré à l'application Derewol pour les boutiques d'impression au Sénégal.
Tu analyses les documents avant impression et tu donnes des conseils pratiques.
Réponds TOUJOURS en français.
Réponds UNIQUEMENT en JSON valide, sans balises markdown, sans texte avant ou après.`,
      messages: [{ role: 'user', content: userContent }]
    })
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Anthropic API error ${response.status}: ${err}`)
  }

  const data = await response.json()
  const text = data.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')

  // Nettoyer les éventuels ```json ... ```
  const clean = text.replace(/```json|```/g, '').trim()
  return JSON.parse(clean)
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
    warnings:    [],
    mode:        'noir_blanc',
    orientation: 'portrait',
    contentType: 'document',
    error:       'Analyse IA indisponible',
    credits:     null
  }

  try {
    // 1. Vérifier les crédits
    const creditCheck = await checkAICredits(printerId)
    if (!creditCheck.hasCredits) {
      return {
        ...FALLBACK,
        error:         'credits_epuises',
        creditsRestants: 0,
        showRecharge:  true
      }
    }

    // 2. Lire le fichier
    if (!fs.existsSync(filePath)) throw new Error(`Fichier introuvable: ${filePath}`)
    const fileBuffer  = fs.readFileSync(filePath)
    const base64Data  = fileBuffer.toString('base64')
    const ext         = path.extname(filePath).toLowerCase()
    const fileName    = path.basename(filePath)

    // Déterminer le mediaType
    const mediaType = ext === '.png' ? 'image/png'
                    : ext === '.pdf' ? 'application/pdf'
                    : 'image/jpeg'

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
}`

    // 4. Appel Claude
    const result = await callClaude(prompt, base64Data, mediaType)

    // 5. Consommer le crédit
    const creditConsume = await consumeAICredit(printerId)

    // 6. Logger
    await logAIUsage(printerId, 'analyze_document', fileName, creditConsume.source)

    return {
      ...result,
      credits: {
        source:           creditConsume.source,
        remainingMonthly: creditConsume.remaining_after,
        remainingPurchased: creditConsume.purchased_after
      }
    }

  } catch (err) {
    console.error('[DEREWOL AI] analyzeDocument error:', err.message)
    await logAIUsage(printerId, 'analyze_document', path.basename(filePath), null, 'error', err.message)
    return FALLBACK
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
    issues:          [],
    macroSuggestion: null,
    error:           'Analyse IA indisponible',
    credits:         null
  }

  try {
    // 1. Vérifier les crédits
    const creditCheck = await checkAICredits(printerId)
    if (!creditCheck.hasCredits) {
      return { ...FALLBACK, error: 'credits_epuises', showRecharge: true }
    }

    const fileName = path.basename(filePath)

    // 2. Pour Excel, on passe le nom + demande des conseils généraux
    // (Excel binaire ne peut pas être lu directement par vision)
    // Le renderer devra passer un screenshot ou une image de l'aperçu
    const prompt = `Tu es un expert en mise en page Excel pour impression.
Un utilisateur veut imprimer un fichier Excel nommé "${fileName}".

Analyse les problèmes courants et retourne ce JSON :
{
  "issues": [
    "problème 1 détecté (colonnes trop larges, headers manquants, etc.)",
    "problème 2"
  ],
  "risques_impression": ["risque 1", "risque 2"],
  "suggestions": ["suggestion 1", "suggestion 2"],
  "macroSuggestion": "Sub CorrigerMiseEnPage()\\n  ' Code VBA complet ici\\nEnd Sub",
  "orientation_recommandee": "paysage" ou "portrait",
  "echelle_recommandee": 85
}`

    // 3. Appel Claude (sans image pour Excel)
    const result = await callClaude(prompt)

    // 4. Consommer le crédit
    const creditConsume = await consumeAICredit(printerId)

    // 5. Logger
    await logAIUsage(printerId, 'analyze_excel', fileName, creditConsume.source)

    return {
      ...result,
      credits: {
        source:             creditConsume.source,
        remainingMonthly:   creditConsume.remaining_after,
        remainingPurchased: creditConsume.purchased_after
      }
    }

  } catch (err) {
    console.error('[DEREWOL AI] analyzeExcel error:', err.message)
    await logAIUsage(printerId, 'analyze_excel', path.basename(filePath), null, 'error', err.message)
    return FALLBACK
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
    text:       '',
    confidence: 0,
    language:   'fr',
    error:      'OCR IA indisponible',
    credits:    null
  }

  try {
    // 1. Vérifier les crédits
    const creditCheck = await checkAICredits(printerId)
    if (!creditCheck.hasCredits) {
      return { ...FALLBACK, error: 'credits_epuises', showRecharge: true }
    }

    // 2. Lire le fichier image
    if (!fs.existsSync(filePath)) throw new Error(`Fichier introuvable: ${filePath}`)
    const fileBuffer = fs.readFileSync(filePath)
    const base64Data = fileBuffer.toString('base64')
    const ext        = path.extname(filePath).toLowerCase()
    const fileName   = path.basename(filePath)
    const mediaType  = ext === '.png' ? 'image/png' : 'image/jpeg'

    // 3. Prompt OCR
    const prompt = `Effectue une reconnaissance de texte (OCR) complète sur cette image.
Retourne ce JSON :
{
  "text": "texte complet extrait, avec sauts de ligne \\n là où il y en a",
  "confidence": 95,
  "language": "fr" ou "ar" ou "wo" ou "en",
  "blocks": [
    { "type": "titre" ou "paragraphe" ou "tableau" ou "liste", "content": "..." }
  ],
  "qualite_image": "bonne" ou "moyenne" ou "mauvaise",
  "suggestions": ["amélioration 1 si nécessaire"]
}`

    // 4. Appel Claude Vision
    const result = await callClaude(prompt, base64Data, mediaType)

    // 5. Consommer le crédit
    const creditConsume = await consumeAICredit(printerId)

    // 6. Logger
    await logAIUsage(printerId, 'ocr_document', fileName, creditConsume.source)

    return {
      ...result,
      credits: {
        source:             creditConsume.source,
        remainingMonthly:   creditConsume.remaining_after,
        remainingPurchased: creditConsume.purchased_after
      }
    }

  } catch (err) {
    console.error('[DEREWOL AI] ocrDocument error:', err.message)
    await logAIUsage(printerId, 'ocr_document', path.basename(filePath), null, 'error', err.message)
    return FALLBACK
  }
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

module.exports = {
  // Fonctions principales
  analyzeDocument,
  analyzeExcel,
  ocrDocument,

  // Système de crédits (pour main.js)
  checkAICredits,
  consumeAICredit,
  addAICredits
}
