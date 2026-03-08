// lib/helpers.js

export const TTL = 6 * 60 * 60 * 1000; // 6h (session anonyme)

const SESSION_KEY = 'derewol_session';

// ── Génération IDs ────────────────────────────────────────────
function randChars(n, pool) {
  pool = pool || 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < n; i++) s += pool[Math.floor(Math.random() * pool.length)];
  return s;
}

// Code court affiché au client : #A7K2
export function generateDisplayCode() {
  return randChars(4, 'ABCDEFGHJKLMNPQRSTUVWXYZ');
}

// ID unique owner : uuid-like
export function generateOwnerId() {
  return 'anon-' + Date.now().toString(36) + '-' + randChars(6);
}

// ── Session anonyme ───────────────────────────────────────────
// Crée ou récupère la session pour un slug donné
// Une session = { owner_id, display_code, printer_slug, printer_id, printer_name, expiresAt }

export function loadSession(slug) {
  if (typeof window === 'undefined') return null;
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
  } catch(e) { return null; }
}

export function saveSession(session) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(
    `${SESSION_KEY}_${session.printer_slug}`,
    JSON.stringify(session)
  );
}

export function clearSession(slug) {
  if (typeof window === 'undefined') return;
  if (slug) {
    localStorage.removeItem(`${SESSION_KEY}_${slug}`);
  } else {
    // Supprime toutes les sessions derewol
    Object.keys(localStorage)
      .filter(k => k.startsWith(SESSION_KEY))
      .forEach(k => localStorage.removeItem(k));
  }
}

// ── Crée une session anonyme fraîche ─────────────────────────
export function createAnonymousSession({ printer_slug, printer_id, printer_name }) {
  const session = {
    owner_id:     generateOwnerId(),
    display_code: generateDisplayCode(),
    printer_slug,
    printer_id,
    printer_name,
    expiresAt:    Date.now() + TTL,
    created_at:   new Date().toISOString(),
  };
  saveSession(session);
  return session;
}