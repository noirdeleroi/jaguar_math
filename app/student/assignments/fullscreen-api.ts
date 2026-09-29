type WebKitDocument = Document & {
  webkitFullscreenElement?: Element | null;
};

type WebKitElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenNavigator = Pick<Navigator, "maxTouchPoints" | "platform" | "userAgent">;

export function isIPadOS(navigatorTarget: FullscreenNavigator = navigator) {
  return /iPad/i.test(navigatorTarget.userAgent)
    || (navigatorTarget.platform === "MacIntel" && navigatorTarget.maxTouchPoints > 1);
}

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

// iPadOS may temporarily discard WebKit's fullscreen element while opening the
// software keyboard or reconciling a client-side page update. In iPad test mode
// visibility is the stable security boundary: switching tabs/apps still hides
// the document, while typing and live updates keep it visible.
export function isSecureTestFullscreenActive(
  documentTarget: Document = document,
  navigatorTarget: FullscreenNavigator = navigator,
) {
  if (isIPadOS(navigatorTarget)) return documentTarget.visibilityState !== "hidden";
  return isFullscreenActive(documentTarget);
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

export function canEnterSecureTestFullscreen(
  element: HTMLElement = document.documentElement,
  navigatorTarget: FullscreenNavigator = navigator,
) {
  return isIPadOS(navigatorTarget) || canRequestFullscreen(element);
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

export async function requestSecureTestFullscreen(
  element: HTMLElement = document.documentElement,
  navigatorTarget: FullscreenNavigator = navigator,
) {
  if (!isIPadOS(navigatorTarget)) return requestAppFullscreen(element);
  const documentIsVisible = () => element.ownerDocument.visibilityState !== "hidden";
  if (!documentIsVisible()) return false;

  // Use native fullscreen when WebKit supports it, but do not make iPad test
  // mode depend on an API that is unstable around the on-screen keyboard.
  if (canRequestFullscreen(element) && !isFullscreenActive(element.ownerDocument)) {
    try { await requestAppFullscreen(element); } catch { /* Visible iPad test mode remains available. */ }
  }
  return documentIsVisible();
}
