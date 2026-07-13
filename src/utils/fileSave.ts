export type SaveResult =
  | { method: "disk"; path: string; displayPath: string }
  | { method: "download"; filename: string };

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function triggerTextDownload(content: string, filename: string): void {
  triggerDownload(new Blob([content], { type: "text/plain;charset=utf-8" }), filename);
}

export async function saveTextFile(
  relativePath: string,
  content: string
): Promise<SaveResult> {
  const api = window.electronAPI;
  if (api?.isDesktop) {
    const saved = await api.saveFile(relativePath, content, "utf8");
    return { method: "disk", path: saved.path, displayPath: saved.displayPath };
  }
  const filename = relativePath.split(/[/\\]/).pop() ?? relativePath;
  triggerTextDownload(content, filename);
  return { method: "download", filename };
}

export async function saveBlobFile(
  relativePath: string,
  blob: Blob,
  options?: { backup?: boolean }
): Promise<SaveResult> {
  const api = window.electronAPI;
  if (api?.isDesktop) {
    if (options?.backup && api.backupOutputIfExists) {
      await api.backupOutputIfExists(relativePath);
    }
    const buffer = await blob.arrayBuffer();
    const saved = await api.saveBinaryFile(relativePath, new Uint8Array(buffer));
    return { method: "disk", path: saved.path, displayPath: saved.displayPath };
  }
  const filename = relativePath.split(/[/\\]/).pop() ?? relativePath;
  triggerDownload(blob, filename);
  return { method: "download", filename };
}

/** Overwrite an existing file at an absolute path (desktop app only). */
export async function saveBlobToAbsolutePath(
  absolutePath: string,
  blob: Blob
): Promise<SaveResult> {
  const api = window.electronAPI;
  if (api?.isDesktop) {
    const buffer = await blob.arrayBuffer();
    const saved = await api.saveBinaryToPath(absolutePath, new Uint8Array(buffer));
    return { method: "disk", path: saved.path, displayPath: saved.displayPath };
  }
  const filename = absolutePath.split(/[/\\]/).pop() ?? "song.indies";
  triggerDownload(blob, filename);
  return { method: "download", filename };
}

export async function openOutputFolder(): Promise<string | null> {
  const api = window.electronAPI;
  if (!api?.isDesktop) return null;
  return api.openOutputDir();
}

export async function getOutputFolder(): Promise<string | null> {
  const api = window.electronAPI;
  if (!api?.isDesktop) return null;
  return api.getOutputDir();
}

/** Desktop folder picker — persists the choice for all future saves. */
export async function pickOutputFolder(): Promise<string | null> {
  const api = window.electronAPI;
  if (!api?.isDesktop || !api.pickOutputDir) return null;
  return api.pickOutputDir();
}

export async function resetOutputFolder(): Promise<string | null> {
  const api = window.electronAPI;
  if (!api?.isDesktop || !api.resetOutputDir) return null;
  return api.resetOutputDir();
}