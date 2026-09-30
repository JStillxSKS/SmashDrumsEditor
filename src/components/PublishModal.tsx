import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../context/AuthContext";
import { useBackHandler } from "../hooks/useAndroidBackButton";
import { INDIES_DB_ORIGIN } from "../lib/indiesDbPublish";
import { supabase, supabaseConfigured } from "../lib/supabase";
import { useEditorStore } from "../store/useEditorStore";

type Mode = "signin" | "signup";

function friendlyError(msg: string): string {
  if (msg.includes("Invalid login credentials")) {
    return "Wrong email or password. Try Sign Up if you never set a password.";
  }
  if (msg.includes("User already registered")) {
    return "Account exists — use Sign In with your password.";
  }
  if (msg.includes("Email not confirmed")) {
    return "Confirm your email first, or disable email confirmation in Supabase.";
  }
  return msg;
}

function openMapUrl(url: string) {
  if (window.electronAPI?.openExternal) {
    void window.electronAPI.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

type PublishModalProps = {
  open: boolean;
  onClose: () => void;
};

export function PublishModal({ open, onClose }: PublishModalProps) {
  const { user, loading: authLoading, signInWithPassword, signUpWithPassword, signOut } =
    useAuth();
  const { meta, publishingIndies, publishToIndiesDb, audioFile, audioBuffer } = useEditorStore();
  const hasAudio = Boolean(audioFile && audioBuffer);

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [wasUpdate, setWasUpdate] = useState(false);
  const [explicit, setExplicit] = useState(false);

  const linkedMapId = meta.IndiesDbMapId?.trim();

  // Hardware back (Android) closes the modal instead of leaving the app.
  useBackHandler(() => {
    onClose();
    return true;
  }, open);

  useEffect(() => {
    if (!open) return;
    setExplicit(false);
    if (!linkedMapId || !supabase) return;

    void supabase
      .from("maps")
      .select("explicit")
      .eq("id", linkedMapId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setExplicit(Boolean(data.explicit));
      });
  }, [open, linkedMapId]);

  if (!open) return null;

  function handleClose() {
    if (publishingIndies) return;
    setPublishError(null);
    setPublishedUrl(null);
    onClose();
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAuthBusy(true);
    setAuthError(null);

    const result =
      mode === "signin"
        ? await signInWithPassword(email, password)
        : await signUpWithPassword(email, password);

    setAuthBusy(false);

    if (result.error) {
      setAuthError(friendlyError(result.error));
      return;
    }

    if (!result.session && mode === "signup") {
      setAuthError(
        "Account may need email confirmation. Check inbox or disable confirm email in Supabase."
      );
      setMode("signin");
    }
  }

  async function handlePublish() {
    setPublishError(null);
    setPublishedUrl(null);
    try {
      const result = await publishToIndiesDb(explicit);
      setPublishedUrl(result.mapUrl);
      setWasUpdate(result.isUpdate);
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : "Publish failed");
    }
  }

  const title = meta.NameSong?.trim() || "Untitled Song";
  const artist = meta.NameArtist?.trim() || "Unknown Artist";

  return createPortal(
    <div className="publish-overlay" onClick={handleClose}>
      <div
        className="publish-dialog"
        role="dialog"
        aria-labelledby="publish-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="publish-close" onClick={handleClose} aria-label="Close">
          ×
        </button>

        <h2 id="publish-dialog-title">Publish to Indies-DB</h2>
        <p className="publish-lead">
          Upload your map to{" "}
          <a href={INDIES_DB_ORIGIN} onClick={(e) => { e.preventDefault(); openMapUrl(INDIES_DB_ORIGIN); }}>
            indies-db.vercel.app
          </a>{" "}
          so others can browse, download, and compete on leaderboards.
        </p>

        {!supabaseConfigured ? (
          <p className="publish-error">
            Supabase is not configured. Copy <code>.env.example</code> to <code>.env</code> and add
            your Indies-DB Supabase URL and anon key, then restart the editor.
          </p>
        ) : authLoading ? (
          <p className="publish-muted">Checking sign-in…</p>
        ) : publishedUrl ? (
          <div className="publish-success">
            <p>
              {wasUpdate ? "Map updated on Indies-DB." : "Map published to Indies-DB."}
            </p>
            <p className="publish-muted">
              <code>IndiesDbMapId</code> was saved in your project for future updates and score
              linking.
            </p>
            <div className="publish-actions">
              <button type="button" className="btn publish-btn" onClick={() => openMapUrl(publishedUrl)}>
                View on Indies-DB
              </button>
              <button type="button" className="btn" onClick={handleClose}>
                Done
              </button>
            </div>
          </div>
        ) : !user ? (
          <>
            <div className="publish-mode-toggle">
              {(["signin", "signup"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={mode === m ? "btn btn-sm active" : "btn btn-sm"}
                  onClick={() => {
                    setMode(m);
                    setAuthError(null);
                  }}
                >
                  {m === "signin" ? "Sign In" : "Sign Up"}
                </button>
              ))}
            </div>
            <form className="publish-form" onSubmit={handlePasswordSubmit}>
              <input
                type="email"
                required
                autoComplete="email"
                placeholder="you@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <input
                type="password"
                required
                minLength={6}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                placeholder="Password (6+ characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {authError && <p className="publish-error">{authError}</p>}
              <button type="submit" className="btn publish-btn" disabled={authBusy}>
                {authBusy ? "Please wait…" : mode === "signin" ? "Sign In" : "Create Account"}
              </button>
            </form>
          </>
        ) : (
          <>
            <dl className="publish-preview">
              <div>
                <dt>Song</dt>
                <dd>{title}</dd>
              </div>
              <div>
                <dt>Artist</dt>
                <dd>{artist}</dd>
              </div>
              <div>
                <dt>Charter</dt>
                <dd>{meta.NameCharter?.trim() || "Unknown Charter"}</dd>
              </div>
              {linkedMapId && (
                <div>
                  <dt>Indies-DB</dt>
                  <dd>Updating existing map</dd>
                </div>
              )}
            </dl>

            <label className="publish-explicit">
              <input
                type="checkbox"
                checked={explicit}
                onChange={(e) => setExplicit(e.target.checked)}
              />
              <span>
                <strong>Explicit language</strong>
                <span className="publish-muted">
                  Check if the song contains swearing or other explicit lyrics.
                </span>
              </span>
            </label>

            <p className="publish-muted publish-signed-in">
              Signed in as {user.email}
              <button type="button" className="publish-link-btn" onClick={() => void signOut()}>
                Sign out
              </button>
            </p>

            {!hasAudio && (
              <p className="publish-error">Load song audio before publishing to Indies-DB.</p>
            )}
            {publishError && <p className="publish-error">{publishError}</p>}

            <div className="publish-actions">
              <button
                type="button"
                className="btn publish-btn"
                disabled={publishingIndies || !hasAudio}
                onClick={() => void handlePublish()}
              >
                {publishingIndies
                  ? "Publishing…"
                  : linkedMapId
                    ? "Update on Indies-DB"
                    : "Publish to Indies-DB"}
              </button>
              <button type="button" className="btn" disabled={publishingIndies} onClick={handleClose}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}