import { useMobileLayout, type MobileLayoutPref } from "../hooks/useMobileLayout";

type Props = {
  open: boolean;
};

export function MobileLayoutGate({ open }: Props) {
  const { setPref, closeGateWithoutChoice, pref, reopenGate } = useMobileLayout();

  if (!open) return null;

  const pick = (layout: MobileLayoutPref) => {
    setPref(layout);
  };

  return (
    <div className="mobile-layout-gate" role="dialog" aria-modal="true" aria-labelledby="mobile-layout-title">
      <div className="mobile-layout-gate-card">
        <img className="mobile-layout-gate-logo" src="/app-icon.jpg" alt="" aria-hidden />
        <h2 id="mobile-layout-title">Smash Drums Editor</h2>
        <p className="mobile-layout-gate-lead">
          Optimized charting layout for this device. You can switch later from the toolbar.
        </p>
        <p className="mobile-layout-gate-note">
          Uses a tall highway with a thin side overview — works upright or sideways.
        </p>

        <div className="mobile-layout-gate-options">
          <button
            type="button"
            className="mobile-layout-option"
            onClick={() => pick("mobile")}
          >
            <span className="mobile-layout-option-icon mobile-layout-option-icon--landscape" aria-hidden />
            <span className="mobile-layout-option-title">Mobile charting</span>
            <span className="mobile-layout-option-desc">
              Max highway, side overview, touch tools. Best for phones and headsets.
            </span>
          </button>
        </div>

        <button
          type="button"
          className="btn mobile-layout-desktop-link"
          onClick={() => pick("desktop")}
        >
          Use desktop layout
        </button>

        {reopenGate && pref != null && (
          <button
            type="button"
            className="btn btn-sm mobile-layout-cancel"
            onClick={closeGateWithoutChoice}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
