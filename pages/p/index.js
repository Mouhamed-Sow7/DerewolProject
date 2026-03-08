// pages/p/index.js
// Page SPA unique — lit le slug depuis ?slug=xxx ou le path /p/librairie-derewol
// Le .htaccess redirige tout /p/* vers /p/index.html
// Puis on lit window.location.pathname côté client pour extraire le slug

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { getPrinterBySlug, createFileGroup, uploadFileToGroup, fetchGroupsByOwner } from '../../lib/supabase';
import { loadSession, saveSession, clearSession, createAnonymousSession } from '../../lib/helpers';

// ── Extrait le slug depuis le pathname ────────────────────────
// /p/librairie-derewol        → "librairie-derewol"
// /p/librairie-derewol/upload → "librairie-derewol"
function extractSlug() {
  if (typeof window === 'undefined') return null;
  const parts = window.location.pathname.split('/').filter(Boolean);
  // parts = ['p', 'librairie-derewol'] ou ['p', 'librairie-derewol', 'upload']
  return parts[1] || null;
}

function extractSubPage() {
  if (typeof window === 'undefined') return 'home';
  const parts = window.location.pathname.split('/').filter(Boolean);
  return parts[2] || 'home'; // 'upload' | 'dashboard' | 'home'
}

// ── Hooks ─────────────────────────────────────────────────────
function usePrintStatus(ownerId) {
  const [groups, setGroups]   = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchGroups = useCallback(async () => {
    if (!ownerId) return;
    const data = await fetchGroupsByOwner(ownerId);
    setGroups(data);
    setLoading(false);
  }, [ownerId]);

  useEffect(() => {
    fetchGroups();
    const interval = setInterval(fetchGroups, 6000);
    return () => clearInterval(interval);
  }, [fetchGroups]);

  return { groups, loading };
}

function useCountdown(expiresAt) {
  const [remaining, setRemaining] = useState(null);
  useEffect(() => {
    if (!expiresAt) return;
    function calc() {
      const diff = new Date(expiresAt) - Date.now();
      setRemaining(diff > 0 ? diff : 0);
    }
    calc();
    const t = setInterval(calc, 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  if (remaining === null) return null;
  if (remaining <= 0) return 'Expiré';
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ── Composants UI ─────────────────────────────────────────────
function StatusBadge({ status }) {
  const map = {
    waiting:   { label: 'En attente',          bg: '#f5c842', color: '#111510' },
    printing:  { label: 'Impression en cours',  bg: '#1d4ed8', color: '#fff'   },
    completed: { label: 'Terminé',              bg: '#166534', color: '#fff'   },
    rejected:  { label: 'Rejeté',              bg: '#e53935', color: '#fff'   },
    expired:   { label: 'Expiré',              bg: '#9ca3af', color: '#fff'   },
  };
  const s = map[status] || map.waiting;
  return (
    <span style={{
      background: s.bg, color: s.color,
      padding: '4px 12px', borderRadius: 20,
      fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
    }}>{s.label}</span>
  );
}

function TimerPill({ expiresAt, status }) {
  const countdown = useCountdown(status === 'waiting' ? expiresAt : null);
  if (!countdown || status !== 'waiting') return null;
  const isUrgent = countdown !== 'Expiré' && parseInt(countdown) < 5;
  return (
    <span style={{
      fontSize: 11, fontFamily: 'monospace', padding: '3px 10px',
      borderRadius: 20, fontWeight: 600, whiteSpace: 'nowrap',
      background: isUrgent ? '#fef2f2' : '#f5f0e8',
      color: isUrgent ? '#e53935' : '#92600a',
    }}>⏱ {countdown}</span>
  );
}

function GroupCard({ group }) {
  const job             = group.print_jobs?.[0];
  const files           = group.files || [];
  const status          = group.status;
  const copies          = job?.copies_requested || 0;
  const copiesRemaining = job?.copies_remaining || 0;
  const isHistory       = ['completed', 'rejected', 'expired'].includes(status);

  return (
    <div className={`db-card ${status === 'expired' ? 'db-card--expired' : ''}`}>
      <div className="db-card-header">
        <div className="db-card-header-left">
          <div className="db-card-icon">{isHistory ? '📋' : '🗂️'}</div>
          <div>
            <div className="db-card-count">{files.length} fichier{files.length > 1 ? 's' : ''}</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
              <StatusBadge status={status} />
              <TimerPill expiresAt={job?.expires_at} status={status} />
            </div>
          </div>
        </div>
        {copies > 0 && (
          <div className="db-copies-badge">
            <span className="db-copies-num">{copies}</span>
            <span className="db-copies-label">copie{copies > 1 ? 's' : ''}</span>
          </div>
        )}
      </div>
      <div className="db-files-list">
        {files.map(f => (
          <div key={f.id} className="db-file-row">
            <span className="db-file-icon">📄</span>
            <span className="db-file-name" title={f.file_name}>{f.file_name}</span>
          </div>
        ))}
      </div>
      <div className="db-status-msg">
        {status === 'waiting'   && <p className="db-msg db-msg--waiting">⏳ En attente de l'imprimeur</p>}
        {status === 'printing'  && (
          <p className="db-msg db-msg--printing">
            🖨️ Impression en cours
            {copiesRemaining > 0 && ` · ${copiesRemaining} copie${copiesRemaining > 1 ? 's' : ''} restante${copiesRemaining > 1 ? 's' : ''}`}
          </p>
        )}
        {status === 'completed' && <p className="db-msg db-msg--done">✅ Terminé — fichiers supprimés</p>}
        {status === 'rejected'  && <p className="db-msg db-msg--rejected">❌ Rejeté par l'imprimeur</p>}
        {status === 'expired'   && <p className="db-msg db-msg--expired">⏰ Délai dépassé — renvoyez vos fichiers</p>}
      </div>
    </div>
  );
}

// ── Page principale SPA ───────────────────────────────────────
const MAX_FILES   = 5;
const MAX_SIZE_MB = 10;

export default function PrinterSPA({ showToast }) {
  const [slug, setSlug]         = useState(null);
  const [page, setPage]         = useState('loading'); // loading | notfound | upload | dashboard
  const [printer, setPrinter]   = useState(null);
  const [session, setSession]   = useState(null);
  const [selected, setSelected] = useState([]);
  const [uploading, setUploading] = useState(false);

  const ownerId = session?.owner_id || null;
  const { groups, loading: groupsLoading } = usePrintStatus(ownerId);

  // ── Init : résout slug + printer + session ────────────────
  useEffect(() => {
    const s = extractSlug();
    const sub = extractSubPage();
    setSlug(s);

    if (!s) { setPage('notfound'); return; }

    // Charge l'imprimeur depuis Supabase
    getPrinterBySlug(s).then(printerData => {
      if (!printerData) { setPage('notfound'); return; }
      setPrinter(printerData);

      // Charge ou crée session
      let sess = loadSession(s);
      if (!sess) {
        sess = createAnonymousSession({
          printer_slug: s,
          printer_id:   printerData.id,
          printer_name: printerData.name,
        });
      }
      setSession(sess);

      // Détermine quelle vue afficher
      if (sub === 'dashboard') {
        setPage('dashboard');
      } else {
        setPage('upload');
      }
    });
  }, []);

  // ── Navigation interne (sans rechargement) ────────────────
  function goTo(subPage) {
    const newPath = `/p/${slug}/${subPage === 'upload' ? 'upload' : 'dashboard'}`;
    window.history.pushState({}, '', newPath);
    setPage(subPage);
  }

  // ── Upload ────────────────────────────────────────────────
  function addFiles(newFiles) {
    const pdfs  = Array.from(newFiles).filter(f => f.type === 'application/pdf');
    const valid = pdfs.filter(f => {
      if (f.size > MAX_SIZE_MB * 1024 * 1024) {
        showToast?.(`"${f.name}" dépasse ${MAX_SIZE_MB}MB`, 'error');
        return false;
      }
      return true;
    });
    setSelected(prev => {
      const combined = [...prev, ...valid];
      if (combined.length > MAX_FILES) {
        showToast?.(`Maximum ${MAX_FILES} fichiers`, 'error');
        return combined.slice(0, MAX_FILES);
      }
      return combined;
    });
  }

  function removeFile(i) { setSelected(prev => prev.filter((_, idx) => idx !== i)); }

  async function handleUpload() {
    if (!selected.length || uploading || !printer || !session) return;
    setUploading(true);
    try {
      const groupId = await createFileGroup({
        ownerId:   session.owner_id,
        printerId: printer.id,
      });
      for (const file of selected) {
        await uploadFileToGroup({
          file, groupId,
          ownerId:   session.owner_id,
          printerId: printer.id,
        });
      }
      showToast?.('Fichiers envoyés !');
      setSelected([]);
      goTo('dashboard');
    } catch (err) {
      showToast?.(err.message || "Erreur lors de l'envoi", 'error');
    } finally {
      setUploading(false);
    }
  }

  function handleNewSession() {
    clearSession(slug);
    const sess = createAnonymousSession({
      printer_slug: slug,
      printer_id:   printer.id,
      printer_name: printer.name,
    });
    setSession(sess);
    setSelected([]);
    goTo('upload');
  }

  // ── Renders ───────────────────────────────────────────────
  if (page === 'loading') {
    return (
      <div className="home-container">
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⏳</div>
          <p style={{ color: '#7a8c78', fontSize: 14 }}>Connexion...</p>
        </div>
      </div>
    );
  }

  if (page === 'notfound') {
    return (
      <div className="home-container">
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
          <h2 style={{ marginBottom: 8 }}>Espace introuvable</h2>
          <p style={{ color: '#7a8c78', fontSize: 14, lineHeight: 1.6 }}>
            Ce QR code n'est plus valide.<br/>
            Demandez un nouveau à l'imprimeur.
          </p>
        </div>
      </div>
    );
  }

  if (page === 'upload') {
    const remaining = MAX_FILES - selected.length;
    return (
      <div className="container">
        <div className="upload-card">
          <div className="header">
            <div className="db-logo" style={{ marginBottom: 4 }}>
              <div className="db-logo-mark"></div>
              <span className="db-logo-text">Derew<b>ol</b></span>
            </div>
            <div className="session-info">
              <span>🖨️ {printer?.name}</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#1e4d2b' }}>
                #{session?.display_code}
              </span>
            </div>
          </div>

          {selected.length < MAX_FILES && (
            <div
              className="drop-zone"
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
              onClick={() => document.getElementById('file-input').click()}
            >
              <input
                id="file-input" type="file" accept="application/pdf"
                multiple style={{ display: 'none' }}
                onChange={e => addFiles(e.target.files)}
              />
              <p className="drop-title">Glissez vos PDF ici</p>
              <span className="drop-sub">
                ou cliquez · {remaining} fichier{remaining > 1 ? 's' : ''} restant{remaining > 1 ? 's' : ''}
              </span>
            </div>
          )}

          {selected.length > 0 && (
            <div className="file-list">
              {selected.map((file, i) => (
                <div key={i} className="file-item">
                  <span title={file.name}>📄 {file.name}</span>
                  <button onClick={() => removeFile(i)}>✕</button>
                </div>
              ))}
            </div>
          )}

          {selected.length > 0 && (
            <p className="files-count">{selected.length}/{MAX_FILES} fichier{selected.length > 1 ? 's' : ''}</p>
          )}

          <button
            onClick={handleUpload}
            disabled={!selected.length || uploading}
            className="upload-btn"
          >
            {uploading ? 'Envoi en cours...' : "Envoyer à l'imprimeur"}
          </button>

          <div className="security-note">
            <small>🔒 Fichiers supprimés automatiquement après impression</small>
          </div>
        </div>
      </div>
    );
  }

  if (page === 'dashboard') {
    const activeGroups  = groups.filter(g => !['completed', 'rejected', 'expired'].includes(g.status));
    const historyGroups = groups.filter(g =>  ['completed', 'rejected', 'expired'].includes(g.status));

    return (
      <div className="db-container">
        <header className="db-header">
          <div className="db-logo">
            <div className="db-logo-mark"></div>
            <span className="db-logo-text">Derew<b>ol</b></span>
          </div>
          <div className="db-header-right">
            <span className="db-session-id">#{session?.display_code}</span>
            <span style={{ fontSize: 12, color: '#7a8c78' }}>🖨️ {printer?.name}</span>
            <button className="db-btn-logout" onClick={handleNewSession}>
              Nouvelle session
            </button>
          </div>
        </header>

        <main className="db-main">
          <section className="db-section">
            <div className="db-section-header">
              <h2 className="db-section-title">Mes fichiers</h2>
              <button className="db-btn-upload" onClick={() => goTo('upload')}>
                + Envoyer
              </button>
            </div>

            {groupsLoading && <div className="db-loading">Chargement...</div>}

            {!groupsLoading && activeGroups.length === 0 && (
              <div className="db-empty">
                <span className="db-empty-icon">📭</span>
                <p>Aucun fichier en cours</p>
                <button className="db-btn-upload" onClick={() => goTo('upload')}>
                  Envoyer un fichier
                </button>
              </div>
            )}

            <div className="db-grid">
              {activeGroups.map(g => <GroupCard key={g.id} group={g} />)}
            </div>
          </section>

          {historyGroups.length > 0 && (
            <section className="db-section">
              <h2 className="db-section-title db-section-title--muted">Historique</h2>
              <div className="db-grid">
                {historyGroups.map(g => <GroupCard key={g.id} group={g} />)}
              </div>
            </section>
          )}
        </main>
      </div>
    );
  }

  return null;
}