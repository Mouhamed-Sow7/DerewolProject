// hooks/useSession.js
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { loadSession } from '../lib/helpers';

// Hook centralisé — vérifie session et redirige si invalide
// Retourne { session, ready }
// ready = false → affiche rien (évite flash de contenu)
// ready = true + session = null → redirect en cours
// ready = true + session = {...} → session valide, affiche la page

export default function useSession() {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const s = loadSession();

    if (!s) {
      // Pas de session valide → retour accueil
      router.replace('/').then(() => setReady(true));
    } else {
      setSession(s);
      setReady(true);
    }
  }, []);

  return { session, ready };
}