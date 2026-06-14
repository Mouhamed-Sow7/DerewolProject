"use client";

import { useState, useEffect } from "react";
import {
  QrCode,
  Smartphone,
  Printer,
  ShieldCheck,
  RefreshCw,
  Clock,
  Download,
  MessageCircle,
  FileSpreadsheet,
  FileText,
  CheckCircle2,
  Trash2,
} from "lucide-react";

const DOWNLOAD_URL =
  "https://github.com/Mouhamed-Sow7/DerewolProject/releases/latest";
const WHATSAPP_URL = "https://wa.me/221781220391";

export default function DerewolLanding() {
  const [ticketStatus, setTicketStatus] = useState("waiting");
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);

  const SLIDES = [
    {
      src: "/screenshots/derewol-jobs.png",
      tag: "desktop",
      tagLabel: "Desktop",
      label:
        "File « Jobs en attente » — chaque envoi devient un ticket numéroté",
    },
    {
      src: "/screenshots/derewol-impression.png",
      tag: "desktop",
      tagLabel: "Desktop",
      label: "Impression en cours — suivez chaque job en temps réel",
    },
    {
      src: "/screenshots/derewol-dark.png",
      tag: "dark",
      tagLabel: "Dark mode",
      label:
        "Mode sombre — confort visuel pour les longues journées au comptoir",
    },
    {
      src: "/screenshots/derewol-pwa-upload.png",
      tag: "pwa",
      tagLabel: "PWA client",
      label: "Côté client — glissez vos fichiers, envoyez en 10 secondes",
    },
    {
      src: "/screenshots/derewol-pwa-attente.png",
      tag: "pwa",
      tagLabel: "PWA client",
      label:
        "Côté client — suivi en temps réel : « En attente de l'imprimeur »",
    },
    {
      src: "/screenshots/derewol-ai.png",
      tag: "ai",
      tagLabel: "AI",
      label: "Derewol AI — analyse intelligente, suggestions et OCR avancé",
    },
  ];

  const prev = () => setSlide((s) => (s - 1 + SLIDES.length) % SLIDES.length);
  const next = () => setSlide((s) => (s + 1) % SLIDES.length);

  useEffect(() => {
    const id = setInterval(() => {
      setTicketStatus((s) => (s === "waiting" ? "done" : "waiting"));
    }, 3000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(next, 4000);
    return () => clearInterval(id);
  }, [paused, slide]);

  return (
    <div className="dw-root">
      <style jsx global>{`
        :root {
          --green: #1b3a2b;
          --green-light: #2f5742;
          --gold: #f5c518;
          --cream: #faf6ed;
          --ink: #1b1b1b;
          --muted: #75705f;
          --line: #e6decf;
        }

        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        .dw-root {
          min-height: 100vh;
          background: var(--cream);
          color: var(--ink);
          font-family: "Inter", sans-serif;
        }

        /* ── NAV ── */
        .dw-nav {
          position: sticky;
          top: 0;
          z-index: 50;
          backdrop-filter: blur(8px);
          background: rgba(250, 246, 237, 0.88);
          border-bottom: 1px solid var(--line);
        }
        .dw-nav-inner {
          max-width: 1120px;
          margin: 0 auto;
          padding: 16px 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .dw-logo {
          font-family: "Fraunces", serif;
          font-size: 1.2rem;
          font-weight: 600;
        }
        .dw-logo span {
          color: var(--gold);
        }
        .dw-nav-links {
          display: flex;
          align-items: center;
          gap: 32px;
          list-style: none;
        }
        .dw-nav-links a {
          font-size: 0.875rem;
          font-weight: 500;
          color: var(--muted);
          text-decoration: none;
          transition: opacity 0.2s;
        }
        .dw-nav-links a:hover {
          opacity: 0.6;
        }
        .dw-btn-nav {
          padding: 8px 18px;
          border-radius: 6px;
          font-size: 0.875rem;
          font-weight: 600;
          background: var(--green);
          color: var(--cream);
          text-decoration: none;
          transition: transform 0.15s;
          display: inline-block;
        }
        .dw-btn-nav:hover {
          transform: translateY(-2px);
        }
        @media (max-width: 768px) {
          .dw-nav-links {
            display: none;
          }
        }

        /* ── HERO ── */
        .dw-hero {
          max-width: 1120px;
          margin: 0 auto;
          padding: 64px 24px 96px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 48px;
          align-items: center;
        }
        @media (max-width: 768px) {
          .dw-hero {
            grid-template-columns: 1fr;
            padding: 40px 20px 64px;
          }
        }
        .dw-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 0.7rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          margin-bottom: 24px;
          padding: 6px 14px;
          border-radius: 999px;
          background: var(--green);
          color: var(--cream);
        }
        .dw-h1 {
          font-family: "Fraunces", serif;
          font-size: clamp(2.8rem, 6vw, 4rem);
          line-height: 1.05;
          margin-bottom: 24px;
        }
        .dw-h1 span {
          color: var(--gold);
        }
        .dw-hero-lead {
          font-size: 1.1rem;
          color: var(--muted);
          margin-bottom: 32px;
          max-width: 420px;
          line-height: 1.6;
        }
        .dw-cta-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 16px;
          margin-bottom: 16px;
        }
        .dw-btn-gold {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 14px 28px;
          border-radius: 6px;
          font-weight: 700;
          font-size: 1rem;
          background: var(--gold);
          color: var(--green);
          text-decoration: none;
          transition: transform 0.15s;
        }
        .dw-btn-gold:hover {
          transform: translateY(-2px);
        }
        .dw-link-subtle {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--green);
          text-decoration: underline;
        }
        .dw-fine-print {
          font-size: 0.75rem;
          color: var(--muted);
        }

        /* ── TICKET CARD ── */
        .dw-ticket-wrap {
          display: flex;
          justify-content: flex-end;
        }
        @media (max-width: 768px) {
          .dw-ticket-wrap {
            justify-content: center;
          }
        }
        .dw-ticket {
          width: 100%;
          max-width: 300px;
          transform: rotate(-2deg);
          animation: dw-fadein 0.6s ease-out both;
        }
        .dw-ticket-body {
          background: #fff;
          border-radius: 4px 4px 0 0;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.14);
          padding: 24px 24px 16px;
        }
        .dw-ticket-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
        }
        .dw-ticket-logo {
          font-family: "Fraunces", serif;
          font-size: 0.95rem;
          font-weight: 600;
        }
        .dw-ticket-logo span {
          color: var(--gold);
        }
        .dw-ticket-shop {
          font-family: "JetBrains Mono", monospace;
          font-size: 0.65rem;
          text-transform: uppercase;
          color: var(--muted);
        }
        .dw-ticket-divider {
          border: none;
          border-top: 1px dashed var(--line);
          margin: 12px 0;
        }
        .dw-ticket-id {
          font-family: "JetBrains Mono", monospace;
          font-size: 0.7rem;
          color: var(--muted);
          margin-bottom: 12px;
        }
        .dw-ticket-files {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-bottom: 16px;
        }
        .dw-ticket-file {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.875rem;
          color: var(--ink);
        }
        .dw-ticket-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .dw-ticket-count {
          font-size: 0.75rem;
          color: var(--muted);
        }
        .dw-ticket-status {
          font-size: 0.7rem;
          font-weight: 600;
          padding: 4px 10px;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          transition:
            background 0.5s,
            color 0.5s;
        }
        .dw-ticket-status.waiting {
          background: #fdf0cc;
          color: #9a7b0f;
        }
        .dw-ticket-status.done {
          background: #ddefe3;
          color: var(--green);
        }
        .dw-ticket-zigzag {
          height: 14px;
          background-color: #fff;
          background-image:
            linear-gradient(135deg, var(--cream) 25%, transparent 25.5%),
            linear-gradient(225deg, var(--cream) 25%, transparent 25.5%);
          background-position:
            0 0,
            7px 0;
          background-size: 14px 14px;
          background-repeat: repeat-x;
          border-radius: 0 0 4px 4px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.14);
        }

        /* ── AVANT / APRÈS ── */
        .dw-section {
          max-width: 1120px;
          margin: 0 auto;
          padding: 0 24px 96px;
        }
        .dw-compare {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 24px;
        }
        @media (max-width: 768px) {
          .dw-compare {
            grid-template-columns: 1fr;
          }
        }
        .dw-card {
          border-radius: 10px;
          padding: 32px;
          border: 1px solid var(--line);
        }
        .dw-card-dark {
          border-radius: 10px;
          padding: 32px;
          background: var(--green);
          color: var(--cream);
        }
        .dw-card-title {
          font-family: "Fraunces", serif;
          font-size: 1.3rem;
          margin-bottom: 20px;
          color: var(--muted);
        }
        .dw-card-dark .dw-card-title {
          color: var(--gold);
        }
        .dw-list {
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .dw-list li {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          font-size: 0.875rem;
          color: var(--muted);
          line-height: 1.5;
        }
        .dw-card-dark .dw-list li {
          color: rgba(250, 246, 237, 0.85);
        }
        .dw-list li svg {
          flex-shrink: 0;
          margin-top: 2px;
        }

        /* ── HOW IT WORKS ── */
        .dw-h2 {
          font-family: "Fraunces", serif;
          font-size: clamp(1.8rem, 4vw, 2.5rem);
          margin-bottom: 48px;
        }
        .dw-steps {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 32px;
        }
        @media (max-width: 768px) {
          .dw-steps {
            grid-template-columns: 1fr;
            gap: 40px;
          }
        }
        .dw-step-n {
          font-family: "JetBrains Mono", monospace;
          font-size: 0.8rem;
          color: var(--gold);
          margin-bottom: 16px;
        }
        .dw-step h3 {
          font-family: "Fraunces", serif;
          font-size: 1.1rem;
          margin: 16px 0 8px;
        }
        .dw-step p {
          font-size: 0.875rem;
          color: var(--muted);
          line-height: 1.6;
        }

        /* ── APERÇU / GALERIE ── */
        .dw-lead {
          font-size: 0.875rem;
          color: var(--muted);
          max-width: 480px;
          margin-bottom: 48px;
          line-height: 1.6;
        }

        .dw-gallery {
          position: relative;
          border-radius: 14px;
          overflow: hidden;
          border: 1px solid var(--line);
          background: #fff;
          box-shadow: 0 8px 40px rgba(0, 0, 0, 0.08);
        }
        .dw-gallery-track {
          display: flex;
          transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .dw-gallery-slide {
          min-width: 100%;
          position: relative;
        }
        .dw-gallery-slide img {
          width: 100%;
          display: block;
          max-height: 520px;
          object-fit: cover;
          object-position: top;
        }
        /* Placeholder quand image absente */
        .dw-gallery-placeholder {
          width: 100%;
          height: 380px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          background: linear-gradient(135deg, #f0ece3 0%, #e8e2d6 100%);
          color: var(--muted);
          font-size: 0.8rem;
        }
        .dw-gallery-placeholder-icon {
          width: 56px;
          height: 56px;
          border-radius: 12px;
          background: var(--line);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.6rem;
        }
        .dw-gallery-caption {
          padding: 18px 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-top: 1px solid var(--line);
        }
        .dw-gallery-caption-left {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .dw-gallery-tag {
          display: inline-block;
          font-size: 0.65rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          padding: 3px 10px;
          border-radius: 999px;
          background: var(--green);
          color: var(--cream);
          width: fit-content;
        }
        .dw-gallery-tag.pwa {
          background: #1a6b9a;
        }
        .dw-gallery-tag.dark {
          background: #2d2d2d;
        }
        .dw-gallery-label {
          font-size: 0.875rem;
          color: var(--ink);
          font-weight: 500;
        }
        /* Flèches */
        .dw-gallery-btn {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          width: 40px;
          height: 40px;
          border-radius: 50%;
          border: none;
          background: rgba(255, 255, 255, 0.92);
          box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1rem;
          color: var(--green);
          transition:
            background 0.15s,
            transform 0.15s;
          z-index: 10;
        }
        .dw-gallery-btn:hover {
          background: #fff;
          transform: translateY(-50%) scale(1.08);
        }
        .dw-gallery-btn.prev {
          left: 12px;
        }
        .dw-gallery-btn.next {
          right: 12px;
        }
        /* Dots */
        .dw-gallery-dots {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .dw-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--line);
          border: none;
          cursor: pointer;
          padding: 0;
          transition:
            background 0.2s,
            transform 0.2s;
        }
        .dw-dot.active {
          background: var(--green);
          transform: scale(1.3);
        }

        /* ── SÉCURITÉ ── */
        .dw-security {
          background: var(--green);
          color: var(--cream);
          padding: 80px 24px;
        }
        .dw-security-inner {
          max-width: 1120px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 32px;
        }
        @media (max-width: 768px) {
          .dw-security-inner {
            grid-template-columns: 1fr;
          }
        }
        .dw-security-item h3 {
          font-family: "Fraunces", serif;
          font-size: 1.1rem;
          margin: 12px 0 8px;
        }
        .dw-security-item p {
          font-size: 0.875rem;
          opacity: 0.8;
          line-height: 1.6;
        }

        /* ── TARIFS ── */
        .dw-tarifs {
          max-width: 1120px;
          margin: 0 auto;
          padding: 96px 24px;
          text-align: center;
        }
        .dw-stamp {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 112px;
          height: 112px;
          border-radius: 50%;
          border: 2px solid var(--green);
          color: var(--green);
          transform: rotate(-8deg);
          font-family: "Fraunces", serif;
          font-size: 0.8rem;
          font-weight: 700;
          line-height: 1.3;
          margin-bottom: 32px;
        }
        .dw-tarifs .dw-h2 {
          margin-bottom: 16px;
        }
        .dw-tarifs-lead {
          font-size: 0.875rem;
          color: var(--muted);
          max-width: 420px;
          margin: 0 auto 40px;
          line-height: 1.6;
        }
        .dw-cta-row-center {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 16px;
        }
        .dw-btn-outline {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 14px 28px;
          border-radius: 6px;
          font-weight: 600;
          font-size: 1rem;
          border: 2px solid var(--green);
          color: var(--green);
          text-decoration: none;
          transition: background 0.15s;
          background: transparent;
        }
        .dw-btn-outline:hover {
          background: rgba(27, 58, 43, 0.07);
        }

        /* ── FOOTER ── */
        .dw-footer {
          border-top: 1px solid var(--line);
          padding: 48px 24px;
        }
        .dw-footer-inner {
          max-width: 1120px;
          margin: 0 auto;
          display: flex;
          flex-wrap: wrap;
          gap: 40px;
          justify-content: space-between;
        }
        .dw-footer-logo {
          font-family: "Fraunces", serif;
          font-size: 1.1rem;
          font-weight: 600;
          margin-bottom: 8px;
        }
        .dw-footer-logo span {
          color: var(--gold);
        }
        .dw-footer-col {
          max-width: 260px;
        }
        .dw-footer-col p {
          font-size: 0.875rem;
          color: var(--muted);
          line-height: 1.6;
        }
        .dw-footer-col strong {
          color: var(--ink);
          display: block;
          margin-bottom: 4px;
          font-size: 0.875rem;
        }
        .dw-footer-bottom {
          max-width: 1120px;
          margin: 32px auto 0;
          padding-top: 24px;
          border-top: 1px solid var(--line);
          font-size: 0.75rem;
          color: var(--muted);
        }

        /* ── ANIMATION ── */
        @keyframes dw-fadein {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .dw-ticket {
            animation: none;
          }
        }
      `}</style>

      {/* NAV */}
      <nav className="dw-nav">
        <div className="dw-nav-inner">
          <div className="dw-logo">
            Derewol<span>Print</span>
          </div>
          <ul className="dw-nav-links">
            <li>
              <a href="#comment">Comment ça marche</a>
            </li>
            <li>
              <a href="#apercu">Aperçu</a>
            </li>
            <li>
              <a href="#tarifs">Tarifs</a>
            </li>
          </ul>
          <a
            href={DOWNLOAD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="dw-btn-nav"
          >
            Télécharger
          </a>
        </div>
      </nav>

      {/* HERO */}
      <section className="dw-hero">
        <div>
          <div className="dw-badge">
            Pour les imprimeries & boutiques de reprographie
          </div>
          <h1 className="dw-h1">
            Scannez.
            <br />
            Envoyez.
            <br />
            <span>Imprimez.</span>
          </h1>
          <p className="dw-hero-lead">
            DerewolPrint transforme le téléphone de vos clients en guichet
            d'impression. Plus de clés USB, plus d'attente — juste un QR code
            sur votre comptoir.
          </p>
          <div className="dw-cta-row">
            <a
              href={DOWNLOAD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="dw-btn-gold"
            >
              <Download size={18} /> Télécharger pour Windows
            </a>
            <a href="#comment" className="dw-link-subtle">
              Voir comment ça marche
            </a>
          </div>
          <p className="dw-fine-print">
            Essai gratuit de 7 jours · Aucune carte bancaire requise
          </p>
        </div>

        {/* Ticket */}
        <div className="dw-ticket-wrap">
          <div className="dw-ticket">
            <div className="dw-ticket-body">
              <div className="dw-ticket-header">
                <span className="dw-ticket-logo">
                  Derewol<span>Print</span>
                </span>
                <span className="dw-ticket-shop">Boutique Demo</span>
              </div>
              <hr className="dw-ticket-divider" />
              <p className="dw-ticket-id">DW-ANON-2D23RNBV</p>
              <div className="dw-ticket-files">
                <div className="dw-ticket-file">
                  <FileText size={14} style={{ color: "var(--green)" }} />{" "}
                  Facture_SN6784.pdf
                </div>
                <div className="dw-ticket-file">
                  <FileSpreadsheet
                    size={14}
                    style={{ color: "var(--green)" }}
                  />{" "}
                  Devis_Estimatif.xlsx
                </div>
              </div>
              <hr className="dw-ticket-divider" />
              <div className="dw-ticket-footer">
                <span className="dw-ticket-count">2 fichiers</span>
                <span className={`dw-ticket-status ${ticketStatus}`}>
                  {ticketStatus === "waiting" ? (
                    <>
                      <Clock size={12} /> En attente
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={12} /> Imprimé
                    </>
                  )}
                </span>
              </div>
            </div>
            <div className="dw-ticket-zigzag" />
          </div>
        </div>
      </section>

      {/* AVANT / APRÈS */}
      <div className="dw-section">
        <div className="dw-compare">
          <div className="dw-card">
            <p className="dw-card-title">Avant</p>
            <ul className="dw-list">
              <li>
                <Trash2 size={16} /> Clés USB perdues, oubliées ou infectées
              </li>
              <li>
                <Clock size={16} /> Files d'attente pour brancher un câble
              </li>
              <li>
                <FileText size={16} /> Fichiers qui traînent sur l'ordinateur
              </li>
            </ul>
          </div>
          <div className="dw-card-dark">
            <p className="dw-card-title">Avec DerewolPrint</p>
            <ul className="dw-list">
              <li>
                <QrCode size={16} style={{ color: "var(--gold)" }} /> Un QR code
                unique, affiché au comptoir
              </li>
              <li>
                <Smartphone size={16} style={{ color: "var(--gold)" }} /> Envoi
                depuis le téléphone, en 10 secondes
              </li>
              <li>
                <ShieldCheck size={16} style={{ color: "var(--gold)" }} />{" "}
                Fichiers supprimés après impression
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* COMMENT ÇA MARCHE */}
      <div className="dw-section" id="comment">
        <h2 className="dw-h2">Comment ça marche</h2>
        <div className="dw-steps">
          {[
            {
              n: "01",
              icon: QrCode,
              title: "Affichez votre QR code",
              desc: "Chaque boutique génère son propre QR code depuis l'application, à imprimer ou afficher sur écran.",
            },
            {
              n: "02",
              icon: Smartphone,
              title: "Le client scanne et envoie",
              desc: "Une session sécurisée s'ouvre sur son téléphone, valable 30 minutes — aucune installation requise.",
            },
            {
              n: "03",
              icon: Printer,
              title: "Vous imprimez en un clic",
              desc: "Les fichiers arrivent dans votre file « Jobs en attente », prêts à être imprimés.",
            },
          ].map(({ n, icon: Icon, title, desc }) => (
            <div key={n} className="dw-step">
              <p className="dw-step-n">{n}</p>
              <Icon size={28} style={{ color: "var(--green)" }} />
              <h3>{title}</h3>
              <p>{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* APERÇU / GALERIE */}
      <div className="dw-section" id="apercu">
        <h2 className="dw-h2">L'application, en vrai</h2>
        <p className="dw-lead">
          Desktop Electron, mode sombre, PWA client — tout le flow, de l'envoi à
          l'impression.
        </p>

        <div
          className="dw-gallery"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          {/* Track */}
          <div
            className="dw-gallery-track"
            style={{ transform: `translateX(-${slide * 100}%)` }}
          >
            {SLIDES.map((s, i) => (
              <div key={i} className="dw-gallery-slide">
                <img src={s.src} alt={s.label} />
              </div>
            ))}
          </div>

          {/* Flèches */}
          <button
            className="dw-gallery-btn prev"
            onClick={() => {
              prev();
              setPaused(true);
            }}
            aria-label="Précédent"
          >
            ‹
          </button>
          <button
            className="dw-gallery-btn next"
            onClick={() => {
              next();
              setPaused(true);
            }}
            aria-label="Suivant"
          >
            ›
          </button>

          {/* Caption + dots */}
          <div className="dw-gallery-caption">
            <div className="dw-gallery-caption-left">
              <span className={`dw-gallery-tag ${SLIDES[slide].tag}`}>
                {SLIDES[slide].tagLabel}
              </span>
              <span className="dw-gallery-label">{SLIDES[slide].label}</span>
            </div>
            <div className="dw-gallery-dots">
              {SLIDES.map((_, i) => (
                <button
                  key={i}
                  className={`dw-dot${i === slide ? " active" : ""}`}
                  onClick={() => {
                    setSlide(i);
                    setPaused(true);
                  }}
                  aria-label={`Slide ${i + 1}`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* SÉCURITÉ */}
      <section className="dw-security">
        <div className="dw-security-inner">
          {[
            {
              icon: Clock,
              title: "Sessions de 30 minutes",
              desc: "Chaque lien d'envoi expire automatiquement, pour protéger les fichiers de vos clients.",
            },
            {
              icon: ShieldCheck,
              title: "Suppression automatique",
              desc: "Une fois imprimés, les fichiers sont effacés — rien ne reste sur le poste de la boutique.",
            },
            {
              icon: RefreshCw,
              title: "Mises à jour automatiques",
              desc: "L'application se met à jour seule — toujours la dernière version, sans manipulation.",
            },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="dw-security-item">
              <Icon size={24} style={{ color: "var(--gold)" }} />
              <h3>{title}</h3>
              <p>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* TARIFS */}
      <section id="tarifs" className="dw-tarifs">
        <div className="dw-stamp">
          7 JOURS
          <br />
          D'ESSAI
          <br />
          GRATUIT
        </div>
        <h2 className="dw-h2">Prêt à moderniser votre comptoir ?</h2>
        <p className="dw-tarifs-lead">
          Installez DerewolPrint sur votre ordinateur Windows et configurez
          votre boutique en moins de 5 minutes.
        </p>
        <div className="dw-cta-row-center">
          <a
            href={DOWNLOAD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="dw-btn-gold"
            style={{ fontSize: "1rem" }}
          >
            <Download size={20} /> Télécharger DerewolPrint
          </a>
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="dw-btn-outline"
          >
            <MessageCircle size={20} /> Discuter sur WhatsApp
          </a>
        </div>
        <p className="dw-fine-print" style={{ marginTop: "16px" }}>
          Windows 10/11 · Tarifs adaptés à votre boutique sur demande
        </p>
      </section>

      {/* FOOTER */}
      <footer className="dw-footer">
        <div className="dw-footer-inner">
          <div className="dw-footer-col">
            <div className="dw-footer-logo">
              Derewol<span>Print</span>
            </div>
            <p>
              Le guichet d'impression sans contact, pensé pour les boutiques
              sénégalaises.
            </p>
          </div>
          <div className="dw-footer-col">
            <strong>Vous êtes client d'une boutique ?</strong>
            <p>
              Scannez simplement le QR code fourni par votre imprimeur — aucune
              installation nécessaire.
            </p>
          </div>
          <div className="dw-footer-col">
            <strong>Contact</strong>
            <p>
              +221 78 122 03 91
              <br />
              sowhamedou10@gmail.com
            </p>
          </div>
        </div>
        <div className="dw-footer-bottom">
          © 2026 DerewolPrint — Conçu à Saint-Louis, Sénégal 🇸🇳
        </div>
      </footer>
    </div>
  );
}
