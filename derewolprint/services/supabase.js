require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { createClient } = require("@supabase/supabase-js");
const path = require("path");
const fs = require("fs");

function loadConfig() {
  // 1. Variables d'environnement (dev via .env)
  if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    return {
      url: process.env.SUPABASE_URL,
      key: process.env.SUPABASE_KEY,
    };
  }

  // 2. config.json embarqué (production packagée)
  try {
    let cfgPath;

    // Détecter si on est dans Electron packagé
    const isPackaged = (() => {
      try {
        const { app } = require("electron");
        return app && app.isPackaged;
      } catch {
        return false;
      }
    })();

    if (isPackaged) {
      cfgPath = path.join(process.resourcesPath, "config.json");
    } else {
      // Dev ou non-packagé : chercher config.json à la racine du projet
      cfgPath = path.join(__dirname, "../config.json");
    }

    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      if (cfg.supabaseUrl && cfg.supabaseKey) {
        return { url: cfg.supabaseUrl, key: cfg.supabaseKey };
      }
    }
  } catch (e) {
    console.error("[SUPABASE] Erreur lecture config.json:", e.message);
  }

  // 3. Fallback — ne devrait jamais arriver en prod
  console.error(
    "[SUPABASE] Aucune configuration trouvée — vérifiez .env ou config.json",
  );
  return { url: "", key: "" };
}

const { url, key } = loadConfig();

if (!url || !key) {
  console.error(
    "[SUPABASE] URL ou clé manquante — Supabase ne fonctionnera pas.",
  );
}

const supabase = createClient(url, key);

// ── Generate signed URL for Office Online viewer (120s TTL) ──
async function getSignedUrlForOfficeViewer(storagePath, format) {
  console.log(
    `[SUPABASE] getSignedUrlForOfficeViewer: ${storagePath}, format: ${format}`,
  );

  const { data, error } = await supabase.storage
    .from("derewol-files")
    .createSignedUrl(storagePath, 120); // 120 seconds TTL

  if (error) {
    console.error("[SUPABASE] Signed URL error:", error.message);
    throw new Error(`Failed to generate signed URL: ${error.message}`);
  }

  console.log(`[SUPABASE] Signed URL generated: ${data.signedUrl}`);
  return data.signedUrl;
}

// ══════════════════════════════════════════════════════════════════
// services/supabase.js — DerewolPrint
// Ajout : uploadTempPreview + cleanupTempPreview pour viewer Office
// ══════════════════════════════════════════════════════════════════

/**
 * Upload un fichier Office déchiffré dans derewol-previews (bucket privé)
 * Génère un signed URL de 195s pour Google Docs Viewer
 *
 * @param {Buffer} decryptedBuffer  — Contenu déchiffré du fichier
 * @param {string} fileName         — Nom original (ex: "contrat.docx")
 * @returns {Promise<{signedUrl: string, previewPath: string}>}
 */
async function uploadTempPreview(decryptedBuffer, fileName) {
  const ext = require("path").extname(fileName).toLowerCase();

  // Nom unique dans le bucket — jamais de collision
  const previewPath = `tmp/${Date.now()}-${Math.floor(Math.random() * 0xffff).toString(16)}${ext}`;

  const mimeTypes = {
    ".docx":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".doc": "application/msword",
    ".xls": "application/vnd.ms-excel",
  };
  const contentType = mimeTypes[ext] || "application/octet-stream";

  console.log(`[SUPABASE] uploadTempPreview: ${previewPath} (${contentType})`);

  // Upload avec supabaseAdmin (service_role) pour bypasser RLS
  const { error: uploadError } = await supabaseAdmin.storage
    .from("derewol-previews")
    .upload(previewPath, decryptedBuffer, {
      contentType,
      upsert: false,
      duplex: "half",
    });

  if (uploadError) {
    throw new Error(`[PREVIEW] Upload échoué: ${uploadError.message}`);
  }

  // Signed URL 195s — juste le temps que le viewer charge le fichier
  const { data, error: urlError } = await supabaseAdmin.storage
    .from("derewol-previews")
    .createSignedUrl(previewPath, 195);

  if (urlError) {
    // Nettoyer si la signed URL échoue
    await supabaseAdmin.storage.from("derewol-previews").remove([previewPath]);
    throw new Error(`[PREVIEW] Signed URL échouée: ${urlError.message}`);
  }

  console.log(`[SUPABASE] Preview prête, URL expire dans 195s`);
  return { signedUrl: data.signedUrl, previewPath };
}

/**
 * Supprime le fichier temporaire du bucket derewol-previews
 * Appelé 8s après l'envoi au viewer (le temps que Google/Microsoft charge)
 *
 * @param {string} previewPath — Chemin retourné par uploadTempPreview
 */
async function cleanupTempPreview(previewPath) {
  if (!previewPath) return;
  try {
    const { error } = await supabaseAdmin.storage
      .from("derewol-previews")
      .remove([previewPath]);
    if (error) {
      console.warn(`[SUPABASE] Cleanup preview échoué: ${error.message}`);
    } else {
      console.log(`[SUPABASE] Preview supprimée: ${previewPath}`);
    }
  } catch (e) {
    console.warn(`[SUPABASE] Cleanup preview erreur: ${e.message}`);
  }
}

// Client service_role (bypass RLS)
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || null;
const supabaseAdmin = serviceKey ? createClient(url, serviceKey) : null;
module.exports = {
  supabase,
  supabaseAdmin,
  getSignedUrlForOfficeViewer,
  uploadTempPreview,
  cleanupTempPreview,
};
