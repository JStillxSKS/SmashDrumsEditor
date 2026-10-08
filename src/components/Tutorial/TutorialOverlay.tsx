import { useCallback, useEffect, useState } from "react";
import { useEditorStore } from "../../store/useEditorStore";
import { useTutorialStore } from "../../store/useTutorialStore";
import {
  TUTORIAL_STEPS,
  TUTORIAL_STEP_COUNT,
  type TutorialWatch,
} from "./tutorialSteps";
import { useMobileLayout } from "../../hooks/useMobileLayout";

type SpotRect = { x: number; y: number; w: number; h: number };

/** Ask the studio shell to open the left drawer (metadata step on mobile). */
function requestLeftDrawer(): void {
  window.dispatchEvent(new CustomEvent("sde:tutorial-open-left"));
}

function findTarget(name: string): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(`[data-tutorial="${name}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  // Hidden (collapsed drawer) or fully off-screen targets can't be spotlighted.
  if (r.width === 0 && r.height === 0) return null;
  return el;
}

/**
 * Spotlight tour overlay. The highlight ring is pointer-events:none so the
 * user can still click the real control underneath; only the tooltip card
 * captures pointer events.
 */
export function TutorialOverlay() {
  const active = useTutorialStore((s) => s.active);
  const stepIndex = useTutorialStore((s) => s.stepIndex);
  const next = useTutorialStore((s) => s.next);
  const back = useTutorialStore((s) => s.back);
  const skip = useTutorialStore((s) => s.skip);
  const finish = useTutorialStore((s) => s.finish);
  const { isMobileShell } = useMobileLayout();

  const audioLoaded = useEditorStore((s) => Boolean(s.audioBuffer));
  const noteCount = useEditorStore((s) => s.charts[s.difficulty].length);
  const hasTitle = useEditorStore(
    (s) => Boolean(s.meta.NameSong.trim() || s.meta.NameArtist.trim())
  );

  const [spot, setSpot] = useState<SpotRect | null>(null);
  const [measureTick, setMeasureTick] = useState(0);

  const step = TUTORIAL_STEPS[Math.min(stepIndex, TUTORIAL_STEP_COUNT - 1)];
  const isLast = stepIndex >= TUTORIAL_STEP_COUNT - 1;
  const watch: TutorialWatch = { audioLoaded, noteCount, hasTitle };
  const gateMet = step.gate ? step.gate.isMet(watch) : true;

  const measure = useCallback(() => {
    if (!step.target) {
      setSpot(null);
      return;
    }
    const el = findTarget(step.target);
    if (!el) {
      setSpot(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setSpot({ x: r.left, y: r.top, w: r.width, h: r.height });
  }, [step]);

  // Re-measure on step change, layout shifts, resize and scroll.
  useEffect(() => {
    if (!active) return;
    measure();
    const bump = () => setMeasureTick((t) => t + 1);
    window.addEventListener("resize", bump);
    window.addEventListener("scroll", bump, true);
    const t = window.setTimeout(measure, 350);
    return () => {
      window.removeEventListener("resize", bump);
      window.removeEventListener("scroll", bump, true);
      window.clearTimeout(t);
    };
  }, [active, measure, measureTick]);

  // Metadata step: on mobile the left panel is a closed drawer — open it,
  // then retry measuring a few times while it animates open.
  useEffect(() => {
    if (!active || step.target !== "sidebar-metadata" || !isMobileShell) return;
    if (findTarget("sidebar-metadata")) return;
    requestLeftDrawer();
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (findTarget("sidebar-metadata") || attempts >= 8) {
        window.clearInterval(timer);
      }
      measure();
    }, 300);
    return () => window.clearInterval(timer);
  }, [active, step, isMobileShell, measure]);

  if (!active || !step) return null;

  const narrow = typeof window !== "undefined" && window.innerWidth < 720;

  // Tooltip placement: below the spotlight when there's room, else above.
  // Narrow screens always get a bottom sheet so nothing clips.
  let tooltipStyle: React.CSSProperties | undefined;
  if (spot && !narrow) {
    const estHeight = 240;
    const gap = 12;
    const width = Math.min(340, window.innerWidth - 24);
    let left = spot.x + spot.w / 2 - width / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
    const belowFits = spot.y + spot.h + gap + estHeight <= window.innerHeight;
    tooltipStyle = {
      left,
      width,
      ...(belowFits
        ? { top: spot.y + spot.h + gap }
        : { bottom: Math.max(12, window.innerHeight - spot.y + gap) }),
    };
  }

  const onPrimary = () => {
    if (!gateMet) return;
    if (isLast) finish();
    else next();
  };

  return (
    <div className="tutorial-root" role="dialog" aria-modal="true" aria-label={step.title}>
      {spot && (
        <div
          className="tutorial-spotlight"
          style={{
            left: spot.x - 6,
            top: spot.y - 6,
            width: spot.w + 12,
            height: spot.h + 12,
          }}
          aria-hidden
        />
      )}
      <div
        className={`tutorial-tooltip${!spot || narrow ? " tutorial-tooltip--sheet" : ""}`}
        style={tooltipStyle}
      >
        <div className="tutorial-progress">
          <span className="tutorial-kicker">
            Step {stepIndex + 1} of {TUTORIAL_STEP_COUNT}
          </span>
          <div className="tutorial-progressbar" aria-hidden>
            <div
              className="tutorial-progressbar-fill"
              style={{ width: `${((stepIndex + 1) / TUTORIAL_STEP_COUNT) * 100}%` }}
            />
          </div>
        </div>
        <h2 className="tutorial-title">{step.title}</h2>
        <p className="tutorial-body">{step.body}</p>
        {step.gate && !gateMet && (
          <p className="tutorial-gate-hint" role="status">
            {step.gate.hint}
          </p>
        )}
        <div className="tutorial-actions">
          <button
            type="button"
            className="btn tutorial-btn"
            onClick={back}
            disabled={stepIndex === 0}
          >
            Back
          </button>
          <button type="button" className="btn tutorial-btn tutorial-btn--quiet" onClick={skip}>
            Skip tour
          </button>
          <button
            type="button"
            className="btn btn-accent tutorial-btn tutorial-btn--primary"
            onClick={onPrimary}
            disabled={!gateMet}
            title={!gateMet && step.gate ? step.gate.hint : undefined}
          >
            {isLast ? "Finish" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
