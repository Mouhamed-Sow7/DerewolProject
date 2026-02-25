// ── Crypto utilities — compatibles HTTP + HTTPS ───────────────

/**
 * Génère un UUID v4 sans crypto.randomUUID()
 * Compatible HTTP, HTTPS, et tous navigateurs modernes
 */
export function generateToken() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Hash SHA-256 d'un fichier
 * Fallback "hash-unavailable" si crypto.subtle absent (HTTP)
 */
export async function hashFile(file) {
  if (typeof window === "undefined") return "hash-unavailable";
  if (!window.crypto?.subtle) return "hash-unavailable";
  try {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return "hash-unavailable";
  }
}