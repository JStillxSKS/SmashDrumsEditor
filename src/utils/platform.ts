import { Capacitor } from "@capacitor/core";

/** True inside the Electron desktop shell. */
export function isDesktop(): boolean {
  return Boolean(window.electronAPI?.isDesktop);
}

/** True inside the Capacitor native shell (Android APK). */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** True specifically on Android (the only native target today). */
export function isNativeAndroid(): boolean {
  try {
    return Capacitor.getPlatform() === "android";
  } catch {
    return false;
  }
}

/** Plain browser (not Electron, not Capacitor). */
export function isPlainBrowser(): boolean {
  return !isDesktop() && !isNativeApp();
}
