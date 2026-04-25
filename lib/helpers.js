// lib/helpers.js

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
    let raw = localStorage.getItem(`${SESSION_KEY}_${slug}`);
    if (!raw) {
      raw = localStorage.getItem(`dw_session_${slug}`);
    }
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s.owner_id || !s.printer_slug) return null;
    if (Date.now() > s.expiresAt) {
      localStorage.removeItem(`${SESSION_KEY}_${slug}`);
      localStorage.removeItem(`dw_session_${slug}`);
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
export function createAnonymousSession({
  printer_id,
  printer_slug,
  printer_name,
}) {
  // Vérifier si session existante en localStorage
  const storageKey = `${SESSION_KEY}_${printer_slug}`;
  let existing = localStorage.getItem(storageKey);
  if (!existing) {
    existing = localStorage.getItem(`dw_session_${printer_slug}`);
  }

  if (existing) {
    try {
      const parsed = JSON.parse(existing);
      // Vérifier que la session est valide et au bon format
      if (parsed.owner_id && parsed.owner_id.startsWith("DW-anon-")) {
        if (!parsed.printer_slug && printer_slug) {
          parsed.printer_slug = printer_slug;
        }
        if (!parsed.printer_id && printer_id) {
          parsed.printer_id = printer_id;
        }
        if (!parsed.printer_name && printer_name) {
          parsed.printer_name = printer_name;
        }
        localStorage.setItem(storageKey, JSON.stringify(parsed));
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
    printer_id: printer_id,
    printer_slug,
    printer_name,
    created_at: new Date().toISOString(),
    expiresAt: Date.now() + TTL,
  };

  // Sauvegarder en localStorage
  localStorage.setItem(storageKey, JSON.stringify(session));

  // Persister en DB de manière non-bloquante
  supabase
    .from("anon_sessions")
    .insert({
      owner_id: session.owner_id,
      printer_slug: session.printer_slug,
      printer_id: session.printer_id,
      display_code: session.display_code,
      expires_at: new Date(session.expiresAt).toISOString(),
    })
    .then((result) => {
      console.log("[SESSION] ✅ Persisted to DB:", {
        owner_id: session.owner_id,
        display_code: session.display_code,
        expires_at: session.expiresAt,
        result_count: result.data?.length,
      });
    })
    .catch((err) => {
      console.error("[SESSION] ❌ DB persist failed:", {
        owner_id: session.owner_id,
        error: err.message,
        code: err.code,
        details: err.details,
      });
    });

  return session;
}
