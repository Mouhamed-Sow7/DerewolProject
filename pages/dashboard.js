import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/router";
import supabase from "../lib/supabase";
import { clearSession } from "../lib/helpers";
import useSession from "../hooks/useSession";

// ── Polling ───────────────────────────────────────────────────
function usePrintStatus(displayId) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchGroups = useCallback(async () => {
    if (!displayId) return;
    const { data, error } = await supabase
      .from("file_groups")
      .select(`
        id, status, expires_at,
        files ( id, file_name ),
        print_jobs ( id, status, copies_requested, copies_remaining )
      `)
      .eq("owner_id", displayId);

    if (!error && data) {
      const filtered = data.filter(g => g.status !== "deleted");
      filtered.sort((a, b) => new Date(b.expires_at) - new Date(a.expires_at));
      setGroups(filtered);
    }
    setLoading(false);
  }, [displayId]);

  useEffect(() => {
    fetchGroups();
    const interval = setInterval(fetchGroups, 6000);
    return () => clearInterval(interval);
  }, [fetchGroups]);

  return { groups, loading };
}

// ── Badge statut ──────────────────────────────────────────────
function StatusBadge({ status }) {
  const map = {
    waiting:   { label: "En attente",          bg: "#f5c842", color: "#111510" },
    printing:  { label: "Impression en cours",  bg: "#1d4ed8", color: "#fff" },
    completed: { label: "Terminé",             bg: "#6b7280", color: "#fff" },
    rejected:  { label: "Rejeté",              bg: "#e53935", color: "#fff" },
  };
  const s = map[status] || map.waiting;
  return (
    <span style={{
      background: s.bg, color: s.color,
      padding: "4px 12px", borderRadius: "20px",
      fontSize: "11px", fontWeight: 700, whiteSpace: "nowrap",
    }}>
      {s.label}
    </span>
  );
}

// ── Card groupe ───────────────────────────────────────────────
function GroupCard({ group }) {
  const job = group.print_jobs?.[0];
  const files = group.files || [];
  const status = group.status;
  const copies = job?.copies_requested || 0;
  const copiesRemaining = job?.copies_remaining || 0;

  return (
    <div className="db-card">
      <div className="db-card-header">
        <div className="db-card-header-left">
          <div className="db-card-icon">🗂️</div>
          <div>
            <div className="db-card-count">
              {files.length} fichier{files.length > 1 ? "s" : ""}
            </div>
            <StatusBadge status={status} />
          </div>
        </div>
        {copies > 0 && (
          <div className="db-copies-badge">
            <span className="db-copies-num">{copies}</span>
            <span className="db-copies-label">copie{copies > 1 ? "s" : ""}</span>
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
        {status === "waiting" && (
          <p className="db-msg db-msg--waiting">⏳ Fichier(s) reçu(s) — en attente de l'imprimeur</p>
        )}
        {status === "printing" && (
          <p className="db-msg db-msg--printing">
            🖨️ Impression en cours
            {copiesRemaining > 0 && ` · ${copiesRemaining} copie${copiesRemaining > 1 ? "s" : ""} restante${copiesRemaining > 1 ? "s" : ""}`}
          </p>
        )}
        {status === "completed" && (
          <p className="db-msg db-msg--done">✅ Impression terminée — fichier(s) supprimé(s)</p>
        )}
        {status === "rejected" && (
          <p className="db-msg db-msg--rejected">❌ Rejeté par l'imprimeur</p>
        )}
      </div>
    </div>
  );
}

// ── Page Dashboard ────────────────────────────────────────────
export default function Dashboard({ showToast }) {
  const { session, ready } = useSession();
  const router = useRouter();

  // ⚠️ TOUS les hooks AVANT tout return conditionnel
  const displayId = session?.display_id || null;
  const { groups, loading } = usePrintStatus(displayId);

  // Return conditionnel APRÈS tous les hooks
  if (!ready || !session) return null;

  const activeGroups = groups.filter(g => !["completed", "rejected"].includes(g.status));
  const historyGroups = groups.filter(g => ["completed", "rejected"].includes(g.status));

  function handleLogout() {
    clearSession();
    router.replace("/");
  }

  return (
    <div className="db-container">
      <header className="db-header">
        <div className="db-logo">
          <div className="db-logo-mark"></div>
          <span className="db-logo-text">Derew<b>ol</b></span>
        </div>
        <div className="db-header-right">
          <span className="db-session-id">{session.display_id}</span>
          <button className="db-btn-logout" onClick={handleLogout}>Déconnexion</button>
        </div>
      </header>

      <main className="db-main">
        <section className="db-section">
          <div className="db-section-header">
            <h2 className="db-section-title">Mes fichiers</h2>
            <button className="db-btn-upload" onClick={() => router.push("/upload")}>
              + Envoyer
            </button>
          </div>

          {loading && <div className="db-loading">Chargement...</div>}

          {!loading && activeGroups.length === 0 && (
            <div className="db-empty">
              <span className="db-empty-icon">📭</span>
              <p>Aucun fichier en cours</p>
              <button className="db-btn-upload" onClick={() => router.push("/upload")}>
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