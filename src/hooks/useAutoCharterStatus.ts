import { useEffect, useState } from "react";

export type AutoCharterStatus = {
  available: boolean;
  pythonPath: string | null;
  autoCharterDir: string | null;
  reason: string | null;
};

/**
 * Desktop-only Auto-Charter availability (Python + install dir), checked once
 * on mount. Returns null in the browser / while the check is in flight.
 */
export function useAutoCharterStatus(): AutoCharterStatus | null {
  const [status, setStatus] = useState<AutoCharterStatus | null>(null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.isDesktop || !api.autoCharterStatus) return;
    let live = true;
    api
      .autoCharterStatus()
      .then((s) => {
        if (live) setStatus(s);
      })
      .catch(() => {
        if (live) {
          setStatus({
            available: false,
            pythonPath: null,
            autoCharterDir: null,
            reason: "Auto-Charter check failed",
          });
        }
      });
    return () => {
      live = false;
    };
  }, []);

  return status;
}
