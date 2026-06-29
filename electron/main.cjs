const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { getOutputRoot, resolveOutputPath, openOutputRoot } = require("./outputPath.cjs");
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

ipcMain.handle("output:getDir", () => getOutputRoot());

ipcMain.handle("output:open", () => openOutputRoot());

ipcMain.handle("output:save", (_event, { relativePath, data, encoding }) => {
  const fullPath = resolveOutputPath(relativePath);
  const payload = encoding === "base64" ? Buffer.from(data, "base64") : String(data);
  fs.writeFileSync(fullPath, payload);
  return { path: fullPath, displayPath: fullPath };
});

ipcMain.handle("output:saveBinary", (_event, { relativePath, bytes }) => {
  const fullPath = resolveOutputPath(relativePath);
  fs.writeFileSync(fullPath, Buffer.from(bytes));
  return { path: fullPath, displayPath: fullPath };
});

app.whenReady().then(async () => {
  try {
    await ensureAppUrl();
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