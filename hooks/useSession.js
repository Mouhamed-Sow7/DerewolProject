// hooks/useSession.js
import { useState, useEffect } from "react";
import { loadSession } from "../lib/helpers";

const SESSION_KEY = "derewol_session";

// Charge la session pour un slug donné, ou la dernière session si pas de slug
// Retourne { session, ready }
// ready=false → ne rien afficher (évite flash)
// session=null → pas de session valide

export default function useSession(slug) {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let s = null;

    // Si slug fourni, charger cette session spécifique
    if (slug) {
      s = loadSession(slug);
    } else {
      // Sinon, charger la dernière session active du localStorage
      try {
        const allKeys = Object.keys(localStorage || {});
        const sessionKeys = allKeys.filter((k) => k.startsWith(SESSION_KEY));
        if (sessionKeys.length > 0) {
          // Prendre la plus récente (dernière session créée)
          const lastKey = sessionKeys[sessionKeys.length - 1];
          const raw = localStorage.getItem(lastKey);
          if (raw) {
            s = JSON.parse(raw);
            // Vérifier que la session n'est pas expirée
            if (s && Date.now() > s.expiresAt) {
              s = null;
            }
          }
        }
      } catch (e) {
        console.warn("[useSession] Error loading last session:", e);
      }
    }

    setSession(s || null);
    setReady(true);
  }, [slug]);

  return { session, ready };
}
