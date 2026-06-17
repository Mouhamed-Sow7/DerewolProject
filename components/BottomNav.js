"use client";
import Link from "next/link";
import { useRouter } from "next/router";
import { Home, QrCode, LayoutDashboard } from "lucide-react";

export default function BottomNav() {
  const router = useRouter();

  return (
    <nav
      className="bottom-nav"
      role="navigation"
      aria-label="Bottom Navigation"
    >
      <div className="bottom-nav__inner">
        <Link href="/" className="bottom-nav__btn" aria-label="Accueil">
          <Home size={22} strokeWidth={1.5} />
        </Link>

        <button
          type="button"
          className="bottom-nav__fab"
          aria-label="Scanner"
          onClick={() => router.push("/scan")}
        >
          <QrCode size={28} strokeWidth={1.5} />
        </button>

        <Link
          href="/dashboard"
          className="bottom-nav__btn"
          aria-label="Fichiers"
        >
          <LayoutDashboard size={22} strokeWidth={1.5} />
        </Link>
      </div>
    </nav>
  );
}
