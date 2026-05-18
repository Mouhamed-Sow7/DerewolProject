import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

export default function ScanPage() {
  const router = useRouter();
  const { slug, expired } = router.query;
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!slug) return;

    const isExpiredRoute = expired === "true";
    if (isExpiredRoute) {
      setStatus("expired");
      setError(null);
      const timer = setTimeout(() => {
        handleScan();
      }, 1500);
      return () => clearTimeout(timer);
    }

    handleScan();
  }, [slug, expired]);

  async function handleScan() {
    try {
      setStatus("connecting");

      const { data, error } = await sb.rpc("generate_qr_session", {
        p_printer_slug: slug,
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Sauvegarder le token en sessionStorage
      sessionStorage.setItem("dw_qr_token", data.token);
      sessionStorage.setItem("dw_session_id", data.session_id);
      sessionStorage.setItem("dw_token_expires", data.expires_at);

      setStatus("redirecting");

      // Rediriger vers l'espace de la boutique avec le token
      router.replace(`/p/${slug}?token=${data.token}`);
    } catch (err) {
      console.error("[SCAN]", err.message);
      setError(err.message);
      setStatus("error");
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#f9fafb",
        fontFamily: "system-ui, sans-serif",
        padding: 24,
      }}
    >
      {/* Logo */}
      <div
        style={{
          background: "#1a3a2a",
          borderRadius: 16,
          padding: "12px 24px",
          marginBottom: 32,
        }}
      >
        <span style={{ color: "#fff", fontWeight: 700, fontSize: 20 }}>
          Derewol<span style={{ color: "#f5c842" }}>Print</span>
        </span>
      </div>

      {status === "loading" || status === "connecting" ? (
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              width: 48,
              height: 48,
              border: "4px solid #e5e7eb",
              borderTop: "4px solid #1a3a2a",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
              margin: "0 auto 16px",
            }}
          />
          <p style={{ color: "#374151", fontSize: 16, fontWeight: 500 }}>
            Connexion à la boutique...
          </p>
          <p style={{ color: "#9ca3af", fontSize: 14 }}>Veuillez patienter</p>
        </div>
      ) : status === "expired" ? (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⏱️</div>
          <p style={{ color: "#b45309", fontSize: 16, fontWeight: 600 }}>
            Session expirée — génération d'une nouvelle session...
          </p>
          <p style={{ color: "#9ca3af", fontSize: 14 }}>Merci de patienter</p>
        </div>
      ) : status === "redirecting" ? (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
          <p style={{ color: "#166534", fontSize: 16, fontWeight: 600 }}>
            Boutique trouvée !
          </p>
          <p style={{ color: "#9ca3af", fontSize: 14 }}>
            Redirection en cours...
          </p>
        </div>
      ) : (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>❌</div>
          <p style={{ color: "#dc2626", fontSize: 16, fontWeight: 600 }}>
            Boutique introuvable
          </p>
          <p style={{ color: "#9ca3af", fontSize: 14, marginBottom: 24 }}>
            {error || "Ce QR code n'est pas valide"}
          </p>
          <button
            onClick={handleScan}
            style={{
              background: "#1a3a2a",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "12px 24px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Réessayer
          </button>
        </div>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
