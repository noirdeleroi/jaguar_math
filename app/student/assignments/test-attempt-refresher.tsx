"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function TestAttemptRefresher() {
  const router = useRouter();

  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [router]);

  return null;
}
