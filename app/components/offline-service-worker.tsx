"use client";

import { useEffect } from "react";

export function OfflineServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await Promise.race([
          new Promise<void>((resolve) => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true })),
          new Promise<void>((resolve) => window.setTimeout(resolve, 2000)),
        ]);
      }
      if (window.location.pathname === "/teacher/stars" || /^\/teacher\/classes\/[^/]+\/stars$/.test(window.location.pathname)) {
        await fetch(window.location.href, { cache: "reload", headers: { Accept: "text/html" } });
      }
    }).catch(() => {
      // The Stars page still keeps unsaved changes in localStorage if offline caching is unavailable.
    });
  }, []);

  return null;
}
