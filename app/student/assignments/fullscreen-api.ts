type WebKitDocument = Document & {
  webkitFullscreenElement?: Element | null;
};

type WebKitElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

export function createFullscreenExitTracker() {
  let exitOpen = false;
  return {
    beginExit() {
      if (exitOpen) return false;
      exitOpen = true;
      return true;
    },
    markRestored() {
      exitOpen = false;
    },
  };
}

export function getFullscreenElement(documentTarget: Document = document) {
  const compatibleDocument = documentTarget as WebKitDocument;
  return documentTarget.fullscreenElement ?? compatibleDocument.webkitFullscreenElement ?? null;
}

export function isFullscreenActive(documentTarget: Document = document) {
  return Boolean(getFullscreenElement(documentTarget));
}

export function subscribeToFullscreen(callback: () => void, documentTarget: Document = document) {
  documentTarget.addEventListener("fullscreenchange", callback);
  documentTarget.addEventListener("webkitfullscreenchange", callback);
  return () => {
    documentTarget.removeEventListener("fullscreenchange", callback);
    documentTarget.removeEventListener("webkitfullscreenchange", callback);
  };
}

export function canRequestFullscreen(element: HTMLElement = document.documentElement) {
  const compatibleElement = element as WebKitElement;
  return typeof element.requestFullscreen === "function" || typeof compatibleElement.webkitRequestFullscreen === "function";
}

export async function requestAppFullscreen(element: HTMLElement = document.documentElement) {
  if (isFullscreenActive(element.ownerDocument)) return true;
  const compatibleElement = element as WebKitElement;
  const request = element.requestFullscreen ?? compatibleElement.webkitRequestFullscreen;
  if (!request) return false;

  await Promise.resolve(request.call(element));
  if (isFullscreenActive(element.ownerDocument)) return true;

  // Older WebKit returns before its prefixed fullscreen element is populated.
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      unsubscribe();
      window.clearTimeout(timeout);
      resolve();
    };
    const unsubscribe = subscribeToFullscreen(finish, element.ownerDocument);
    const timeout = window.setTimeout(finish, 800);
  });
  return isFullscreenActive(element.ownerDocument);
}
