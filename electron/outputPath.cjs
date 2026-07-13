const fs = require("node:fs");
const path = require("node:path");
const { app, shell } = require("electron");

/**
 * One output folder, always.
 *
 * Preference is stored in Electron userData so it survives rebuilds,
 * folder moves of the app, and packaged vs dev launches.
 * Change it from the editor UI ("Change output folder").
 */

function isTempPath(target) {
  const normalized = path.normalize(String(target)).toLowerCase();
  return (
    normalized.includes(`${path.sep}temp${path.sep}`) ||
    normalized.includes(`${path.sep}tmp${path.sep}`) ||
    normalized.endsWith(`${path.sep}temp`) ||
    normalized.endsWith(`${path.sep}tmp`)
  );
}

function settingsPath() {
  return path.join(app.getPath("userData"), "smash-drums-editor-settings.json");
}

function readSettings() {
  try {
    const raw = fs.readFileSync(settingsPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    /* missing or invalid — use defaults */
  }
  return {};
}

function writeSettings(next) {
  const file = settingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), "utf8");
}

/** Stable default — never relative to the .exe / asar. */
function defaultOutputRoot() {
  return path.normalize(
    path.join(
      app.getPath("desktop"),
      "Smash Drums Editor",
      "SmashDrumsEditor",
      "output"
    )
  );
}

function validateOutputRoot(candidate) {
  const root = path.normalize(String(candidate || "").trim());
  if (!root) {
    throw new Error("Output folder path is empty");
  }
  if (!path.isAbsolute(root)) {
    throw new Error("Output folder must be an absolute path");
  }
  if (isTempPath(root)) {
    throw new Error("Refusing to save exports to a temp folder");
  }
  return root;
}

/**
 * Returns the configured output root (does not create it).
 * If a saved preference is invalid, falls back to the default.
 */
function getOutputRoot() {
  const settings = readSettings();
  if (typeof settings.outputDir === "string" && settings.outputDir.trim()) {
    try {
      return validateOutputRoot(settings.outputDir);
    } catch {
      /* fall through to default */
    }
  }
  return defaultOutputRoot();
}

/** Create the folder if needed and return it. */
function ensureOutputRoot() {
  const root = getOutputRoot();
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/**
 * Persist a new output folder. Creates it immediately.
 * @returns {string} normalized absolute path
 */
function setOutputRoot(candidate) {
  const root = validateOutputRoot(candidate);
  fs.mkdirSync(root, { recursive: true });
  const settings = readSettings();
  settings.outputDir = root;
  writeSettings(settings);
  return root;
}

/** Reset to the default Desktop path. */
function resetOutputRoot() {
  return setOutputRoot(defaultOutputRoot());
}

function resolveOutputPath(relativePath) {
  const root = ensureOutputRoot();
  const safe = String(relativePath)
    .replace(/^[\\/]+/, "")
    .replace(/\.\.(\/|\\|$)/g, "");
  const full = path.normalize(path.join(root, safe));
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (full !== root && !full.startsWith(rootWithSep)) {
    throw new Error("Invalid output path");
  }
  fs.mkdirSync(path.dirname(full), { recursive: true });
  return full;
}

function openOutputRoot() {
  const root = ensureOutputRoot();
  return shell.openPath(root);
}

module.exports = {
  getOutputRoot,
  ensureOutputRoot,
  setOutputRoot,
  resetOutputRoot,
  defaultOutputRoot,
  resolveOutputPath,
  openOutputRoot,
  isTempPath,
  validateOutputRoot,
};
