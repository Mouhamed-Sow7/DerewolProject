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

module.exports = supabase;
