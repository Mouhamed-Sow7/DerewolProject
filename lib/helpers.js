export const TTL = 24 * 60 * 60 * 1000;

const KEY = 'derewol_session';

// ── Génération IDs ────────────────────────────────────────────
export function randChars(n, pool) {
  pool = pool || 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < n; i++) s += pool[Math.floor(Math.random() * pool.length)];
  return s;
}

export function generateGuestId() {
  return 'DW-' + randChars(6) + randChars(2, 'ABCDEFGHJKLMNPQRSTUVWXYZ');
}

export function generatePermanentId() {
  return 'DW-' + randChars(2, 'ABCDEFGHJKLMNPQRSTUVWXYZ') + randChars(5);
}

// ── Session ───────────────────────────────────────────────────
// Ne crée plus de session automatique sans téléphone
// Retourne null si session invalide ou expirée
export function loadSession() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;

    const s = JSON.parse(raw);

    // Session valide uniquement si elle a un téléphone et un display_id
    if (!s.phone || !s.display_id) return null;

    // Vérifie expiration pour les guests
    if (s.type === 'permanent') return s;
    if (Date.now() < s.expiresAt) return s;

    // Session expirée — nettoie
    localStorage.removeItem(KEY);
    return null;

  } catch(e) {
    return null;
  }
}

export function saveSession(session) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function clearSession() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(KEY);
}