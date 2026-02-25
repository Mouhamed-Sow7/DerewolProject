import '../styles/globals.css';
import '../styles/dashboard.css';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';

// ── Toast global ──────────────────────────────────────────────
function Toast({ message, type, visible }) {
  if (!visible) return null;
  return (
    <div className={`toast toast--${type || 'success'} ${visible ? 'toast--visible' : ''}`}>
      {message}
    </div>
  );
}

export default function App({ Component, pageProps }) {
  const [toast, setToast] = useState({ message: '', type: 'success', visible: false });
  const router = useRouter();

  // ── Enregistrement Service Worker ─────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then(reg => console.log('[SW] Enregistré :', reg.scope))
        .catch(err => console.warn('[SW] Erreur :', err));
    }
  }, []);

  function showToast(message, type = 'success') {
    setToast({ message, type, visible: true });
    setTimeout(() => setToast(t => ({ ...t, visible: false })), 3000);
  }

  return (
    <>
      <Component {...pageProps} showToast={showToast} />
      <Toast {...toast} />
    </>
  );
}