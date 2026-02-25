import { useState } from "react";
import useUpload from "../hooks/useUpload";
import useSession from "../hooks/useSession";
import { useRouter } from "next/router";

const MAX_FILES = 5;
const MAX_SIZE_MB = 10;

export default function Upload({ showToast }) {
  const { session, ready } = useSession();
  const [selected, setSelected] = useState([]);
  const { uploadFiles, loading } = useUpload();
  const router = useRouter();

  // Bloque render jusqu'à vérification session
  if (!ready || !session) return null;

  function addFiles(newFiles) {
    const pdfs = Array.from(newFiles).filter(f => f.type === "application/pdf");
    const valid = pdfs.filter(f => {
      if (f.size > MAX_SIZE_MB * 1024 * 1024) {
        showToast(`"${f.name}" dépasse ${MAX_SIZE_MB}MB`, "error");
        return false;
      }
      return true;
    });
    setSelected(prev => {
      const combined = [...prev, ...valid];
      if (combined.length > MAX_FILES) {
        showToast(`Maximum ${MAX_FILES} fichiers par envoi`, "error");
        return combined.slice(0, MAX_FILES);
      }
      return combined;
    });
  }

  function handleDragOver(e) { e.preventDefault(); e.stopPropagation(); }
  function handleDrop(e) { e.preventDefault(); e.stopPropagation(); addFiles(e.dataTransfer.files); }
  function handleFileChange(e) { addFiles(e.target.files); }
  function removeFile(index) { setSelected(prev => prev.filter((_, i) => i !== index)); }

  async function handleUpload() {
    if (!selected.length || loading) return;
    const result = await uploadFiles(selected);
    if (result?.success) {
      showToast("Fichiers envoyés !");
      router.push("/dashboard");
    } else {
      showToast(result?.message || "Erreur lors de l'envoi", "error");
    }
  }

  const remaining = MAX_FILES - selected.length;

  return (
    <div className="container">
      <div className="upload-card">

        <div className="header">
          <h2>Envoyer vos fichiers</h2>
          <div className="session-info">
            <span>ID : {session.display_id}</span>
            <span>📱 {session.phone}</span>
          </div>
        </div>

        {selected.length < MAX_FILES && (
          <div
            className="drop-zone"
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onClick={() => document.getElementById("file-input").click()}
          >
            <input
              id="file-input" type="file" accept="application/pdf"
              multiple style={{ display: "none" }} onChange={handleFileChange}
            />
            <p className="drop-title">Glissez vos PDF ici</p>
            <span className="drop-sub">
              ou cliquez · {remaining} fichier{remaining > 1 ? "s" : ""} restant{remaining > 1 ? "s" : ""}
            </span>
          </div>
        )}

        {selected.length > 0 && (
          <div className="file-list">
            {selected.map((file, index) => (
              <div key={index} className="file-item">
                <span title={file.name}>{file.name}</span>
                <button onClick={() => removeFile(index)} aria-label="Supprimer">✕</button>
              </div>
            ))}
          </div>
        )}

        {selected.length > 0 && (
          <p className="files-count">{selected.length}/{MAX_FILES} fichier{selected.length > 1 ? "s" : ""}</p>
        )}

        <button
          onClick={handleUpload}
          disabled={!selected.length || loading}
          className="upload-btn"
        >
          {loading ? "Envoi en cours..." : "Envoyer à l'imprimeur"}
        </button>

        <div className="security-note">
          <small>🔒 Fichiers supprimés automatiquement après impression</small>
        </div>

      </div>
    </div>
  );
}