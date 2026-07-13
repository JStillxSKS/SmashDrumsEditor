const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isDesktop: true,
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
  getOutputDir: () => ipcRenderer.invoke("output:getDir"),
  setOutputDir: (dirPath) => ipcRenderer.invoke("output:setDir", dirPath),
  pickOutputDir: () => ipcRenderer.invoke("output:pickDir"),
  resetOutputDir: () => ipcRenderer.invoke("output:resetDir"),
  saveFile: (relativePath, data, encoding = "utf8") =>
    ipcRenderer.invoke("output:save", { relativePath, data, encoding }),
  saveBinaryFile: (relativePath, bytes) =>
    ipcRenderer.invoke("output:saveBinary", { relativePath, bytes }),
  saveBinaryToPath: (absolutePath, bytes) =>
    ipcRenderer.invoke("file:saveBinary", { absolutePath, bytes }),
  backupOutputIfExists: (relativePath) =>
    ipcRenderer.invoke("output:backupIfExists", { relativePath }),
  readOutputBinary: (relativePath) =>
    ipcRenderer.invoke("output:readBinary", { relativePath }),
  listRecoveryFiles: () => ipcRenderer.invoke("output:listRecovery"),
  openOutputDir: () => ipcRenderer.invoke("output:open"),
  getFilePath: (file) => webUtils.getPathForFile(file),
  pickImportFile: () => ipcRenderer.invoke("import:pickFile"),
  readSiblingFile: (sourceFilePath, siblingName) =>
    ipcRenderer.invoke("fs:readSibling", { sourceFilePath, siblingName }),
});