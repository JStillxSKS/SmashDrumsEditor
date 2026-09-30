import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { isNativeApp } from "./platform";

export type SaveResult =
  | { method: "disk"; path: string; displayPath: string }
  | { method: "native"; path: string; uri: string; filename: string }
  | { method: "download"; filename: string };

/** Folder (inside Documents) where Android exports land. */
export const NATIVE_EXPORTS_DIR = "SmashDrumsEditor";

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

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file data."));
    reader.readAsDataURL(blob);
  });
}

function basename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

/** Write into Documents/SmashDrumsEditor on the device, then optionally open the share sheet. */
async function nativeSave(
  relativePath: string,
  data: string,
  share: boolean
): Promise<SaveResult> {
  const path = `${NATIVE_EXPORTS_DIR}/${relativePath}`;
  await Filesystem.writeFile({
    path,
    data,
    directory: Directory.Documents,
    recursive: true,
  });
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Documents });
  if (share) {
    try {
      await Share.share({
        title: basename(relativePath),
        files: [uri],
        dialogTitle: "Send your chart",
      });
    } catch {
      // Share sheet dismissed or unavailable — the file is still on disk.
    }
  }
  return {
    method: "native",
    path: `Documents/${path}`,
    uri,
    filename: basename(relativePath),
  };
}

export async function saveTextFile(
  relativePath: string,
  content: string,
  options?: { share?: boolean }
): Promise<SaveResult> {
  const api = window.electronAPI;
  if (api?.isDesktop) {
    const saved = await api.saveFile(relativePath, content, "utf8");
    return { method: "disk", path: saved.path, displayPath: saved.displayPath };
  }
  if (isNativeApp()) {
    return nativeSave(relativePath, btoa(unescape(encodeURIComponent(content))), options?.share ?? false);
  }
  const filename = basename(relativePath);
  triggerTextDownload(content, filename);
  return { method: "download", filename };
}

export async function saveBlobFile(
  relativePath: string,
  blob: Blob,
  options?: { backup?: boolean; share?: boolean }
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
  if (isNativeApp()) {
    return nativeSave(relativePath, await blobToBase64(blob), options?.share ?? true);
  }
  const filename = basename(relativePath);
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
  if (isNativeApp()) {
    return nativeSave(basename(absolutePath), await blobToBase64(blob), true);
  }
  const filename = basename(absolutePath) || "song.indies";
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
  if (api?.isDesktop) return api.getOutputDir();
  if (isNativeApp()) return `Documents/${NATIVE_EXPORTS_DIR}`;
  return null;
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

export type NativeExportEntry = { name: string; uri: string; mtime: number; size: number };

/** List .indies files under Documents/SmashDrumsEditor (Android only; [] elsewhere). */
export async function listNativeExports(): Promise<NativeExportEntry[]> {
  if (!isNativeApp()) return [];
  let files;
  try {
    ({ files } = await Filesystem.readdir({
      path: NATIVE_EXPORTS_DIR,
      directory: Directory.Documents,
    }));
  } catch {
    return [];
  }
  const entries: NativeExportEntry[] = [];
  for (const f of files) {
    if (f.type !== "file" || !f.name.toLowerCase().endsWith(".indies")) continue;
    entries.push({ name: f.name, uri: f.uri, mtime: f.mtime, size: f.size });
  }
  entries.sort((a, b) => b.mtime - a.mtime);
  return entries;
}

/** Open the Android share sheet for a previously exported file. */
export async function shareNativeExport(uri: string, name: string): Promise<void> {
  await Share.share({ title: name, files: [uri], dialogTitle: "Send your chart" });
}
