export const TTL = 24 * 60 * 60 * 1000;

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

const KEY = 'derewol_session';

export function loadSession() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s.type === 'permanent' || Date.now() < s.expiresAt) return s;
    }
  } catch (e) {}
  const s = { id: generateGuestId(), type: 'guest', createdAt: Date.now(), expiresAt: Date.now() + TTL };
  localStorage.setItem(KEY, JSON.stringify(s));
  return s;
}

export function saveSession(session) {
  localStorage.setItem(KEY, JSON.stringify(session));
}
