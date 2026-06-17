import { useEffect, useRef, useState, useCallback } from "react";
import Head from "next/head";
import { useRouter } from "next/router";

const READER_ID = "qr-reader-container";
const SCAN_FPS = 10;
const SCAN_COOLDOWN_MS = 2000;

export default function ScanPage() {
  const router = useRouter();
  const scannerRef = useRef(null);
  const lastScanRef = useRef(0);
  const onScanSuccessRef = useRef(null); // ref stable — évite closure périmée
  const [status, setStatus] = useState("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [torch, setTorch] = useState(false);

  // ── Succès de scan ────────────────────────────────────────────────────────────
  const onScanSuccess = useCallback(
    async (decodedText) => {
      const now = Date.now();
      if (now - lastScanRef.current < SCAN_COOLDOWN_MS) return;
      lastScanRef.current = now;

      setStatus("success");
      if (navigator.vibrate) navigator.vibrate([60, 40, 60]);

      if (scannerRef.current) {
        try {
          await scannerRef.current.stop();
        } catch (_) {}
      }

      const redirect = sessionStorage.getItem("dw_scanner_redirect");
      if (redirect) {
        sessionStorage.removeItem("dw_scanner_redirect");
        router.push(`${redirect}?code=${encodeURIComponent(decodedText)}`);
      } else {
        router.push(`/verify?code=${encodeURIComponent(decodedText)}`);
      }
    },
    [router],
  );

  // Garder la ref à jour à chaque render
  useEffect(() => {
    onScanSuccessRef.current = onScanSuccess;
  }, [onScanSuccess]);

  // ── Démarrage du scanner ──────────────────────────────────────────────────────
  const startScanner = useCallback(async () => {
    const { Html5Qrcode } = await import("html5-qrcode");

    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        await scannerRef.current.clear();
      } catch (_) {}
    }

    const scanner = new Html5Qrcode(READER_ID, { verbose: false });
    scannerRef.current = scanner;

    try {
      await scanner.start(
        { facingMode: "environment" },
        {
          fps: SCAN_FPS,
          qrbox: { width: 50, height: 50 }, // minimum autorisé par html5-qrcode
          aspectRatio: 1.0,
          disableFlip: false,
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        },
        (decodedText) => onScanSuccessRef.current?.(decodedText),
        () => {},
      );
      setStatus("scanning");
    } catch (err) {
      setStatus("error");
      setErrorMsg("Caméra inaccessible. Vérifiez les permissions.");
      console.error(err);
    }
  }, []);

  // ── Toggle torche ─────────────────────────────────────────────────────────────
  const toggleTorch = useCallback(async () => {
    if (!scannerRef.current) return;
    const newVal = !torch;
    try {
      await scannerRef.current.applyVideoConstraints({
        advanced: [{ torch: newVal }],
      });
      setTorch(newVal);
    } catch (_) {}
  }, [torch]);

  // ── Cycle de vie ──────────────────────────────────────────────────────────────
  useEffect(() => {
    startScanner();
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
      }
    };
  }, [startScanner]);

  return (
    <>
      <Head>
        <title>Scanner — Derewol</title>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1"
        />
        <meta name="theme-color" content="#09090b" />
      </Head>

      <div className="scan-root">
        <header className="scan-header">
          <button
            className="scan-back-btn"
            onClick={() => router.back()}
            aria-label="Retour"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
          </button>
          <span className="scan-title">Scanner un QR code</span>
          <button
            className="scan-torch-btn"
            onClick={toggleTorch}
            aria-label={torch ? "Éteindre la torche" : "Allumer la torche"}
          >
            {torch ? (
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z" />
              </svg>
            ) : (
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            )}
          </button>
        </header>

        <main className="scan-main">
          <p className="scan-hint">
            {status === "success"
              ? "✓ Code détecté !"
              : status === "error"
                ? errorMsg
                : "Centrez le QR code dans la zone"}
          </p>

          <div className="scan-viewfinder">
            <div id={READER_ID} className="scan-reader-host" />

            <div className="scan-corner scan-corner--tl" />
            <div className="scan-corner scan-corner--tr" />
            <div className="scan-corner scan-corner--bl" />
            <div className="scan-corner scan-corner--br" />

            <div
              className={
                "scan-laser" +
                (status === "scanning" ? " scan-laser--active" : "")
              }
              aria-hidden="true"
            />

            {status === "success" && (
              <div className="scan-success-flash" aria-hidden="true">
                <svg className="scan-check" viewBox="0 0 52 52" fill="none">
                  <circle
                    cx="26"
                    cy="26"
                    r="25"
                    stroke="#eab308"
                    strokeWidth="2"
                  />
                  <path
                    d="M14 26l9 9 15-16"
                    stroke="#eab308"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            )}
          </div>

          <p className="scan-sub-hint">Derewol · Impression sécurisée</p>
        </main>
      </div>

      <style jsx global>{`
        *,
        *::before,
        *::after {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        .scan-root {
          position: fixed;
          inset: 0;
          display: flex;
          flex-direction: column;
          background: #09090b;
          color: #f4f4f5;
          font-family:
            -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          overflow: hidden;
        }

        .scan-header {
          position: relative;
          z-index: 20;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 20px;
          padding-top: max(14px, env(safe-area-inset-top));
        }
        .scan-back-btn,
        .scan-torch-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          border-radius: 50%;
          border: none;
          background: rgba(255, 255, 255, 0.08);
          color: #f4f4f5;
          cursor: pointer;
          transition: background 0.15s;
        }
        .scan-back-btn:active,
        .scan-torch-btn:active {
          background: rgba(255, 255, 255, 0.18);
        }
        .scan-torch-btn svg {
          fill: #eab308;
          stroke: none;
        }
        .scan-title {
          font-size: 15px;
          font-weight: 600;
          letter-spacing: 0.01em;
          color: #e4e4e7;
        }

        .scan-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 28px;
          padding: 24px 20px;
          padding-bottom: calc(24px + 68px);
        }

        .scan-hint {
          font-size: 14px;
          font-weight: 500;
          color: #a1a1aa;
          text-align: center;
          min-height: 20px;
          transition: color 0.2s;
        }
        .scan-sub-hint {
          font-size: 11px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #52525b;
        }

        .scan-viewfinder {
          position: relative;
          width: min(72vw, 300px);
          aspect-ratio: 1 / 1;
          border-radius: 18px;
          overflow: hidden;
          background: #000;
          box-shadow:
            0 0 0 1px rgba(234, 179, 8, 0.15),
            0 0 40px rgba(234, 179, 8, 0.08),
            0 24px 64px rgba(0, 0, 0, 0.7);
        }

        .scan-reader-host {
          position: absolute !important;
          inset: 0 !important;
          width: 100% !important;
          height: 100% !important;
          overflow: hidden !important;
          border: none !important;
          background: transparent !important;
        }
        #qr-reader-container {
          position: absolute !important;
          inset: 0 !important;
          width: 100% !important;
          height: 100% !important;
          padding: 0 !important;
          border: none !important;
          background: transparent !important;
          overflow: hidden !important;
        }
        #qr-reader-container video {
          position: absolute !important;
          top: 0 !important;
          left: 0 !important;
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
          border: none !important;
          display: block !important;
        }
        #qr-shaded-region {
          display: none !important;
          opacity: 0 !important;
          pointer-events: none !important;
        }
        #qr-reader-container canvas,
        #qr-canvas {
          display: none !important;
          visibility: hidden !important;
        }
        #qr-reader-container select,
        #qr-reader-container button,
        #qr-reader-container img,
        #qr-reader-container span,
        #qr-reader-container p {
          display: none !important;
        }
        #qr-reader-container > div:not([id]) {
          display: none !important;
        }

        .scan-corner {
          position: absolute;
          width: 22px;
          height: 22px;
          z-index: 10;
          pointer-events: none;
        }
        .scan-corner--tl {
          top: 10px;
          left: 10px;
          border-top: 2.5px solid #eab308;
          border-left: 2.5px solid #eab308;
          border-radius: 4px 0 0 0;
        }
        .scan-corner--tr {
          top: 10px;
          right: 10px;
          border-top: 2.5px solid #eab308;
          border-right: 2.5px solid #eab308;
          border-radius: 0 4px 0 0;
        }
        .scan-corner--bl {
          bottom: 10px;
          left: 10px;
          border-bottom: 2.5px solid #eab308;
          border-left: 2.5px solid #eab308;
          border-radius: 0 0 0 4px;
        }
        .scan-corner--br {
          bottom: 10px;
          right: 10px;
          border-bottom: 2.5px solid #eab308;
          border-right: 2.5px solid #eab308;
          border-radius: 0 0 4px 0;
        }

        .scan-laser {
          position: absolute;
          left: 8%;
          right: 8%;
          top: 10%;
          height: 2px;
          z-index: 11;
          border-radius: 2px;
          opacity: 0;
          pointer-events: none;
          background: linear-gradient(
            to right,
            transparent 0%,
            #eab308 20%,
            #fef08a 50%,
            #eab308 80%,
            transparent 100%
          );
          box-shadow:
            0 0 6px 2px rgba(234, 179, 8, 0.5),
            0 0 16px 4px rgba(234, 179, 8, 0.25);
        }
        .scan-laser--active {
          animation: laser-sweep 2.2s cubic-bezier(0.45, 0, 0.55, 1) infinite;
        }

        @keyframes laser-sweep {
          0% {
            top: 10%;
            opacity: 0;
          }
          5% {
            opacity: 1;
          }
          50% {
            top: 88%;
          }
          95% {
            opacity: 1;
          }
          100% {
            top: 10%;
            opacity: 0;
          }
        }

        .scan-success-flash {
          position: absolute;
          inset: 0;
          z-index: 20;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0, 0, 0, 0.65);
          backdrop-filter: blur(2px);
          animation: flash-in 0.25s ease-out;
        }
        .scan-check {
          width: 64px;
          height: 64px;
          animation: check-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both;
        }

        @keyframes flash-in {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes check-pop {
          from {
            transform: scale(0.4);
            opacity: 0;
          }
          to {
            transform: scale(1);
            opacity: 1;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .scan-laser--active {
            animation: none;
            opacity: 1;
            top: 50%;
          }
          .scan-success-flash,
          .scan-check {
            animation: none;
          }
        }
      `}</style>
    </>
  );
}
