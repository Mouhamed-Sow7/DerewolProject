"use client";
import { useRouter } from "next/router";
import { QrCode } from "lucide-react";

export default function BottomNav() {
  const router = useRouter();

  const handleScanClick = async () => {
    const target = "/scan";
    try {
      await router.push(target);
      if (
        typeof window !== "undefined" &&
        !window.location.pathname.startsWith("/scan")
      ) {
        window.location.href = target;
      }
    } catch (err) {
      if (typeof window !== "undefined") window.location.href = target;
    }
  };

  return (
    <nav
      className="bottom-nav pb-5 pb-[env(safe-area-inset-bottom,16px)]"
      role="navigation"
      aria-label="Bottom Navigation"
    >
      <div className="bottom-nav__inner">
        <button
          type="button"
          className="bottom-nav__fab mb-4"
          aria-label="Scanner"
          onClick={handleScanClick}
        >
          <QrCode size={28} strokeWidth={1.5} />
        </button>
      </div>
    </nav>
  );
}
