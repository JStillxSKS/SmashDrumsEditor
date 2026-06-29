const fs = require("node:fs");
const path = require("node:path");
const { app, shell } = require("electron");

function getOutputRoot() {
  return path.join(app.getPath("desktop"), "Smash Drums Editor", "output");
}

function ensureOutputRoot() {
  const root = getOutputRoot();
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function resolveOutputPath(relativePath) {
  const root = ensureOutputRoot();
  const safe = String(relativePath)
    .replace(/^[\\/]+/, "")
    .replace(/\.\.(\/|\\|$)/g, "");
  const full = path.normalize(path.join(root, safe));
  if (!full.startsWith(root)) {
    throw new Error("Invalid output path");
  }
  fs.mkdirSync(path.dirname(full), { recursive: true });
  return full;
}

function openOutputRoot() {
  const root = ensureOutputRoot();
  return shell.openPath(root);
}

module.exports = { getOutputRoot, ensureOutputRoot, resolveOutputPath, openOutputRoot };