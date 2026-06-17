"use client";
import BottomNav from "./BottomNav";

export default function Layout({ children, className = "" }) {
  return (
    <>
      <main className={`layout-main ${className}`}>{children}</main>
      <BottomNav />
    </>
  );
}
