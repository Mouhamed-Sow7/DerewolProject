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
  const [loading, setLoading] = useState(true);
  const fetchGroups = useCallback(async () => {
    if (!ownerId) return;
    const data = await fetchGroupsByOwner(ownerId);
    setGroups(data);
    setLoading(false);
  }, [ownerId]);
  useEffect(() => {
    fetchGroups();
    const interval = setInterval(fetchGroups, 3000);
    return () => clearInterval(interval);
  }, [fetchGroups]);
  return { groups, loading };
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

function GroupCard({ group, onPreview, C, t, history = false }) {
  const [expanded, setExpanded] = useState(false);
  const job = group.print_jobs?.[0];
  const allFiles = group.files || [];
  const status = group.status;

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

  const haRejectedFile = allFiles.some(
    (f) => f.rejected || f.status === "rejected",
  );
  const allRejected = allFiles.every(
    (f) => f.rejected || f.status === "rejected",
  );
  const uiStatus =
    group.remainingCount === 0
      ? "completed"
      : haRejectedFile && !allRejected
        ? "partial"
        : status;
  const statusConfig = {
    waiting: {
      label: t("waiting"),
      bg: "#fff8d6",
      color: "#92600a",
      dot: "#f5c842",
      icon: "fa-clock",
    },
    printing: {
      label: t("printing"),
      bg: "#dbeafe",
      color: "#1d4ed8",
      dot: "#3b82f6",
      icon: "fa-spinner",
    },
    completed: {
      label: t("completed"),
      bg: "#dcfce7",
      color: "#166534",
      dot: "#22c55e",
      icon: "fa-check-circle",
    },
    rejected: {
      label: t("rejected"),
      bg: "#fee2e2",
      color: "#dc2626",
      dot: "#ef4444",
      icon: "fa-exclamation-circle",
    },
    expired: {
      label: t("expired"),
      bg: "#f3f4f6",
      color: "#6b7280",
      dot: "#9ca3af",
      icon: "fa-clock",
    },
  };
  const sc = statusConfig[status] || statusConfig.waiting;
  return (
    <div
      style={{
        background: history ? C.surface2 : C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        marginBottom: 10,
        opacity: history ? 0.85 : 1,
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
              className={`fa-solid ${history ? "fa-clipboard-list" : "fa-folder"}`}
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
              <span
                style={{
                  background: uiStatus === "partial" ? "#fef5d6" : sc.bg,
                  color: uiStatus === "partial" ? "#856404" : sc.color,
                  padding: "3px 10px",
                  borderRadius: 20,
                  fontSize: 11,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <i
                  className={`fa-solid ${uiStatus === "partial" ? "fa-alert-triangle" : sc.icon}`}
                  style={{ fontSize: 11 }}
                />
                {uiStatus === "partial" ? "Partiellement rejeté" : sc.label}
              </span>
              {haRejectedFile && !allRejected && (
                <span
                  style={{
                    fontSize: 10,
                    color: "#e53935",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    marginLeft: 4,
                  }}
                >
                  <i className="fa-solid fa-alert-triangle" /> Fichier supprimé
                </span>
              )}
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
      <div style={{ padding: "10px 16px" }}>
        {status === "waiting" && (
          <p style={{ color: "#92600a", fontSize: 13, fontWeight: 500 }}>
            <i className="fa-solid fa-hourglass-end" /> {t("waitingMsg")}
          </p>
        )}
        {status === "printing" && (
          <p style={{ color: "#1d4ed8", fontSize: 13, fontWeight: 500 }}>
            <i className="fa-solid fa-print" /> {t("printingMsg")}
          </p>
        )}
        {status === "completed" && (
          <p style={{ color: "#166534", fontSize: 13, fontWeight: 500 }}>
            <i className="fa-solid fa-check" /> {t("completedMsg")}
          </p>
        )}
        {status === "rejected" && (
          <p style={{ color: "#dc2626", fontSize: 13, fontWeight: 500 }}>
            <i className="fa-solid fa-xmark" /> {t("rejectedMsg")}
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
        {status === "expired" && (
          <p style={{ color: "#6b7280", fontSize: 13, fontWeight: 500 }}>
            <i className="fa-solid fa-clock" /> {t("expiredMsg")}
          </p>
        )}
      </div>
    </div>
  );
}

function StatusSection({ groups, groupsLoading, onPreview, C, t, onSendMore }) {
  if (groupsLoading) return null;

  if (groups.length === 0) return null;

  const activeGroups = [];
  const historyGroups = [];

  groups.forEach((group) => {
    const allFiles = group.files || [];
    const remainingFiles = [];
    const rejectedFiles = [];

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

    if (
      group.status === "completed" ||
      group.status === "rejected" ||
      group.status === "expired"
    ) {
      historyGroups.push(group);
    } else if (remainingFiles.length > 0) {
      activeGroups.push(group);
    }

    if (rejectedFiles.length > 0) {
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
        <section>
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
          {activeGroups.map((g) => (
            <GroupCard
              key={`active-${g.id}`}
              group={g}
              onPreview={onPreview}
              C={C}
              t={t}
            />
          ))}
        </section>
      )}
      {historyGroups.length > 0 && (
        <section style={{ marginTop: activeGroups.length > 0 ? 20 : 0 }}>
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
        </section>
      )}
    </div>
  );
}

const MAX_FILES = 20;
const MAX_SIZE_MB = 10;

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
      const { data } = await supabase.storage
        .from("derewol-files")
        .createSignedUrl(storagePath, 120);

      if (data?.signedUrl) {
        const isPdf = /\.pdf$/i.test(fileName || "");
        const openDirectly = /Android/i.test(navigator.userAgent) || !isPdf;

        if (openDirectly) {
          window.open(data.signedUrl, "_blank");
          setPreviewUrl(null);
        } else {
          setPreviewUrl(data.signedUrl);
        }
      } else {
        setPreviewUrl(null);
      }
    } catch {
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
              🇫🇷 FR
            </option>
            <option value="en" style={{ background: C.green }}>
              🇬🇧 EN
            </option>
            <option value="wo" style={{ background: C.green }}>
              🇸🇳 WO
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
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(0,0,0,0.85)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 16px",
              background: C.green,
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
              }}
            >
              <i className="fa-solid fa-xmark" />
            </button>
          </div>
          <div style={{ flex: 1, overflow: "hidden" }}>
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
              <iframe
                src={previewUrl}
                style={{ width: "100%", height: "100%", border: "none" }}
                title={previewName}
              />
            )}
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
