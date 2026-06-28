import JSZip from "jszip";
import type { ChartNote, Difficulty, MetaJson } from "../types/meta";
import { chartsFromMeta, parseMetaJson, prepareMetaForExport } from "./metaIO";
import { serializeMetaJson } from "./metaSerialize";
import {
  INDIES_AUDIO_FILE,
  INDIES_COVER_FILE,
  INDIES_COVER_SIZE,
  INDIES_PREVIEW_FILE,
  INDIES_PREVIEW_SAMPLE_RATE,
  INDIES_PREVIEW_SECONDS,
} from "./audioFormat";

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] as const;

export type IndiesPackage = {
  meta: MetaJson;
  charts: Record<Difficulty, ChartNote[]>;
  audioFile: File | null;
  coverFile: File | null;
};

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

function encodeWavPcm16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const byteLength = samples.length * 2;
  const buffer = new ArrayBuffer(44 + byteLength);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + byteLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, byteLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return buffer;
}

function resampleMonoClip(
  buffer: AudioBuffer,
  startSeconds: number,
  durationSeconds: number,
  outputRate: number
): Float32Array {
  const sourceRate = buffer.sampleRate;
  const startFrame = Math.max(0, Math.floor(startSeconds * sourceRate));
  const availableFrames = Math.max(0, buffer.length - startFrame);
  const sourceFrames = Math.min(Math.floor(durationSeconds * sourceRate), availableFrames);
  const outputFrames = Math.floor(durationSeconds * outputRate);
  const channel = buffer.getChannelData(0);
  const output = new Float32Array(outputFrames);

  if (sourceFrames <= 0 || outputFrames <= 0) return output;

  for (let i = 0; i < outputFrames; i++) {
    const sourcePos = (i * sourceRate) / outputRate;
    if (sourcePos >= sourceFrames - 1) {
      output[i] = channel[startFrame + sourceFrames - 1] ?? 0;
      continue;
    }
    const index = Math.floor(sourcePos);
    const frac = sourcePos - index;
    const a = channel[startFrame + index] ?? 0;
    const b = channel[startFrame + index + 1] ?? a;
    output[i] = a + (b - a) * frac;
  }

  return output;
}

export function buildPreviewWav(audioBuffer: AudioBuffer): ArrayBuffer {
  const samples = resampleMonoClip(
    audioBuffer,
    0,
    INDIES_PREVIEW_SECONDS,
    INDIES_PREVIEW_SAMPLE_RATE
  );
  return encodeWavPcm16(samples, INDIES_PREVIEW_SAMPLE_RATE);
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load cover image."));
    image.src = url;
  });
}

export async function imageFileToCoverPng(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImageElement(url);
    const canvas = document.createElement("canvas");
    canvas.width = INDIES_COVER_SIZE;
    canvas.height = INDIES_COVER_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not prepare cover image.");

    const scale = Math.max(
      INDIES_COVER_SIZE / image.width,
      INDIES_COVER_SIZE / image.height
    );
    const drawW = image.width * scale;
    const drawH = image.height * scale;
    const drawX = (INDIES_COVER_SIZE - drawW) / 2;
    const drawY = (INDIES_COVER_SIZE - drawH) / 2;

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, INDIES_COVER_SIZE, INDIES_COVER_SIZE);
    ctx.drawImage(image, drawX, drawY, drawW, drawH);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/png");
    });
    if (!blob) throw new Error("Could not encode cover image.");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function sanitizeIndiesFilename(name: string): string {
  const trimmed = name.trim() || "Untitled Song";
  const cleaned = trimmed.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").replace(/\s+/g, " ");
  return cleaned || "Untitled Song";
}

export function isIndiesFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  return lower.endsWith(".indies");
}

export function isZipArchive(bytes: Uint8Array): boolean {
  return ZIP_MAGIC.every((value, index) => bytes[index] === value);
}

export async function buildIndiesZip(options: {
  meta: MetaJson;
  charts: Record<Difficulty, ChartNote[]>;
  audioFile: File;
  coverFile: File | null;
  audioBuffer: AudioBuffer;
}): Promise<Blob> {
  const { meta, charts, audioFile, coverFile, audioBuffer } = options;
  const built = prepareMetaForExport(meta, charts);
  built.FilePath = "";

  const zip = new JSZip();
  zip.file("meta.json", serializeMetaJson(built));
  zip.file(INDIES_AUDIO_FILE, await audioFile.arrayBuffer());

  if (coverFile) {
    zip.file(INDIES_COVER_FILE, await imageFileToCoverPng(coverFile));
  }

  zip.file(INDIES_PREVIEW_FILE, buildPreviewWav(audioBuffer));
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

export function downloadIndiesPackage(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function parseIndiesFile(file: File): Promise<IndiesPackage | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isIndiesFile(file) && !isZipArchive(bytes)) return null;

  try {
    const zip = await JSZip.loadAsync(bytes);
    const metaEntry = zip.file("meta.json");
    if (!metaEntry) return null;

    const meta = parseMetaJson(await metaEntry.async("string"));
    const charts = chartsFromMeta(meta);

    let audioFile: File | null = null;
    const audioEntry = zip.file(INDIES_AUDIO_FILE);
    if (audioEntry) {
      const audioBlob = await audioEntry.async("blob");
      audioFile = new File([audioBlob], INDIES_AUDIO_FILE, {
        type: audioBlob.type || "audio/ogg",
      });
    }

    let coverFile: File | null = null;
    const coverEntry = zip.file(INDIES_COVER_FILE);
    if (coverEntry) {
      const coverBlob = await coverEntry.async("blob");
      coverFile = new File([coverBlob], INDIES_COVER_FILE, {
        type: coverBlob.type || "image/png",
      });
    }

    return { meta, charts, audioFile, coverFile };
  } catch {
    return null;
  }
}