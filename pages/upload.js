import { useState } from "react";
import useUpload from "../hooks/useUpload";

export default function Upload() {
  const [selected, setSelected] = useState([]);
  const { uploadFiles, loading } = useUpload();
  const [message, setMessage] = useState("");

  // Récupérer la session depuis localStorage
  const session = JSON.parse(localStorage.getItem("derewol_session"));
  const displayId = session?.display_id;

  // Fonction pour déclencher l'upload
  async function handleUpload() {
    if (!selected.length) {
      setMessage("⚠️ Aucun fichier sélectionné");
      return;
    }

    try {
      // On transforme FileList en Array
      const filesArray = Array.from(selected);

      // On envoie avec displayId pour backend
      await uploadFiles(filesArray, displayId);

      // Reset state et message
      setMessage(`✅ ${filesArray.length} fichier(s) envoyés !`);
      setSelected([]);
    } catch (err) {
      console.error(err);
      setMessage("❌ Erreur lors de l'envoi, réessayez.");
    }
  }

  return (
    <div className="container">
      <h2>Upload vos fichiers</h2>

      <input
        type="file"
        multiple
        onChange={(e) => setSelected(e.target.files)}
      />

      {/* Liste des fichiers sélectionnés */}
      {selected.length > 0 && (
        <ul>
          {Array.from(selected).map((file) => (
            <li key={file.name}>
              {file.name} ({(file.size / 1024).toFixed(1)} Ko)
            </li>
          ))}
        </ul>
      )}

      <button onClick={handleUpload} disabled={loading}>
        {loading ? "Envoi..." : "Envoyer"}
      </button>

      {/* Message de statut */}
      {message && <p>{message}</p>}
    </div>
  );
}
