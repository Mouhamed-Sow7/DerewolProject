import { useEffect, useState, useRef } from "react";
import Head from "next/head";
import Layout from "../components/Layout";

export default function Scan() {
  const [error, setError] = useState(null);
  const qrCodeInstance = useRef(null);

  useEffect(() => {
    let isMounted = true;

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

            if (typeof window !== "undefined") {
              sessionStorage.setItem("dw_scanner_redirect", slug);
            }

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
            // lecture silencieuse
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

    return () => {
      isMounted = false;
      if (qrCodeInstance.current && qrCodeInstance.current.stop) {
        qrCodeInstance.current
          .stop()
          .catch((e) => console.log("Nettoyage scanner", e));
      }
    };
  }, []);

  return (
    <Layout>
      <Head>
        <title>Derewol - Scanner</title>
      </Head>

      <style jsx global>{`
        @keyframes laserScan {
          0% {
            top: 0%;
            opacity: 0.3;
          }
          50% {
            opacity: 1;
          }
          100% {
            top: 100%;
            opacity: 0.3;
          }
        }
        .animate-laser {
          position: absolute;
          left: 0;
          width: 100%;
          height: 3px;
          background: linear-gradient(
            to right,
            transparent,
            #eab308,
            transparent
          );
          box-shadow: 0 0 12px 3px rgba(234, 179, 8, 0.7);
          animation: laserScan 2.5s ease-in-out infinite;
        }
      `}</style>

      <div className="min-h-screen bg-[#FAF9F5] text-[#1f241f] flex flex-col justify-between pb-24 font-sans select-none antialiased">
        <header className="w-full px-6 pt-10 text-center max-w-md mx-auto">
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-neutral-800 leading-snug">
            Scannez le QR Code <br />
            <span className="text-[#15462D] font-extrabold">
              de l'imprimeur
            </span>
          </h1>
          <p className="text-xs text-neutral-500 mt-2 font-medium">
            Alignez le QR code dans le cadre pour démarrer l'impression
            sécurisée
          </p>
        </header>

        <main className="flex-1 flex items-center justify-center px-6 my-4">
          <div className="relative w-full max-w-[340px] aspect-[4/3] sm:aspect-square bg-neutral-900/5 rounded-3xl p-3 backdrop-blur-sm border border-neutral-200/40 shadow-inner">
            <div className="relative w-full h-full bg-neutral-900 rounded-2xl overflow-hidden flex items-center justify-center shadow-2xl group">
              {/* Camera mount point for html5-qrcode */}
              <div id="reader" className="absolute inset-0 z-0"></div>

              {/* Placeholder (visible if video not available) */}
              <div className="absolute inset-0 bg-neutral-950 flex flex-col items-center justify-center text-neutral-600 gap-3 z-0">
                <svg
                  className="w-12 h-12 stroke-current animate-pulse"
                  fill="none"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.5"
                    d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                <span className="text-xs font-semibold tracking-wider uppercase opacity-40">
                  Caméra active...
                </span>
              </div>

              {/* Laser line */}
              <div className="animate-laser z-10" />

              {/* High-tech corners */}
              <div className="absolute inset-6 pointer-events-none z-20 flex flex-col justify-between">
                <div className="flex justify-between">
                  <div className="w-6 h-6 border-t-4 border-l-4 border-[#EAB308] rounded-tl-md" />
                  <div className="w-6 h-6 border-t-4 border-r-4 border-[#EAB308] rounded-tr-md" />
                </div>
                <div className="flex justify-between">
                  <div className="w-6 h-6 border-b-4 border-l-4 border-[#EAB308] rounded-bl-md" />
                  <div className="w-6 h-6 border-b-4 border-r-4 border-[#EAB308] rounded-br-md" />
                </div>
              </div>

              {/* Subtle grid */}
              <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:20px_20px] pointer-events-none z-10" />
            </div>
          </div>
        </main>

        {error && (
          <div className="px-6 pb-6 max-w-md mx-auto text-center">
            <p className="text-sm text-red-600 font-medium">{error}</p>
          </div>
        )}
      </div>
    </Layout>
  );
}
