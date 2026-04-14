// lib/helpers.js

export const TTL = 6 * 60 * 60 * 1000; // 6h (session anonyme)

const SESSION_KEY = "derewol_session";

// ── Génération IDs ────────────────────────────────────────────
function randChars(n, pool) {
  pool = pool || "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < n; i++)
    s += pool[Math.floor(Math.random() * pool.length)];
  return s;
}

// Format : DW-anon-XXXXXXXX où X = alphanumérique majuscule
function generateOwnerId() {
  // Format : DW-anon-XXXXXXXX où X = alphanumérique majuscule
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const rand = (n) =>
    Array.from(
      { length: n },
      () => chars[Math.floor(Math.random() * chars.length)],
    ).join("");
  // 8 chars pour la partie unique = 32^8 = 1 trillion de combinaisons
  return `DW-anon-${rand(8)}`;
}

// Code court affiché au client : #9-GNP7CX
function generateDisplayCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const rand = (n) =>
    Array.from(
      { length: n },
      () => chars[Math.floor(Math.random() * chars.length)],
    ).join("");
  return `#${rand(1)}-${rand(7)}`; // ex: #9-GNP7CX
}

// ── Session anonyme ───────────────────────────────────────────
// Crée ou récupère la session pour un slug donné
// Une session = { owner_id, display_code, printer_slug, printer_id, printer_name, expiresAt }

export function loadSession(slug) {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`${SESSION_KEY}_${slug}`);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s.owner_id || !s.printer_slug) return null;
    if (Date.now() > s.expiresAt) {
      localStorage.removeItem(`${SESSION_KEY}_${slug}`);
      return null;
    }
    return s;
  } catch (e) {
    return null;
  }
}

export function saveSession(session) {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    `${SESSION_KEY}_${session.printer_slug}`,
    JSON.stringify(session),
  );
}

export function clearSession(slug) {
  if (typeof window === "undefined") return;
  if (slug) {
    localStorage.removeItem(`${SESSION_KEY}_${slug}`);
  } else {
    // Supprime toutes les sessions derewol
    Object.keys(localStorage)
      .filter((k) => k.startsWith(SESSION_KEY))
      .forEach((k) => localStorage.removeItem(k));
  }
}

// ── Crée une session anonyme fraîche ─────────────────────────
export function createAnonymousSession(printerId, printerSlug) {
  // Vérifier si session existante en localStorage
  const storageKey = `dw_session_${printerSlug}`;
  const existing = localStorage.getItem(storageKey);

  if (existing) {
    try {
      const parsed = JSON.parse(existing);
      // Vérifier que la session est valide et au bon format
      if (parsed.owner_id && parsed.owner_id.startsWith("DW-anon-")) {
        // Mettre à jour last_seen en background (sans attendre)
        // (note: import supabase si nécessaire en haut du fichier)
        return parsed;
      }
    } catch (e) {}
  }

  // Créer nouvelle session
  const owner_id = generateOwnerId();
  const display_code = generateDisplayCode();
  const session = {
    owner_id,
    display_code,
    printer_id: printerId,
    printer_slug: printerSlug,
    created_at: new Date().toISOString(),
    expiresAt: Date.now() + TTL,
  };

  // Sauvegarder en localStorage
  localStorage.setItem(storageKey, JSON.stringify(session));

  return session;
}
