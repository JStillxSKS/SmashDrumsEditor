const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const {
  getOutputRoot,
  ensureOutputRoot,
  setOutputRoot,
  resetOutputRoot,
  resolveOutputPath,
  openOutputRoot,
  isTempPath,
} = require("./outputPath.cjs");
const { startStaticServer } = require("./staticServer.cjs");

const isDev = !app.isPackaged;
const devUrl = process.env.ELECTRON_START_URL || "http://127.0.0.1:5174";
const distRoot = path.join(__dirname, "..", "dist");

/** @type {import("node:http").Server | null} */
let staticServer = null;
let appUrl = devUrl;

async function ensureAppUrl() {
  if (isDev) {
    appUrl = devUrl;
    return;
  }
  if (appUrl && staticServer) return;
  const { server, url } = await startStaticServer(distRoot);
  staticServer = server;
  appUrl = url;
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.webContents.on("did-fail-load", (_event, code, description, validatedURL) => {
    dialog.showErrorBox(
      "Smash Drums Editor failed to load",
      `${description} (${code})\n\nURL: ${validatedURL || appUrl}`
    );
  });

  mainWindow.loadURL(appUrl).catch((err) => {
    dialog.showErrorBox("Smash Drums Editor failed to load", String(err));
  });
}

ipcMain.handle("shell:openExternal", (_event, url) => {
  const target = String(url);
  if (!/^https?:\/\//i.test(target)) {
    throw new Error("Only http(s) URLs can be opened externally");
  }
  return shell.openExternal(target);
});

ipcMain.handle("output:getDir", () => ensureOutputRoot());

ipcMain.handle("output:open", () => openOutputRoot());

ipcMain.handle("output:setDir", (_event, dirPath) => {
  return setOutputRoot(dirPath);
});

ipcMain.handle("output:resetDir", () => {
  return resetOutputRoot();
});

ipcMain.handle("output:pickDir", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const current = (() => {
    try {
      return getOutputRoot();
    } catch {
      return undefined;
    }
  })();
  const { canceled, filePaths } = await dialog.showOpenDialog(win ?? undefined, {
    title: "Choose Smash Drums Editor output folder",
    defaultPath: current,
    properties: ["openDirectory", "createDirectory"],
  });
  if (canceled || !filePaths?.[0]) return null;
  return setOutputRoot(filePaths[0]);
});

ipcMain.handle("import:pickFile", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Import chart",
    properties: ["openFile"],
    filters: [
      {
        name: "Smash Drums / Paradiddle / Clone Hero",
        extensions: ["indies", "rlrr", "json", "chart"],
      },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (canceled || !filePaths?.[0]) return null;

  const filePath = filePaths[0];
  const data = fs.readFileSync(filePath);
  return {
    path: filePath,
    name: path.basename(filePath),
    bytes: Array.from(data),
  };
});

ipcMain.handle("fs:readSibling", (_event, { sourceFilePath, siblingName }) => {
  const dir = path.dirname(sourceFilePath);
  const safeName = path.basename(String(siblingName));
  const fullPath = path.join(dir, safeName);
  if (!fs.existsSync(fullPath)) return null;

  const ext = path.extname(safeName).toLowerCase();
  const mimeByExt = {
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
  };

  const data = fs.readFileSync(fullPath);
  return {
    name: safeName,
    bytes: Array.from(data),
    mimeType: mimeByExt[ext] ?? "application/octet-stream",
  };
});

ipcMain.handle("output:save", (_event, { relativePath, data, encoding }) => {
  try {
    const fullPath = resolveOutputPath(relativePath);
    const payload = encoding === "base64" ? Buffer.from(data, "base64") : String(data);
    fs.writeFileSync(fullPath, payload);
    return { path: fullPath, displayPath: fullPath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not save to output folder.\n${msg}\n\nUse "Change output folder" in the toolbar to pick a valid folder.`
    );
  }
});

ipcMain.handle("output:saveBinary", (_event, { relativePath, bytes }) => {
  try {
    const fullPath = resolveOutputPath(relativePath);
    fs.writeFileSync(fullPath, Buffer.from(bytes));
    return { path: fullPath, displayPath: fullPath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not save to output folder.\n${msg}\n\nUse "Change output folder" in the toolbar to pick a valid folder.`
    );
  }
});

ipcMain.handle("file:saveBinary", (_event, { absolutePath, bytes }) => {
  try {
    const target = path.normalize(String(absolutePath));
    if (!path.isAbsolute(target)) {
      throw new Error("Refusing to save outside an absolute path");
    }
    if (isTempPath(target)) {
      throw new Error("Refusing to save exports to a temp folder");
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(bytes));
    return { path: target, displayPath: target };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not save file.\n${msg}`);
  }
});

ipcMain.handle("output:backupIfExists", (_event, { relativePath }) => {
  try {
    const fullPath = resolveOutputPath(relativePath);
    if (!fs.existsSync(fullPath)) return { backedUp: false };
    const bak = `${fullPath}.bak`;
    fs.copyFileSync(fullPath, bak);
    return { backedUp: true, path: bak };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not create backup in output folder.\n${msg}`);
  }
});

ipcMain.handle("output:readBinary", (_event, { relativePath }) => {
  const fullPath = resolveOutputPath(relativePath);
  if (!fs.existsSync(fullPath)) return null;
  return Array.from(fs.readFileSync(fullPath));
});

ipcMain.handle("output:listRecovery", () => {
  const root = ensureOutputRoot();
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .filter(
      (entry) =>
        entry.name.endsWith(".autosave.indies") || entry.name.endsWith(".indies.bak")
    )
    .map((entry) => {
      const full = path.join(root, entry.name);
      return { name: entry.name, path: full, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
});

app.whenReady().then(async () => {
  try {
    await ensureAppUrl();
    // Create + pin the output folder on every launch so Save never hits a missing dir.
    ensureOutputRoot();
  } catch (err) {
    dialog.showErrorBox("Smash Drums Editor failed to start", String(err));
    app.quit();
    return;
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("will-quit", () => {
  if (staticServer) {
    staticServer.close();
    staticServer = null;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});