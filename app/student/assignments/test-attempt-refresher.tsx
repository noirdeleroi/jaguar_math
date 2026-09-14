"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function TestAttemptRefresher() {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible" && navigator.onLine) router.refresh(); };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("online", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("online", refresh); };
  }, [router]);

  return null;
}
