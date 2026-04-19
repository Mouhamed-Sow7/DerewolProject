// pages/p/index.js - Print SPA Refacto Complete
import { useState, useEffect, useCallback, useRef } from "react";
import supabase, {
  getPrinterBySlug,
  createFileGroup,
  uploadFileToGroup,
  fetchGroupsByOwner,
  updateFilesCount,
} from "../../lib/supabase";
import {
  loadSession,
  clearSession,
  createAnonymousSession,
} from "../../lib/helpers";

const C = {
  bg: "#faf8f2",
  surface: "#ffffff",
  surface2: "#f5f2ea",
  green: "#1e4d2b",
  greenMid: "#2d6a3f",
  greenLight: "#e8f5ec",
  yellow: "#f5c842",
  text: "#111510",
  text2: "#3d4a3f",
  muted: "#6b7c6e",
  border: "#e0ddd5",
  danger: "#e53935",
  info: "#1d4ed8",
};

const TRANSLATIONS = {
  fr: {
    dropHere: "Glissez vos fichiers ici",
    orClick: "ou appuyez pour sélectionner",
    maxFiles: ({ n }) =>
      `${n} fichier${n > 1 ? "s" : ""} restant${n > 1 ? "s" : ""}`,
    totalCopies: "Total copies",
    sendBtn: "Envoyer à l'imprimeur",
    sending: "Envoi en cours...",
    securityNote: "Fichiers supprimés après impression",
    myFiles: "Mes fichiers",
    history: "Historique",
    waiting: "En attente",
    printing: "Impression en cours",
    completed: "Terminé",
    rejected: "Rejeté",
    expired: "Expiré",
    waitingMsg: "En attente de l'imprimeur",
    printingMsg: "Impression en cours...",
    completedMsg: "Terminé — fichiers supprimés",
    rejectedMsg: "Rejeté — fichier supprimé",
    expiredMsg: "Délai dépassé — renvoyez vos fichiers",
    connecting: "Connexion...",
    notFound: "Espace introuvable",
    notFoundDesc: "Ce QR code n'est plus valide.",
  },
  en: {
    dropHere: "Drop your files here",
    orClick: "or tap to select",
    maxFiles: ({ n }) => `${n} file${n > 1 ? "s" : ""} remaining`,
    totalCopies: "Total copies",
    sendBtn: "Send to printer",
    sending: "Sending...",
    securityNote: "Files deleted after printing",
    myFiles: "My files",
    history: "History",
    waiting: "Waiting",
    printing: "Printing",
    completed: "Done",
    rejected: "Rejected",
    expired: "Expired",
    waitingMsg: "Waiting for the printer",
    printingMsg: "Printing in progress...",
    completedMsg: "Done — files deleted",
    rejectedMsg: "Rejected — file deleted",
    expiredMsg: "Expired — please resend",
    connecting: "Connecting...",
    notFound: "Space not found",
    notFoundDesc: "This QR code is no longer valid.",
  },
  wo: {
    dropHere: "Tëj sa dosye yi fii",
    orClick: "walla dëkk",
    maxFiles: ({ n }) => `${n} dosye${n > 1 ? "i" : ""} des`,
    totalCopies: "Jàmm kopi yi",
    sendBtn: "Yónni ci jëfandikukat",
    sending: "Da ngay yónnee...",
    securityNote: "Dosye yi bokk léegi jëfandikoo",
    myFiles: "Sa dosye yi",
    history: "Xam-xam",
    waiting: "Xaar",
    printing: "Da ngay jëfandikoo",
    completed: "Jeex na",
    rejected: "Bàyyi na",
    expired: "Xaar bi jeex na",
    waitingMsg: "Xaar jëfandikukat bi",
    printingMsg: "Da ngay jëfandikoo...",
    completedMsg: "Jeex na — dosye yi bokk",
    rejectedMsg: "Bàyyi na — dosye bu bokk",
    expiredMsg: "Xaar bi jeex na — yónni ci kanam",
    connecting: "Da ngay bind...",
    notFound: "Amul fenn",
    notFoundDesc: "QR code bi dafa dëgër.",
  },
};

function useTranslation(lang) {
  const tr = TRANSLATIONS[lang] || TRANSLATIONS.fr;
  return (key, params) => {
    const val = tr[key] || TRANSLATIONS.fr[key] || key;
    return typeof val === "function" ? val(params) : val;
  };
}

function extractSlug() {
  if (typeof window === "undefined") return null;
  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts[1] || null;
}

function usePrintStatus(ownerId) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ownerId) {
      setGroups([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const fetchGroups = async () => {
      try {
        const data = await fetchGroupsByOwner(ownerId);
        if (!cancelled) {
          setGroups(data || []);
          setLoading(false);
        }
      } catch (err) {
        console.error("[usePrintStatus] fetch error:", err?.message || err);
        if (!cancelled) setLoading(false);
      }
    };

    fetchGroups();
    const iv = setInterval(fetchGroups, 3000);

    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [ownerId]);

  return { groups, loading };
}

// Hook: Surveille les demandes de téléchargement
function useDownloadRequests(ownerId) {
  const [pending, setPending] = useState([]);
  const seenRef = useRef(new Set());

  useEffect(() => {
    if (!ownerId) return;
    let cancelled = false;

    const fetch = async () => {
      if (cancelled) return;
      try {
        const { data } = await supabase
          .from("download_requests")
          .select("id, file_id, status, requested_at, files(file_name)")
          .eq("owner_id", ownerId)
          .eq("status", "pending")
          .gt("expires_at", new Date().toISOString());

        const news = (data || []).filter((r) => !seenRef.current.has(r.id));
        if (news.length && !cancelled) {
          news.forEach((r) => seenRef.current.add(r.id));
          setPending((prev) => [...prev, ...news]);
        }
      } catch (err) {
        console.warn("[useDownloadRequests] error:", err?.message || err);
      }
    };

    fetch();
    const iv = setInterval(fetch, 3000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [ownerId]);

  return { pending, setPending };
}

function getFileIconClass(fileName) {
  const ext = fileName?.split(".")?.pop()?.toLowerCase() || "";
  switch (ext) {
    case "pdf":
      return "fa-file-pdf";
    case "doc":
    case "docx":
      return "fa-file-word";
    case "xls":
    case "xlsx":
      return "fa-file-excel";
    default:
      return "fa-file-lines";
  }
}

function FileList({ files, fileCopies, onSetCopies, onRemove, C, t }) {
  const [expanded, setExpanded] = useState(false);
  const THRESHOLD = 3;
  const visible = expanded ? files : files.slice(0, THRESHOLD);
  const hidden = files.length - THRESHOLD;

  return (
    <div style={{ marginBottom: 12 }}>
      {visible.map((file, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 12px",
            background: "#fff",
            borderRadius: 8,
            marginBottom: 6,
            border: `1px solid ${C.border}`,
          }}
        >
          <span style={{ fontSize: 16, color: "#3b82f6", flexShrink: 0 }}>
            <i className={`fa-solid ${getFileIconClass(file.name)}`} />
          </span>
          <span
            style={{
              flex: 1,
              fontSize: 13,
              color: C.text,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={file.name}
          >
            {file.name}
          </span>
          <button
            onClick={() => onRemove(i)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#9ca3af",
              fontSize: 16,
              padding: "2px 4px",
              flexShrink: 0,
            }}
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
      ))}
      {files.length > THRESHOLD && (
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            width: "100%",
            padding: "8px",
            background: "transparent",
            border: `1px dashed ${C.border}`,
            borderRadius: 8,
            cursor: "pointer",
            color: C.muted,
            fontSize: 13,
            fontFamily: "Inter, sans-serif",
          }}
        >
          {expanded
            ? "▲ Réduire"
            : `▼ Voir ${hidden} autre${hidden > 1 ? "s" : ""} fichier${hidden > 1 ? "s" : ""}`}
        </button>
      )}
    </div>
  );
}

function CountdownPill({ expiresAt }) {
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
  if (remaining === null || remaining <= 0) return null;
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  return (
    <span
      style={{
        background: "rgba(245, 200, 66, 0.15)",
        color: "#f5c842",
        padding: "3px 8px",
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      ⏱ {mins}:{secs.toString().padStart(2, "0")}
    </span>
  );
}

function StatusBadge({ status }) {
  const map = {
    waiting: {
      label: "En attente",
      bg: "#fff8d6",
      color: "#92600a",
      border: "#f5c842",
    },
    printing: {
      label: "Impression…",
      bg: "#dbeafe",
      color: "#1d4ed8",
      border: "#93c5fd",
    },
    completed: {
      label: "Terminé",
      bg: "#dcfce7",
      color: "#166534",
      border: "#86efac",
    },
    rejected: {
      label: "Rejeté",
      bg: "#fee2e2",
      color: "#dc2626",
      border: "#fca5a5",
    },
    partial_rejected: {
      label: "Partiel",
      bg: "#fff3cd",
      color: "#856404",
      border: "#ffc107",
    },
    expired: {
      label: "Expiré",
      bg: "#f3f4f6",
      color: "#6b7280",
      border: "#d1d5db",
    },
  };
  const s = map[status] || map.waiting;
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        border: `1px solid ${s.border}`,
        padding: "3px 10px",
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: "nowrap",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      {status === "printing" && (
        <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: 9 }} />
      )}
      {s.label}
    </span>
  );
}

function GroupCard({ group, onPreview, C, t, history = false }) {
  const [expanded, setExpanded] = useState(false);
  const job = group.print_jobs?.[0];
  const allFiles = group.files || [];

  const remainingFiles = [];
  const historyFiles = [];

  allFiles.forEach((file) => {
    if (
      file.status === "completed" ||
      file.status === "rejected" ||
      file.rejected === true
    ) {
      historyFiles.push(file);
    } else {
      remainingFiles.push(file);
    }
  });

  group.remainingFiles = remainingFiles;
  group.remainingCount = remainingFiles.length;

  const files = history ? historyFiles : remainingFiles;
  const copies = job?.copies_requested || group.copies_count || 1;
  const fileCount = files.length > 0 ? files.length : group.files_count || 0;
  const totalCopies = copies * fileCount;
  const THRESHOLD = 3;
  const visibleFiles = expanded ? files : files.slice(0, THRESHOLD);
  const hiddenCount = Math.max(0, files.length - THRESHOLD);

  const hasPrintingJob = group.print_jobs?.some(
    (job) => job?.status === "printing",
  );
  const haRejectedFile = allFiles.some(
    (f) => f.rejected || f.status === "rejected",
  );
  const allRejected = allFiles.every(
    (f) => f.rejected || f.status === "rejected",
  );
  // ── FIX: Determine displayStatus from actual file state ────────────
  // If ALL files are rejected → show "rejected", not "completed"
  const uiStatus =
    allFiles.length > 0 && allRejected
      ? "rejected"
      : group.remainingCount === 0
        ? "completed"
        : haRejectedFile && !allRejected
          ? "partial"
          : hasPrintingJob
            ? "printing"
            : group.status;
  const statusConfig = {
    waiting: {
      label: t("waiting"),
      bg: "#f5c842",
      color: "#111510",
      border: "#f5c842",
    },
    printing: {
      label: t("printing"),
      bg: "#1d4ed8",
      color: "#fff",
      border: "#1d4ed8",
    },
    completed: {
      label: t("completed"),
      bg: "#6b7280",
      color: "#fff",
      border: "#6b7280",
    },
    rejected: {
      label: t("rejected"),
      bg: "#e53935",
      color: "#fff",
      border: "#e53935",
    },
    partial: {
      label: "Partiel",
      bg: "#fff3cd",
      color: "#856404",
      border: "#ffc107",
    },
    expired: {
      label: t("expired"),
      bg: "#f3f4f6",
      color: "#6b7280",
      border: "#d1d5db",
    },
  };
  const config = statusConfig[uiStatus] || statusConfig.waiting;

  // Un groupe "rejected" ou "completed" va dans l'historique
  const isHistoryGroup =
    history ||
    ["completed", "rejected", "expired", "partial_rejected"].includes(uiStatus);

  return (
    <div
      style={{
        background: isHistoryGroup ? C.surface2 : C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        marginBottom: 10,
        opacity: isHistoryGroup ? 0.85 : 1,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 16px",
          borderBottom: `1px solid ${C.border}`,
          gap: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flex: 1,
            minWidth: 0,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              background: C.greenLight,
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              flexShrink: 0,
              color: C.green,
            }}
          >
            <i
              className={`fa-solid ${isHistoryGroup ? "fa-clipboard-list" : "fa-folder"}`}
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
              {fileCount} fichier{fileCount > 1 ? "s" : ""}
            </div>
            <div
              style={{
                display: "flex",
                gap: 6,
                alignItems: "center",
                marginTop: 4,
                flexWrap: "wrap",
              }}
            >
              <StatusBadge status={uiStatus} />
            </div>
          </div>
        </div>
        <div
          style={{
            background: C.bg,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            padding: "6px 12px",
            textAlign: "center",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              fontSize: 18,
              fontWeight: 800,
              color: C.green,
              lineHeight: 1,
            }}
          >
            {totalCopies}
          </div>
          <div
            style={{
              fontSize: 9,
              color: C.muted,
              fontWeight: 600,
              textTransform: "uppercase",
            }}
          >
            copie{totalCopies > 1 ? "s" : ""}
          </div>
        </div>
      </div>
      {files.length > 0 && (
        <div>
          {visibleFiles.map((f) => (
            <div
              key={f.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 16px",
                borderBottom: `1px solid ${C.border}`,
                background: f.rejected ? "#fdecea" : "transparent",
                borderLeft: f.rejected ? "3px solid #e53935" : "none",
                opacity: f.rejected ? 0.75 : 1,
              }}
            >
              <span
                style={{
                  fontSize: 16,
                  color: f.rejected ? "#e53935" : "#dc2626",
                  flexShrink: 0,
                }}
              >
                <i
                  className={
                    f.rejected ? "fa-solid fa-xmark" : "fa-regular fa-file-pdf"
                  }
                />
              </span>
              <span
                style={{
                  flex: 1,
                  fontSize: 13,
                  color: C.text,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  textDecoration: f.rejected ? "line-through" : "none",
                }}
                title={f.file_name}
              >
                {f.file_name}
              </span>
              {(f.rejected || f.status === "rejected") && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#e53935",
                    background: "#fdecea",
                    padding: "2px 8px",
                    borderRadius: 20,
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  Rejeté — supprimé
                </span>
              )}
              {!f.rejected && f.storage_path && (
                <button
                  onClick={() => onPreview(f.storage_path, f.file_name)}
                  style={{
                    background: C.greenLight,
                    border: "none",
                    borderRadius: 6,
                    padding: "4px 10px",
                    color: C.green,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    flexShrink: 0,
                    fontFamily: "Inter, sans-serif",
                  }}
                >
                  <i className="fa-regular fa-eye" /> Voir
                </button>
              )}
              {f.status === "rejected" && (
                <span
                  style={{
                    background: "#fee2e2",
                    border: "none",
                    borderRadius: 6,
                    padding: "4px 10px",
                    color: "#e53935",
                    fontSize: 12,
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    flexShrink: 0,
                    fontFamily: "Inter, sans-serif",
                  }}
                >
                  <i className="fa-solid fa-xmark-circle" /> Supprimé
                </span>
              )}
            </div>
          ))}
          {files.length > THRESHOLD && (
            <button
              onClick={() => setExpanded(!expanded)}
              style={{
                width: "100%",
                padding: "8px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: C.muted,
                fontSize: 12,
                fontFamily: "Inter, sans-serif",
                borderBottom: `1px solid ${C.border}`,
              }}
            >
              {expanded
                ? "▲ Réduire"
                : `▼ ${hiddenCount} autre${hiddenCount > 1 ? "s" : ""} fichier${hiddenCount > 1 ? "s" : ""}`}
            </button>
          )}
        </div>
      )}
      <div style={{ padding: "10px 16px 14px" }}>
        {/* ── FIX: Use uiStatus (calculated) instead of status (database) ──── */}
        {uiStatus === "waiting" && remainingFiles.length > 0 && (
          <p style={{ color: "#92600a", fontSize: 13, fontWeight: 500 }}>
            <i className="fa-solid fa-hourglass-end" /> {t("waitingMsg")}
          </p>
        )}
        {uiStatus === "printing" && (
          <p style={{ color: "#1d4ed8", fontSize: 13, fontWeight: 500 }}>
            <i className="fa-solid fa-print" /> {t("printingMsg")}
          </p>
        )}
        {uiStatus === "completed" &&
          remainingFiles.length === 0 &&
          !allRejected && (
            <p style={{ color: "#166534", fontSize: 13, fontWeight: 500 }}>
              <i className="fa-solid fa-check" /> {t("completedMsg")}
            </p>
          )}
        {uiStatus === "rejected" && allRejected && (
          <p style={{ color: "#dc2626", fontSize: 13, fontWeight: 500 }}>
            <i className="fa-solid fa-xmark" /> Tous les fichiers ont été
            rejetés
          </p>
        )}
        {uiStatus === "partial" && (
          <p style={{ color: "#856404", fontSize: 13, fontWeight: 500 }}>
            <i className="fa-solid fa-alert-triangle" /> {historyFiles.length}{" "}
            fichier
            {historyFiles.length > 1 ? "s" : ""} rejeté
            {historyFiles.length > 1 ? "s" : ""} — {remainingFiles.length} en
            attente
          </p>
        )}
        {uiStatus === "expired" && (
          <p style={{ color: "#6b7280", fontSize: 13, fontWeight: 500 }}>
            <i className="fa-solid fa-clock" /> {t("expiredMsg")}
          </p>
        )}
      </div>
    </div>
  );
}

function StatusSection({ groups, groupsLoading, onPreview, C, t, onSendMore }) {
  if (groupsLoading)
    return (
      <div
        style={{
          textAlign: "center",
          padding: "20px 0",
          color: C.muted,
          fontSize: 13,
        }}
      >
        <i className="fa-solid fa-spinner fa-spin" style={{ marginRight: 6 }} />
        Chargement...
      </div>
    );

  if (groups.length === 0) return null;

  const activeGroups = [];
  const historyGroups = [];

  groups.forEach((group) => {
    const allFiles = group.files || [];
    const remainingFiles = [];
    const rejectedFiles = [];

    const effectiveStatus = group.print_jobs?.some(
      (job) => job?.status === "printing",
    )
      ? "printing"
      : group.status;

    allFiles.forEach((file) => {
      if (
        file.status === "completed" ||
        file.status === "rejected" ||
        file.rejected === true
      ) {
        rejectedFiles.push(file);
      } else {
        remainingFiles.push(file);
      }
    });

    group.remainingFiles = remainingFiles;
    group.remainingCount = remainingFiles.length;

    // ── FIX: Calculate if ALL files are rejected ──────────────────
    const allRejected =
      allFiles.length > 0 &&
      allFiles.every((f) => f.rejected || f.status === "rejected");

    // Move to history if:
    // 1. Database says so, OR
    // 2. ALL files are rejected (even if DB is still "waiting")
    if (
      effectiveStatus === "completed" ||
      effectiveStatus === "rejected" ||
      effectiveStatus === "expired" ||
      allRejected
    ) {
      historyGroups.push(group);
    } else if (remainingFiles.length > 0) {
      activeGroups.push(group);
    }

    // Also add partial rejections to history
    if (
      rejectedFiles.length > 0 &&
      remainingFiles.length === 0 &&
      !allRejected
    ) {
      const historyGroup = {
        ...group,
        files: rejectedFiles,
        remainingCount: 0,
      };
      historyGroups.push(historyGroup);
    }
  });

  return (
    <div style={{ marginTop: 24 }}>
      <hr
        style={{
          border: "none",
          borderTop: `1px solid ${C.border}`,
          marginBottom: 20,
        }}
      />
      {activeGroups.length > 0 && (
        <section className="active-section">
          <h3
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: C.text,
              marginBottom: 12,
            }}
          >
            {t("myFiles")}{" "}
            <span
              style={{
                background: C.yellow,
                color: C.green,
                borderRadius: 20,
                padding: "2px 8px",
                fontSize: 11,
                fontWeight: 700,
                marginLeft: 8,
              }}
            >
              {activeGroups.length}
            </span>
          </h3>
          <div className="active-list">
            {activeGroups.map((g) => (
              <GroupCard
                key={`active-${g.id}`}
                group={g}
                onPreview={onPreview}
                C={C}
                t={t}
              />
            ))}
          </div>
        </section>
      )}
      {historyGroups.length > 0 && (
        <section
          className="history-section"
          style={{ marginTop: activeGroups.length > 0 ? 20 : 0 }}
        >
          <h3
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: C.muted,
              marginBottom: 10,
            }}
          >
            {t("history")}
          </h3>
          <div className="history-list">
            {historyGroups.map((g) => (
              <GroupCard
                key={`history-${g.id}`}
                group={g}
                onPreview={onPreview}
                C={C}
                t={t}
                history
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

const MAX_FILES = 20;
const MAX_SIZE_MB = 100;

// Composant: Notification demande téléchargement
function DownloadRequestNotif({ req, onRespond, C }) {
  const [loading, setLoading] = useState(false);
  const fileName = req.files?.file_name || "votre fichier";

  async function respond(approved) {
    setLoading(true);
    await supabase
      .from("download_requests")
      .update({
        status: approved ? "approved" : "rejected",
        responded_at: new Date().toISOString(),
      })
      .eq("id", req.id);
    onRespond(req.id);
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: 20,
        left: 12,
        right: 12,
        zIndex: 9500,
        background: "#fff",
        borderRadius: 14,
        padding: "16px 18px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        border: `2px solid ${C.yellow}`,
        fontFamily: "Inter, sans-serif",
      }}
    >
      <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            flexShrink: 0,
            background: "#fff3cd",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 18,
            color: "#856404",
          }}
        >
          <i className="fa-solid fa-download" />
        </div>
        <div>
          <p
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: C.text,
              marginBottom: 4,
            }}
          >
            Demande de téléchargement
          </p>
          <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.5 }}>
            L'imprimeur souhaite télécharger{" "}
            <strong style={{ color: C.text }}>{fileName}</strong> pour le
            modifier. Autorisez-vous ?
          </p>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={() => respond(false)}
          disabled={loading}
          style={{
            flex: 1,
            padding: "10px",
            borderRadius: 8,
            cursor: "pointer",
            border: "1px solid #fca5a5",
            background: "#fee2e2",
            color: "#dc2626",
            fontWeight: 700,
            fontSize: 13,
            fontFamily: "Inter, sans-serif",
          }}
        >
          <i className="fa-solid fa-xmark" /> Refuser
        </button>
        <button
          onClick={() => respond(true)}
          disabled={loading}
          style={{
            flex: 1,
            padding: "10px",
            borderRadius: 8,
            cursor: "pointer",
            border: "none",
            background: C.green,
            color: "#fff",
            fontWeight: 700,
            fontSize: 13,
            fontFamily: "Inter, sans-serif",
          }}
        >
          {loading ? (
            <i className="fa-solid fa-spinner fa-spin" />
          ) : (
            <>
              <i className="fa-solid fa-check" /> Autoriser
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default function PrinterSPA({ showToast }) {
  const [slug, setSlug] = useState(null);
  const [page, setPage] = useState("loading");
  const [printer, setPrinter] = useState(null);
  const [session, setSession] = useState(null);
  const [selected, setSelected] = useState([]);
  const [fileCopies, setFileCopies] = useState({});
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [lang, setLangState] = useState(() =>
    typeof window !== "undefined"
      ? localStorage.getItem("dw_lang") || "fr"
      : "fr",
  );
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewName, setPreviewName] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const fileInputRef = useRef(null);
  const uploadingRef = useRef(false);
  const t = useTranslation(lang);
  const ownerId = session?.owner_id || null;
  const { groups, loading: groupsLoading } = usePrintStatus(ownerId);
  const { pending: dlRequests, setPending: setDlRequests } =
    useDownloadRequests(session?.owner_id);
  const notifiedExpiredRef = useRef(new Set());

  function setLang(l) {
    setLangState(l);
    if (typeof window !== "undefined") localStorage.setItem("dw_lang", l);
  }

  function getFileKey(file) {
    if (!slug || !file || !file.name) return null;
    return `${slug}_${file.name}_${file.size}_${file.lastModified || 0}`;
  }

  function getFileCopy(file, index) {
    const cacheKey = getFileKey(file);
    if (typeof window !== "undefined" && cacheKey) {
      const stored = localStorage.getItem(cacheKey);
      if (stored) {
        return Math.max(1, Math.min(20, parseInt(stored, 10) || 1));
      }
    }
    return fileCopies[cacheKey] || fileCopies[index] || 1;
  }

  function setFileCopy(file, val, index) {
    const newVal = Math.max(1, Math.min(20, val));
    const cacheKey = getFileKey(file);
    setFileCopies((prev) => ({
      ...prev,
      [cacheKey || index]: newVal,
    }));

    if (typeof window !== "undefined" && cacheKey) {
      localStorage.setItem(cacheKey, String(newVal));
    }
  }

  useEffect(() => {
    let mounted = true;
    const s = extractSlug();
    if (!s) {
      if (mounted) setPage("notfound");
      return () => {
        mounted = false;
      };
    }
    getPrinterBySlug(s).then((printerData) => {
      if (!mounted) return;
      if (!printerData) {
        setPage("notfound");
        return;
      }
      setPrinter(printerData);
      setSlug(s);
      let sess = loadSession(s);
      if (!sess) {
        sess = createAnonymousSession({
          printer_slug: s,
          printer_id: printerData.id,
          printer_name: printerData.name,
        });
      }
      setSession(sess);
      setPage("home");
    });
    return () => {
      mounted = false;
    };
  }, []);

  // ═══════════════════════════════════════════════════════════════
  // SECURITY PROTECTIONS FOR SECURE PRINTING SaaS
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    const isDev =
      typeof window !== "undefined" &&
      (window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1");

    // Disable right-click context menu
    const handleContextMenu = (e) => {
      e.preventDefault();
      return false;
    };

    // Disable keyboard shortcuts
    const handleKeyDown = (e) => {
      // Ctrl+S (Save)
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        return false;
      }
      // Ctrl+P (Print)
      if ((e.ctrlKey || e.metaKey) && e.key === "p") {
        e.preventDefault();
        return false;
      }
      // Ctrl+C (Copy) - allow only on input/textarea
      if ((e.ctrlKey || e.metaKey) && e.key === "c") {
        if (!["INPUT", "TEXTAREA"].includes(e.target.tagName)) {
          e.preventDefault();
          return false;
        }
      }
      // F12 (DevTools)
      if (e.key === "F12" && !isDev) {
        e.preventDefault();
        return false;
      }
      // Ctrl+Shift+I (DevTools)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "I" && !isDev) {
        e.preventDefault();
        return false;
      }
      // Ctrl+Shift+C (DevTools Inspector)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "C" && !isDev) {
        e.preventDefault();
        return false;
      }
      // Ctrl+Shift+J (DevTools Console)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "J" && !isDev) {
        e.preventDefault();
        return false;
      }
      // Right-click menu key
      if (e.key === "ContextMenu") {
        e.preventDefault();
        return false;
      }
    };

    // Prevent text selection outside inputs
    const handleSelectStart = (e) => {
      if (!["INPUT", "TEXTAREA"].includes(e.target.tagName)) {
        e.preventDefault();
        return false;
      }
    };

    // Prevent drag operations for file downloads
    const handleDragOver = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleDrop = (e) => {
      // Allow drops only on designated drop zones
      const fileInputArea = document.querySelector(
        '[data-name="file-input-area"]',
      );
      if (!fileInputArea || !fileInputArea.contains(e.target)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // Prevent iframe download attempts
    const handleBeforeUnload = (e) => {
      // This doesn't actually block, but logs suspicious activity
      if (document.readyState === "complete") {
        console.log("[SECURITY] Suspicious unload detected");
      }
    };

    // Add event listeners
    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("selectstart", handleSelectStart);
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("drop", handleDrop);
    window.addEventListener("beforeunload", handleBeforeUnload);

    // Disable inspector in DevTools
    if (typeof window !== "undefined") {
      // Override console methods to prevent direct API calls
      const originalLog = console.log;
      const originalError = console.error;
      const originalWarn = console.warn;

      console.log = function (...args) {
        if (
          args[0] &&
          typeof args[0] === "string" &&
          (args[0].includes("supabase") ||
            args[0].includes("API") ||
            args[0].includes("key"))
        ) {
          return; // Block potentially sensitive logs
        }
        return originalLog.apply(console, args);
      };

      console.error = function (...args) {
        if (
          args[0] &&
          typeof args[0] === "string" &&
          (args[0].includes("supabase") ||
            args[0].includes("API") ||
            args[0].includes("key"))
        ) {
          return; // Block potentially sensitive logs
        }
        return originalError.apply(console, args);
      };

      console.warn = function (...args) {
        if (
          args[0] &&
          typeof args[0] === "string" &&
          (args[0].includes("supabase") ||
            args[0].includes("API") ||
            args[0].includes("key"))
        ) {
          return; // Block potentially sensitive logs
        }
        return originalWarn.apply(console, args);
      };
    }

    // Cleanup
    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("selectstart", handleSelectStart);
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("drop", handleDrop);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  // 🔥 Cleanup blob URLs when preview closes (prevent memory leaks)
  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  // ─ Monitor expired groups and show notification ─────────────────
  useEffect(() => {
    if (!groups || groups.length === 0) return;

    groups.forEach((g) => {
      if (g.status === "expired" && !notifiedExpiredRef.current.has(g.id)) {
        notifiedExpiredRef.current.add(g.id);
        const fileCount = g.files_count || g.files?.length || "Vos";
        showToast?.(
          `⏰ ${fileCount} fichier(s) expiré(s) — renvoyez-les`,
          "warning",
        );
      }
    });
  }, [groups, showToast]);

  function addFiles(newFiles) {
    // Supported file types: PDF, Word, Excel
    const SUPPORTED_TYPES = [
      "application/pdf",
      "application/msword", // .doc
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
      "application/vnd.ms-excel", // .xls
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
    ];

    // Also check by file extension for Android compatibility
    const isValidByExtension = (filename) => {
      const ext = filename.split(".").pop().toLowerCase();
      return ["pdf", "doc", "docx", "xls", "xlsx"].includes(ext);
    };

    const validFiles = Array.from(newFiles).filter((f) => {
      const isSupportedType =
        SUPPORTED_TYPES.includes(f.type) || isValidByExtension(f.name);
      if (!isSupportedType) {
        showToast?.(
          `"${f.name}" - type non supporté. Utilisez PDF, Word ou Excel.`,
          "error",
        );
        return false;
      }
      if (f.size > MAX_SIZE_MB * 1024 * 1024) {
        showToast?.(`"${f.name}" dépasse ${MAX_SIZE_MB}MB`, "error");
        return false;
      }
      return true;
    });

    setSelected((prev) => {
      const combined = [...prev, ...validFiles];
      if (combined.length > MAX_FILES) {
        showToast?.(`Maximum ${MAX_FILES} fichiers`, "error");
        return combined.slice(0, MAX_FILES);
      }
      return combined;
    });
  }

  function removeFile(i) {
    const removed = selected[i];
    setSelected((prev) => prev.filter((_, idx) => idx !== i));
    if (removed) {
      const cacheKey = getFileKey(removed);
      if (cacheKey) {
        setFileCopies((prev) => {
          const next = { ...prev };
          delete next[cacheKey];
          return next;
        });
      }
    }
  }

  async function handlePreview(storagePath, fileName) {
    setPreviewName(fileName);
    setPreviewLoading(true);
    setPreviewUrl("loading");
    try {
      const isPdf = /\.pdf$/i.test(fileName || "");
      const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(fileName || "");
      const isWord = /\.(doc|docx)$/i.test(fileName || "");
      const isExcel = /\.(xls|xlsx)$/i.test(fileName || "");
      const isPowerPoint = /\.(ppt|pptx)$/i.test(fileName || "");
      const needsGoogleViewer = isWord || isExcel || isPowerPoint;

      if (needsGoogleViewer) {
        // For Office docs, use signed URL with Google Viewer
        const { data } = await supabase.storage
          .from("derewol-files")
          .createSignedUrl(storagePath, 120);

        if (data?.signedUrl) {
          const encodedUrl = encodeURIComponent(data.signedUrl);
          const viewerUrl = `https://docs.google.com/gview?embedded=true&url=${encodedUrl}`;
          setPreviewUrl(viewerUrl);
        } else {
          setPreviewUrl(null);
        }
      } else if (isPdf) {
        // 🔥 For PDFs: Fetch as blob and create blob URL to prevent browser controls
        const { data: blob, error: dlError } = await supabase.storage
          .from("derewol-files")
          .download(storagePath);

        if (dlError || !blob) {
          console.error("PDF download failed:", dlError);
          setPreviewUrl(null);
          return;
        }

        // Create blob URL (prevents browser default PDF viewer controls)
        const blobUrl = URL.createObjectURL(blob);
        setPreviewUrl(blobUrl);
      } else if (isImage) {
        // For images, use signed URL
        const { data } = await supabase.storage
          .from("derewol-files")
          .createSignedUrl(storagePath, 120);

        if (data?.signedUrl) {
          setPreviewUrl(data.signedUrl);
        } else {
          setPreviewUrl(null);
        }
      } else {
        // For other file types, use Google Viewer
        const { data } = await supabase.storage
          .from("derewol-files")
          .createSignedUrl(storagePath, 120);

        if (data?.signedUrl) {
          const encodedUrl = encodeURIComponent(data.signedUrl);
          const viewerUrl = `https://docs.google.com/gview?embedded=true&url=${encodedUrl}`;
          setPreviewUrl(viewerUrl);
        } else {
          setPreviewUrl(null);
        }
      }
    } catch (err) {
      console.error("Preview error:", err);
      setPreviewUrl(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleUpload() {
    if (
      !selected.length ||
      uploading ||
      uploadingRef.current ||
      !printer ||
      !session
    )
      return;
    uploadingRef.current = true;
    setUploading(true);
    try {
      const groupId = await createFileGroup({
        ownerId: session.owner_id,
        printerId: printer.id,
      });
      for (let i = 0; i < selected.length; i++) {
        await uploadFileToGroup({
          file: selected[i],
          groupId,
          ownerId: session.owner_id,
          printerId: printer.id,
          copies: getFileCopy(selected[i], i),
        });
      }
      await updateFilesCount(groupId, selected.length);
      showToast?.(t("sending"));
      setSelected([]);
      setFileCopies({});
    } catch (err) {
      showToast?.(err.message || "Erreur lors de l'envoi", "error");
    } finally {
      setUploading(false);
      uploadingRef.current = false;
    }
  }

  const spinnerStyle = {
    display: "inline-block",
    width: 14,
    height: 14,
    border: "2px solid rgba(30, 77, 43, 0.3)",
    borderTop: `2px solid ${C.green}`,
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  };

  if (page === "loading") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          padding: 16,
          background: C.bg,
        }}
      >
        <div
          style={{
            background: C.surface,
            padding: "40px 32px",
            maxWidth: 400,
            width: "100%",
            borderRadius: 12,
            textAlign: "center",
            border: `1px solid ${C.border}`,
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 12 }}>
            <i className="fa-solid fa-spinner fa-spin" />
          </div>
          <p style={{ color: C.muted, fontSize: 14 }}>{t("connecting")}</p>
        </div>
      </div>
    );
  }

  if (page === "notfound") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          padding: 16,
          background: C.bg,
        }}
      >
        <div
          style={{
            background: C.surface,
            padding: "40px 32px",
            maxWidth: 400,
            width: "100%",
            textAlign: "center",
            borderRadius: 12,
            border: `1px solid ${C.border}`,
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 16 }}>
            <i className="fa-solid fa-magnifying-glass" />
          </div>
          <h2
            style={{
              marginBottom: 8,
              fontSize: 20,
              fontWeight: 700,
              color: C.text,
            }}
          >
            {t("notFound")}
          </h2>
          <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.6 }}>
            {t("notFoundDesc")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 100,
          background: C.green,
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontFamily: "Inter, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 24,
              height: 24,
              background: C.yellow,
              borderRadius: 6,
            }}
          />
          <span
            style={{
              color: "#fff",
              fontSize: 15,
              fontWeight: 700,
              fontFamily: "Inter, sans-serif",
            }}
          >
            Derew<b style={{ color: C.yellow }}>ol</b>
          </span>
        </div>
        {printer && (
          <span
            style={{
              color: "rgba(255,255,255,0.85)",
              fontSize: 13,
              fontWeight: 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: "40%",
              textAlign: "center",
            }}
          >
            <i className="fa-solid fa-print" /> {printer.name}
          </span>
        )}
        {/* Badge session — affiche le owner_id stable du client anonymisé */}
        {(session?.owner_id || session?.display_code) && (
          <span
            style={{
              background: C.yellow,
              color: C.green,
              padding: "4px 12px",
              borderRadius: 8,
              fontFamily: "monospace",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            {session.owner_id || session.display_code}
          </span>
        )}
        <div style={{ position: "relative" }}>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            style={{
              background: "rgba(255,255,255,0.15)",
              border: "1px solid rgba(255,255,255,0.3)",
              color: "#fff",
              borderRadius: 6,
              padding: "4px 8px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "Inter, sans-serif",
              appearance: "none",
              paddingRight: 20,
            }}
          >
            <option value="fr" style={{ background: C.green }}>
              fr
            </option>
            <option value="en" style={{ background: C.green }}>
              en
            </option>
            <option value="wo" style={{ background: C.green }}>
              wo
            </option>
          </select>
        </div>
      </header>

      <main
        style={{
          padding: "16px",
          maxWidth: 480,
          margin: "0 auto",
          width: "100%",
          fontFamily: "Inter, sans-serif",
        }}
      >
        <div
          data-name="file-input-area"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }}
          style={{
            border: `2px dashed ${dragging ? C.green : C.border}`,
            borderRadius: 14,
            padding: "32px 20px",
            textAlign: "center",
            cursor: "pointer",
            background: dragging ? C.greenLight : C.surface,
            transition: "all 0.2s",
            marginBottom: 12,
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,.xls,.xlsx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            multiple
            style={{ display: "none" }}
            onChange={(e) => addFiles(e.target.files)}
          />
          <div style={{ fontSize: 32, marginBottom: 10 }}>
            <i className="fa-solid fa-link" />
          </div>
          <p
            style={{
              color: C.text,
              fontSize: 15,
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            {t("dropHere")}
          </p>
          <p style={{ color: C.muted, fontSize: 13 }}>
            {t("orClick")} · {t("maxFiles", { n: MAX_FILES - selected.length })}
          </p>
        </div>

        {selected.length > 0 && (
          <FileList
            files={selected}
            fileCopies={fileCopies}
            onSetCopies={setFileCopy}
            onRemove={removeFile}
            C={C}
            t={t}
          />
        )}

        {selected.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
              background: C.surface2,
              borderRadius: 8,
              marginBottom: 12,
            }}
          >
            <span style={{ color: C.muted, fontSize: 13 }}>
              {t("totalCopies")}
            </span>
            <span style={{ color: C.green, fontWeight: 800, fontSize: 18 }}>
              {selected.reduce((sum, file, i) => sum + getFileCopy(file, i), 0)}
            </span>
          </div>
        )}

        <button
          onClick={handleUpload}
          disabled={!selected.length || uploading}
          style={{
            width: "100%",
            padding: "15px",
            background: selected.length && !uploading ? C.yellow : "#e5e5e5",
            color: selected.length && !uploading ? C.green : C.muted,
            border: "none",
            borderRadius: 12,
            fontSize: 15,
            fontWeight: 700,
            cursor: selected.length && !uploading ? "pointer" : "not-allowed",
            fontFamily: "Inter, sans-serif",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            transition: "all 0.2s",
          }}
        >
          {uploading ? (
            <>
              {" "}
              <span style={spinnerStyle} /> {t("sending")}
            </>
          ) : (
            <>
              {" "}
              <i className="fa-solid fa-paper-plane" /> {t("sendBtn")}
            </>
          )}
        </button>

        <p
          style={{
            textAlign: "center",
            fontSize: 11,
            color: C.muted,
            marginTop: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
          }}
        >
          <i className="fa-solid fa-lock" /> {t("securityNote")}
        </p>

        <StatusSection
          groups={groups}
          groupsLoading={groupsLoading}
          onPreview={handlePreview}
          C={C}
          t={t}
          onSendMore={() => fileInputRef.current?.click()}
        />
      </main>

      {previewUrl && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setPreviewUrl(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setPreviewUrl(null);
          }}
          role="dialog"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 9999,
            background: "rgba(0,0,0,0.9)",
            display: "flex",
            flexDirection: "column",
            WebkitUserSelect: "none",
            userSelect: "none",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 16px",
              background: C.green,
              flexShrink: 0,
              WebkitFlexShrink: 0,
            }}
          >
            <span
              style={{
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
              }}
            >
              <i className={`fa-solid ${getFileIconClass(previewName)}`} />{" "}
              {previewName}
            </span>
            <button
              onClick={() => setPreviewUrl(null)}
              type="button"
              aria-label="Close preview"
              style={{
                background: "rgba(255,255,255,0.2)",
                border: "none",
                color: "#fff",
                width: 32,
                height: 32,
                borderRadius: "50%",
                cursor: "pointer",
                fontSize: 18,
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.3)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.2)";
              }}
            >
              <i className="fa-solid fa-xmark" />
            </button>
          </div>
          <div
            style={{
              flex: 1,
              overflow: "auto",
              WebkitOverflowScrolling: "touch",
              display: "flex",
              flexDirection: "column",
              position: "relative",
            }}
          >
            {previewLoading || previewUrl === "loading" ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "100%",
                  color: "#fff",
                  fontSize: 14,
                }}
              >
                <i className="fa-solid fa-spinner fa-spin" /> Chargement...
              </div>
            ) : (
              <>
                {/* 🔥 SECURITY: Comprehensive download blocking - MULTIPLE LAYERS */}
                {/* Layer 1: Full-screen interactive overlay - blocks ALL mouse/touch events to iframe */}
                <div
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    return false;
                  }}
                  onTouchStart={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    return false;
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    return false;
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    return false;
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    return false;
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    return false;
                  }}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: "150px",
                    zIndex: 9999,
                    background: C.green,
                    pointerEvents: "auto",
                    cursor: "not-allowed",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "white",
                    fontSize: 12,
                    fontWeight: "bold",
                  }}
                >
                  🔒 Download désactivé
                </div>
                {/* Layer 2: Full-screen overlay below toolbar - blocks any interaction */}
                <div
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onTouchStart={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onContextMenu={(e) => e.preventDefault()}
                  onDrop={(e) => e.preventDefault()}
                  onDragOver={(e) => e.preventDefault()}
                  style={{
                    position: "absolute",
                    top: 150,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    zIndex: 998,
                    pointerEvents: "auto",
                  }}
                />
                {/* Layer 3: iframe with maximum sandbox restrictions */}
                <iframe
                  src={
                    previewUrl?.includes("#") || previewUrl?.includes("?")
                      ? previewUrl + "&toolbar=0&navpanes=0"
                      : previewUrl + "#toolbar=0&navpanes=0"
                  }
                  style={{
                    width: "100%",
                    flex: 1,
                    border: "none",
                    background: "#fff",
                    minHeight: "400px",
                    position: "relative",
                    zIndex: 1,
                    pointerEvents: "none",
                  }}
                  title={previewName}
                  sandbox="allow-same-origin"
                  referrerPolicy="no-referrer"
                  onError={() => {
                    setPreviewUrl(null);
                  }}
                />
              </>
            )}
          </div>
        </div>
      )}

      {/* Notifications demandes teléchargement */}
      {dlRequests.map((req) => (
        <DownloadRequestNotif
          key={req.id}
          req={req}
          C={C}
          onRespond={(id) =>
            setDlRequests((prev) => prev.filter((r) => r.id !== id))
          }
        />
      ))}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
