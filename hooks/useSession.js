// hooks/useSession.js
import { useState, useEffect } from 'react';
import { loadSession } from '../lib/helpers';

// Charge la session pour un slug donné
// Retourne { session, ready }
// ready=false → ne rien afficher (évite flash)
// session=null → pas de session valide pour ce slug

export default function useSession(slug) {
  const [session, setSession] = useState(null);
  const [ready, setReady]     = useState(false);

  useEffect(() => {
    if (!slug) return;
    const s = loadSession(slug);
    setSession(s || null);
    setReady(true);
  }, [slug]);

  return { session, ready };
}