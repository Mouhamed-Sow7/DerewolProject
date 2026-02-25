import { useState } from "react";
import { useRouter } from "next/router";
import { generateGuestId, saveSession } from "../lib/helpers";
import { createUserIfNotExists } from "../lib/supabase";

// ── Validation numéro Sénégal ─────────────────────────────────
function isValidSenegalPhone(phone) {
  const cleaned = phone.replace(/[\s\-\+]/g, '');
  if (cleaned.startsWith('221')) {
    return /^221(70|75|76|77|78)\d{7}$/.test(cleaned);
  }
  return /^(70|75|76|77|78)\d{7}$/.test(cleaned);
}

export default function Home() {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const handleContinue = async () => {
    const trimmedPhone = phone.trim();

    if (!trimmedPhone) {
      setError("Veuillez entrer votre numéro de téléphone.");
      return;
    }

    if (!isValidSenegalPhone(trimmedPhone)) {
      setError("Numéro invalide — format attendu : 7X XXX XX XX (ex: 771234567)");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // Génère un ID candidat — sera ignoré si le numéro existe déjà en DB
      const displayId = generateGuestId();

      const { display_id: resolvedId } = await createUserIfNotExists({
        display_id: displayId,
        type: "guest",
        phone: trimmedPhone,
      });

      const session = {
        display_id: resolvedId,
        phone: trimmedPhone,
        type: "guest",
        created_at: new Date().toISOString(),
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      };

      saveSession(session);
      router.push("/upload");

    } catch (err) {
      console.error("Erreur création session :", err.message);
      setError("Une erreur est survenue. Réessaie.");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !loading) handleContinue();
  };

  return (
    <div className="home-container">
      <div className="card">
        <h1>Bienvenue sur Derewol</h1>

        <input
          type="tel"
          placeholder="saisir votre numéro de téléphone"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            if (error) setError("");
          }}
          onKeyDown={handleKeyDown}
          className="phone-input"
          maxLength={15}
          autoComplete="tel"
          inputMode="numeric"
          disabled={loading}
        />

        {error && <p className="error" role="alert">{error}</p>}

        <button
          onClick={handleContinue}
          disabled={loading || !phone.trim()}
          className="btn"
        >
          {loading ? "Chargement..." : "Continuer"}
        </button>
      </div>
    </div>
  );
}