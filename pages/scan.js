import { useEffect, useState, useRef } from "react";
import Layout from "../components/Layout";

export default function Scan() {
  const [error, setError] = useState(null);
  const qrCodeInstance = useRef(null);

  useEffect(() => {
    let isMounted = true;

    // Fonction de parsing robuste pour extraire le nom de l'imprimeur
    const parseSlug = (text) => {
      if (!text) return "";
      try {
        if (text.startsWith("http://") || text.startsWith("https://")) {
          const url = new URL(text);
          const parts = url.pathname.split("/").filter(Boolean);
          return parts[parts.length - 1] || "";
        }
        const parts = text.split("/").filter(Boolean);
        return parts[parts.length - 1] || text;
      } catch (e) {
        return text;
      }
    };

    const initScanner = async () => {
      try {
        // Import dynamique pour éviter les crashs au build Next.js (SSR)
        const { Html5Qrcode } = await import("html5-qrcode");

        if (!isMounted) return;

        const html5QrCode = new Html5Qrcode("reader");
        qrCodeInstance.current = html5QrCode;

        const config = { fps: 10, qrbox: { width: 260, height: 260 } };

        await html5QrCode.start(
          { facingMode: "environment" },
          config,
          (decodedText) => {
            console.log("Brut QR scanné :", decodedText);
            const slug = parseSlug(decodedText);

            if (!slug) return;

            // 🔥 AJOUT CRITIQUE : déposer le laisser-passer pour que la page /p/ nous accepte
            if (typeof window !== "undefined") {
              sessionStorage.setItem("dw_scanner_redirect", slug);
            }

            // ON ARRÊTE LA CAMÉRA D'ABORD, PUIS ON REDIRIGE (Évite le crash removeChild)
            html5QrCode
              .stop()
              .then(() => {
                window.location.href =
                  window.location.origin + "/p/" + encodeURIComponent(slug);
              })
              .catch((err) => {
                console.warn("Échec stop caméra, redirection forcée :", err);
                window.location.href =
                  window.location.origin + "/p/" + encodeURIComponent(slug);
              });
          },
          () => {
            // Callback d'erreur de lecture (silencieux pour éviter le spam de logs)
          },
        );
      } catch (err) {
        console.error("Erreur d'initialisation du scanner :", err);
        setError(
          "Impossible d'accéder à la caméra ou bibliothèque introuvable.",
        );
      }
    };

    initScanner();

    // Nettoyage au démontage du composant
    return () => {
      isMounted = false;
      if (qrCodeInstance.current && qrCodeInstance.current.isScanning) {
        qrCodeInstance.current
          .stop()
          .catch((e) => console.log("Nettoyage scanner", e));
      }
    };
  }, []);

  return (
    <Layout>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "75vh",
          padding: "20px",
        }}
      >
        <h1
          style={{
            marginBottom: "24px",
            fontSize: "22px",
            fontWeight: "600",
            color: "#1f241f",
          }}
        >
          Scannez le QR Code de l'imprimeur
        </h1>

        {/* Conteneur fixe pour le DOM de la caméra */}
        <div
          id="reader"
          style={{
            width: "100%",
            maxWidth: "450px",
            borderRadius: "16px",
            overflow: "hidden",
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
          }}
        ></div>

        {error && (
          <p style={{ color: "#dc2626", marginTop: "20px", fontWeight: "500" }}>
            {error}
          </p>
        )}
      </div>
    </Layout>
  );
}
