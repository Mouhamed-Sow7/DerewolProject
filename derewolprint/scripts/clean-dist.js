const fs = require("fs");
const path = require("path");
const distPath = path.join(__dirname, "..", "dist");
if (fs.existsSync(distPath)) {
  try {
    fs.rmSync(distPath, { recursive: true, force: true });
    console.log("[BUILD] dist/ nettoyé");
  } catch (e) {
    console.warn("[BUILD] Impossible de nettoyer dist/:", e.message);
    console.warn("[BUILD] Fermez DerewolPrint et réessayez");
  }
} else {
  console.log("[BUILD] dist/ n'existe pas, pas besoin de nettoyer");
}
