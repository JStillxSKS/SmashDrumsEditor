import { fileFromImportPick, type PickedImportFile } from "./importFile";
import type { FileWithPath } from "./siblingFile";

const AUDIO_ACCEPT =
  "audio/*,.mp3,.ogg,.wav,.flac,.m4a,.aac,.opus,.webm";

function mimeForName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    wav: "audio/wav",
    flac: "audio/flac",
    m4a: "audio/mp4",
    aac: "audio/aac",
    opus: "audio/opus",
    webm: "audio/webm",
  };
  return map[ext] ?? "application/octet-stream";
}

/** Desktop Electron dialog, or browser file picker. */
export async function pickAudioFile(): Promise<FileWithPath | null> {
  const api = window.electronAPI;
  if (api?.isDesktop && api.pickAudioFile) {
    const pick = await api.pickAudioFile();
    if (!pick) return null;
    return fileFromImportPick(pick as PickedImportFile);
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = AUDIO_ACCEPT;
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0] ?? null;
        input.remove();
        resolve(file as FileWithPath | null);
      },
      { once: true }
    );
    input.click();
  });
}

export async function pickImportPackageFile(): Promise<FileWithPath | null> {
  const api = window.electronAPI;
  if (api?.isDesktop && api.pickImportFile) {
    const pick = await api.pickImportFile();
    if (!pick) return null;
    return fileFromImportPick(pick);
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".indies,.rlrr,.json,.chart,.mid,.midi,application/json,application/zip";
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0] ?? null;
        input.remove();
        resolve(file as FileWithPath | null);
      },
      { once: true }
    );
    input.click();
  });
}

export function fileFromDroppedFile(file: File): FileWithPath {
  return file as FileWithPath;
}

export { mimeForName, AUDIO_ACCEPT };
