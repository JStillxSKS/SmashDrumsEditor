const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
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

ipcMain.handle("import:pickAudio", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Choose song audio",
    properties: ["openFile"],
    filters: [
      {
        name: "Audio",
        extensions: ["mp3", "ogg", "wav", "flac", "m4a", "aac", "opus", "webm"],
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

ipcMain.handle("output:listIndies", () => {
  const root = ensureOutputRoot();
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .filter((entry) => entry.name.toLowerCase().endsWith(".indies"))
    .filter((entry) => !entry.name.endsWith(".autosave.indies"))
    .map((entry) => {
      const full = path.join(root, entry.name);
      const stat = fs.statSync(full);
      return {
        name: entry.name,
        path: full,
        mtime: stat.mtimeMs,
        size: stat.size,
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
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

// ---------------------------------------------------------------------------
// Auto-Charter (Python CLI) — audio file → .indies drum chart
// ---------------------------------------------------------------------------

const AUTO_CHARTER_SCRIPT = "auto_charter.py";
const PYTHON_DETECT_TIMEOUT_MS = 10_000;
const AUTO_CHARTER_ERROR_TAIL = 50;

// One run at a time: concurrent runs would race on the same output folder
// name and share Auto-Charter's .cache work dirs.
let autoCharterInFlight = false;

function findAutoCharterDir() {
  const home = process.env.USERPROFILE || app.getPath("home");
  const candidates = [
    process.env.AUTO_CHARTER_HOME,
    path.join(home, "Desktop", "Auto-Charter"),
    path.join(app.getAppPath(), "..", "..", "Auto-Charter"),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const dir = path.normalize(String(candidate));
    try {
      if (fs.existsSync(path.join(dir, AUTO_CHARTER_SCRIPT))) return dir;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/** Resolves { pythonPath } when `python --version` answers within the timeout. */
function detectPython() {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn("python", ["--version"], { windowsHide: true });
    } catch (err) {
      resolve({ pythonPath: null, reason: `could not spawn python: ${String(err)}` });
      return;
    }
    let settled = false;
    let output = "";
    const finish = (pythonPath, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ pythonPath, reason });
    };
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* already gone */
      }
      finish(null, "`python --version` did not answer within 10s");
    }, PYTHON_DETECT_TIMEOUT_MS);
    proc.stdout?.on("data", (chunk) => {
      output += chunk;
    });
    proc.stderr?.on("data", (chunk) => {
      output += chunk;
    });
    proc.on("error", (err) => finish(null, `python not found: ${err.message}`));
    proc.on("exit", (code) => {
      if (code === 0) {
        finish("python", null);
      } else {
        finish(null, `\`python --version\` exited ${code}: ${output.trim() || "no output"}`);
      }
    });
  });
}

ipcMain.handle("autocharter:status", async () => {
  const autoCharterDir = findAutoCharterDir();
  const python = await detectPython();
  const available = Boolean(python.pythonPath && autoCharterDir);
  let reason = null;
  if (!available) {
    if (!python.pythonPath && !autoCharterDir) {
      reason = `${python.reason}; Auto-Charter folder not found (set AUTO_CHARTER_HOME)`;
    } else if (!python.pythonPath) {
      reason = python.reason;
    } else {
      reason = "Auto-Charter folder not found (expected auto_charter.py; set AUTO_CHARTER_HOME)";
    }
  }
  return { available, pythonPath: python.pythonPath, autoCharterDir, reason };
});

ipcMain.handle("autocharter:run", (event, { audioPath } = {}) => {
  const autoCharterDir = findAutoCharterDir();
  if (!autoCharterDir) {
    throw new Error(
      "Auto-Charter installation not found. Expected auto_charter.py in " +
        "AUTO_CHARTER_HOME, Desktop\\Auto-Charter, or next to this app."
    );
  }
  const audio = path.normalize(String(audioPath || ""));
  if (!audio || !fs.existsSync(audio)) {
    throw new Error(`Audio file not found: ${audio || "(empty path)"}`);
  }
  const outRoot = ensureOutputRoot();
  if (autoCharterInFlight) {
    throw new Error("An Auto-Charter run is already in progress.");
  }
  autoCharterInFlight = true;

  return new Promise((resolve, reject) => {
    const settle = (fn, value) => {
      autoCharterInFlight = false;
      fn(value);
    };
    const send = (line) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("autocharter:progress", line);
      }
    };

    let proc;
    try {
      // No --force: the output root is the user's chart library, and Auto-Charter
      // would otherwise silently overwrite an existing same-title chart. Without
      // it the tool writes "Title (2).indies" instead, which the parser below
      // resolves from the printed `Indies:` line.
      proc = spawn("python", [AUTO_CHARTER_SCRIPT, audio, "--out", outRoot], {
        cwd: autoCharterDir,
        windowsHide: true,
      });
    } catch (err) {
      settle(reject, new Error(`Could not start Auto-Charter: ${String(err)}`));
      return;
    }

    const tail = []; // ring of recent lines for error reports
    const pushLine = (line) => {
      tail.push(line);
      if (tail.length > 200) tail.shift();
      send(line);
    };
    const makeLinePump = () => {
      let pending = "";
      return {
        feed(chunk) {
          pending += chunk;
          const parts = pending.split(/\r?\n/);
          pending = parts.pop() ?? "";
          for (const line of parts) pushLine(line);
        },
        flush() {
          if (pending.length > 0) {
            pushLine(pending);
            pending = "";
          }
        },
      };
    };
    const stdout = makeLinePump();
    const stderr = makeLinePump();
    proc.stdout?.on("data", stdout.feed);
    proc.stderr?.on("data", stderr.feed);

    proc.on("error", (err) => {
      settle(reject, new Error(`Could not start Auto-Charter (python): ${err.message}`));
    });

    // No timeout: ML model downloads + separation can take several minutes.
    // 'close' (not 'exit'): stdio streams are drained by then, so the final
    // `Indies:` line cannot be lost to a pipe-buffer race.
    proc.on("close", (code, signal) => {
      stdout.flush();
      stderr.flush();
      if (code !== 0) {
        const detail = tail.slice(-AUTO_CHARTER_ERROR_TAIL).join("\n");
        settle(
          reject,
          new Error(
            `Auto-Charter failed (exit code ${code}${signal ? `, signal ${signal}` : ""}).\n\nLast output:\n${detail}`
          )
        );
        return;
      }

      let indiesPath = null;
      for (let i = tail.length - 1; i >= 0; i--) {
        const m = tail[i].match(/Indies:\s+(.+?\.indies)\s*$/i);
        if (m) {
          const candidate = path.normalize(m[1]);
          if (fs.existsSync(candidate)) {
            indiesPath = candidate;
            break;
          }
        }
      }
      if (!indiesPath) {
        // Fallback: newest *.indies in the output root by mtime.
        const indiesFiles = fs
          .readdirSync(outRoot, { withFileTypes: true })
          .filter((entry) => entry.isFile())
          .filter((entry) => entry.name.toLowerCase().endsWith(".indies"))
          .map((entry) => path.join(outRoot, entry.name))
          .filter((full) => fs.existsSync(full));
        if (indiesFiles.length > 0) {
          indiesFiles.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
          indiesPath = indiesFiles[0];
        }
      }
      if (!indiesPath) {
        const detail = tail.slice(-AUTO_CHARTER_ERROR_TAIL).join("\n");
        settle(
          reject,
          new Error(
            `Auto-Charter finished but no .indies file was found.\n\nLast output:\n${detail}`
          )
        );
        return;
      }

      let report = null;
      const titleFolder = path.join(
        path.dirname(indiesPath),
        path.basename(indiesPath, ".indies")
      );
      const reportPath = path.join(titleFolder, "qc_report.txt");
      try {
        if (fs.existsSync(reportPath)) report = fs.readFileSync(reportPath, "utf8");
      } catch {
        report = null;
      }

      const data = fs.readFileSync(indiesPath);
      settle(resolve, {
        name: path.basename(indiesPath),
        path: indiesPath,
        bytes: Array.from(data),
        report,
      });
    });
  });
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