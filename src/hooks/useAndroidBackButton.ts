import { useEffect, useRef, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { isNativeApp } from "../utils/platform";
import { useShellStore } from "../store/useShellStore";

/** Return true to consume the back press. */
type BackHandler = () => boolean;

const handlers: BackHandler[] = [];

export function registerBackHandler(handler: BackHandler): () => void {
  handlers.push(handler);
  return () => {
    const idx = handlers.indexOf(handler);
    if (idx >= 0) handlers.splice(idx, 1);
  };
}

/**
 * Let an open modal/drawer/panel consume the hardware back button.
 * Most recently registered handler wins; return true when you handled it.
 */
export function useBackHandler(handler: BackHandler, active: boolean): void {
  useEffect(() => {
    if (!active || !isNativeApp()) return;
    return registerBackHandler(handler);
  }, [handler, active]);
}

/**
 * Mount once near the app root. Handles Android hardware back:
 * open UI layers first (via useBackHandler), then shell screens back to Home,
 * then double-press to exit. Returns the "press again to exit" toast text.
 */
export function useAndroidBackButton(): string | null {
  const [toast, setToast] = useState<string | null>(null);
  const lastExitPress = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isNativeApp()) return;

    const sub = CapacitorApp.addListener("backButton", () => {
      for (let i = handlers.length - 1; i >= 0; i--) {
        try {
          if (handlers[i]()) return;
        } catch {
          // faulty handler — keep walking the stack
        }
      }

      const shell = useShellStore.getState();
      if (shell.mode !== "home") {
        shell.goHome();
        return;
      }

      const now = Date.now();
      if (now - lastExitPress.current < 2000) {
        void CapacitorApp.exitApp();
        return;
      }
      lastExitPress.current = now;
      setToast("Press back again to exit");
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 2000);
    });

    return () => {
      void sub.then((handle) => handle.remove());
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  return toast;
}
