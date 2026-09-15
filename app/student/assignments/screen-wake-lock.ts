export type ScreenWakeLockHandle = {
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void, options?: { once?: boolean }) => void;
};

type WakeLockNavigator = {
  wakeLock?: { request: (type: "screen") => Promise<ScreenWakeLockHandle> };
};

export function canKeepScreenAwake(target: WakeLockNavigator = navigator) {
  return typeof target.wakeLock?.request === "function";
}

export async function requestScreenWakeLock(target: WakeLockNavigator = navigator) {
  if (!canKeepScreenAwake(target)) return null;
  try { return await target.wakeLock!.request("screen"); }
  catch { return null; }
}
