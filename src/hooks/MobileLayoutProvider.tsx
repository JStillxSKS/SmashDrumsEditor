import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  detectMobileCapable,
  MobileLayoutContext,
  readStoredPref,
  writeStoredPref,
  type MobileLayoutPref,
} from "./useMobileLayout";

export function MobileLayoutProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<MobileLayoutPref | null>(() =>
    readStoredPref()
  );
  const [mobileCapable, setMobileCapable] = useState(() => detectMobileCapable());
  const [reopenGate, setReopenGate] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px), (pointer: coarse)");
    const update = () => setMobileCapable(detectMobileCapable());
    update();
    mq.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      mq.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    // One mobile charting chrome (tall highway + side overview)
    if (pref === "mobile") {
      root.dataset.mobileLayout = "mobile";
    } else {
      delete root.dataset.mobileLayout;
    }
    return () => {
      delete root.dataset.mobileLayout;
    };
  }, [pref]);

  const setPref = useCallback((next: MobileLayoutPref) => {
    setPrefState(next);
    writeStoredPref(next);
    setReopenGate(false);
  }, []);

  const openGate = useCallback(() => {
    setReopenGate(true);
  }, []);

  const closeGateWithoutChoice = useCallback(() => {
    setReopenGate(false);
  }, []);

  const isMobileShell = mobileCapable && pref === "mobile";

  const showGate = mobileCapable && (pref == null || reopenGate);

  const value = useMemo(
    () => ({
      pref,
      isMobileShell,
      showGate,
      reopenGate,
      setPref,
      openGate,
      closeGateWithoutChoice,
    }),
    [
      pref,
      isMobileShell,
      showGate,
      reopenGate,
      setPref,
      openGate,
      closeGateWithoutChoice,
    ]
  );

  return (
    <MobileLayoutContext.Provider value={value}>
      {children}
    </MobileLayoutContext.Provider>
  );
}
