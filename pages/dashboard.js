import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/router";
import supabase from "../lib/supabase";
import { clearSession } from "../lib/helpers";
import useSession from "../hooks/useSession";

// ── Polling ───────────────────────────────────────────────────
function usePrintStatus(displayId) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!displayId) {
      setGroups([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    async function fetchGroups() {
      try {
        // 1. Groupes actifs depuis file_groups
        const { data: activeData } = await supabase
          .from("file_groups")
          .select(
            `
            id, status, expires_at, copies_count, updated_at,
            files ( id, file_name, rejected ),
            print_jobs ( id, status, copies_requested, copies_remaining, expires_at )
          `,
          )
          .eq("owner_id", displayId)
          .neq("status", "deleted")
          .order("updated_at", { ascending: false })
          .limit(50);

        // 2. Historique depuis history directement (file_groups supprimés)
        const { data: historyData } = await supabase
          .from("history")
          .select("id, group_id, file_name, status, copies, printed_at")
          .eq("owner_id", displayId)
          .order("printed_at", { ascending: false })
          .limit(50);

        if (cancelled) return;

        // 3. Groupes actifs non-terminés
        const active = (activeData ?? []).filter(
          (g) => !["completed", "rejected", "expired"].includes(g.status),
        );

        // 4. Reconstruit les groupes historique depuis history
        const historyMap = {};
        for (const h of historyData ?? []) {
          if (!historyMap[h.group_id]) {
            historyMap[h.group_id] = {
              id: h.group_id,
              status: h.status === "rejected" ? "rejected" : "completed",
              expires_at: h.printed_at,
              updated_at: h.printed_at,
              copies_count: h.copies,
              files: [],
              print_jobs: [],
              history: [],
              isHistoryGroup: true,
            };
          }
          historyMap[h.group_id].history.push(h);
          // Le statut du groupe = rejected si AU MOINS UN fichier est rejected
          if (h.status === "completed") {
            historyMap[h.group_id].status = "completed";
          }
        }

        const historyGroups = Object.values(historyMap).sort(
          (a, b) => new Date(b.updated_at) - new Date(a.updated_at),
        );

        setGroups([...active, ...historyGroups]);
      } catch (err) {
        console.warn("[dashboard] fetch error:", err?.message || err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchGroups();
    const iv = setInterval(fetchGroups, 3000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [displayId]);

  return { groups, loading };
}

// ── Timer compte à rebours ────────────────────────────────────
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
  if (remaining <= 0) return "Expiré";

  const totalSecs = Math.floor(remaining / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// ── Badge statut ──────────────────────────────────────────────
function StatusBadge({ status }) {
  const map = {
    waiting: { label: "En attente", bg: "#f5c842", color: "#111510" },
    printing: { label: "Impression en cours", bg: "#1d4ed8", color: "#fff" },
    completed: { label: "Terminé", bg: "#6b7280", color: "#fff" },
    rejected: { label: "Rejeté", bg: "#e53935", color: "#fff" },
    partial_rejected: {
      label: "Partiel rejeté",
      bg: "#fef3c7",
      color: "#92400e",
    },
    expired: { label: "Expiré", bg: "#9ca3af", color: "#fff" },
  };
  const s = map[status] || map.waiting;
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        padding: "4px 12px",
        borderRadius: "20px",
        fontSize: "11px",
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}

// ── Timer pill ────────────────────────────────────────────────
function TimerPill({ expiresAt, status }) {
  const countdown = useCountdown(status === "waiting" ? expiresAt : null);
  if (!countdown || status !== "waiting") return null;

  const isUrgent = countdown !== "Expiré" && parseInt(countdown) < 5;

  return (
    <span
      style={{
        fontSize: "11px",
        fontFamily: "monospace",
        padding: "3px 10px",
        borderRadius: "20px",
        background: isUrgent ? "#fef2f2" : "#f5f0e8",
        color: isUrgent ? "#e53935" : "#92600a",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      ⏱ {countdown}
    </span>
  );
}

// ── Card groupe ───────────────────────────────────────────────
function GroupCard({ group }) {
  const job = group.print_jobs?.[0];
  const files = group.files || [];
  const hasPrintingJob = group.print_jobs?.some(
    (job) => job?.status === "printing",
  );
  const status =
    hasPrintingJob && group.status === "waiting" ? "printing" : group.status;
  const copies = job?.copies_requested || 0;
  const copiesRemaining = job?.copies_remaining || 0;
  const jobExpiresAt = job?.expires_at;

  const isHistory = ["completed", "rejected", "expired"].includes(status);

  // ✅ Pour l'historique, utilise history au lieu de files (qui est vide)
  const displayFiles = isHistory ? group.history || [] : group.files || [];

  return (
    <div
      className={`db-card ${status === "expired" ? "db-card--expired" : ""}`}
    >
      {/* Header */}
      <div className="db-card-header">
        <div className="db-card-header-left">
          <div className="db-card-icon">{isHistory ? "📋" : "🗂️"}</div>
          <div>
            <div className="db-card-count">
              {displayFiles.length} fichier{displayFiles.length > 1 ? "s" : ""}
            </div>
            <div
              style={{
                display: "flex",
                gap: "6px",
                alignItems: "center",
                flexWrap: "wrap",
                marginTop: "4px",
              }}
            >
              <StatusBadge status={status} />
              <TimerPill expiresAt={jobExpiresAt} status={status} />
            </div>
          </div>
        </div>
        {copies > 0 && (
          <div className="db-copies-badge">
            <span className="db-copies-num">{copies}</span>
            <span className="db-copies-label">
              copie{copies > 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>

      {/* Liste des fichiers depuis history */}
      <div className="db-files-list">
        {displayFiles.map((f) => {
          const isRejected = isHistory
            ? f.status === "rejected"
            : f.rejected === true;
          const fileStatus = isRejected
            ? "rejected"
            : status === "completed"
              ? "completed"
              : status === "expired"
                ? "expired"
                : null;

          return (
            <div
              key={f.id}
              className={`db-file-row ${isRejected ? "db-file-row--rejected" : ""}`}
            >
              <span className="db-file-icon">
                {isRejected ? "✕" : status === "completed" ? "✓" : "📄"}
              </span>
              <span className="db-file-name" title={f.file_name}>
                {f.file_name}
              </span>
              {fileStatus === "completed" && (
                <span className="db-file-status db-file-status--done">
                  Imprimé
                </span>
              )}
              {fileStatus === "rejected" && (
                <span className="db-file-status db-file-status--rejected">
                  Rejeté — supprimé
                </span>
              )}
              {fileStatus === "expired" && (
                <span className="db-file-status db-file-status--expired">
                  Expiré — supprimé
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Message statut */}
      <div className="db-status-msg">
        {status === "waiting" && (
          <p className="db-msg db-msg--waiting">
            ⏳ Fichier(s) reçu(s) — en attente de l'imprimeur
          </p>
        )}
        {status === "printing" && (
          <p className="db-msg db-msg--printing">
            🖨️ Impression en cours
            {copiesRemaining > 0 &&
              ` · ${copiesRemaining} copie${copiesRemaining > 1 ? "s" : ""} restante${copiesRemaining > 1 ? "s" : ""}`}
          </p>
        )}
        {status === "completed" && (
          <p className="db-msg db-msg--done">
            ✅ Impression terminée — fichier(s) supprimé(s)
          </p>
        )}
        {status === "rejected" && (
          <p className="db-msg db-msg--rejected">❌ Rejeté par l'imprimeur</p>
        )}
        {status === "expired" && (
          <p className="db-msg db-msg--expired">
            ⏰ Délai dépassé — renvoyez vos fichiers pour imprimer
          </p>
        )}
      </div>
    </div>
  );
}

// ── Page Dashboard ────────────────────────────────────────────
export default function Dashboard({ showToast }) {
  const { session, ready } = useSession();
  const router = useRouter();

  // Tous les hooks avant return conditionnel
  const displayId = session?.owner_id || null;
  const { groups, loading } = usePrintStatus(displayId);

  if (!ready || !session) return null;

  const activeGroups = groups.filter(
    (g) => !["completed", "rejected", "expired"].includes(g.status),
  );
  const historyGroups = groups.filter((g) =>
    ["completed", "rejected", "expired"].includes(g.status),
  );

  function handleLogout() {
    clearSession();
    router.replace("/");
  }

  return (
    <div className="db-container">
      <header className="db-header">
        <div className="db-logo">
          <div className="db-logo-mark"></div>
          <span className="db-logo-text">
            Derew<b>ol</b>
          </span>
        </div>
        <div className="db-header-right">
          <span className="db-session-id">{session.display_code}</span>
          <button className="db-btn-logout" onClick={handleLogout}>
            Déconnexion
          </button>
        </div>
      </header>

      <main className="db-main">
        <section className="db-section">
          <div className="db-section-header">
            <h2 className="db-section-title">Mes fichiers</h2>
            <button
              className="db-btn-upload"
              onClick={() => router.push("/upload")}
            >
              + Envoyer
            </button>
          </div>

          {loading && <div className="db-loading">Chargement...</div>}

          {!loading && activeGroups.length === 0 && (
            <div className="db-empty">
              <span className="db-empty-icon">📭</span>
              <p>Aucun fichier en cours</p>
              <button
                className="db-btn-upload"
                onClick={() => router.push("/upload")}
              >
                Envoyer un fichier
              </button>
            </div>
          )}

          <div className="db-grid">
            {activeGroups.map((g) => (
              <GroupCard key={g.id} group={g} />
            ))}
          </div>
        </section>

        {historyGroups.length > 0 && (
          <section className="db-section">
            <h2 className="db-section-title db-section-title--muted">
              Historique
            </h2>
            <div className="db-grid">
              {historyGroups.map((g) => (
                <GroupCard key={g.id} group={g} />
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
