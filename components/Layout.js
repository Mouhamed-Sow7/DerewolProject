"use client";
import { useRouter } from "next/router";
import BottomNav from "./BottomNav";

export default function Layout({ children, className = "" }) {
  const router = useRouter();
  const pathname = router?.pathname || router?.asPath || "";
  const showBottomNav = pathname !== "/";

  const mainClass = [
    "layout-main",
    className,
    showBottomNav ? "layout-main--with-bottomnav" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <main className={mainClass}>{children}</main>
      {showBottomNav && <BottomNav />}
    </>
  );
}
