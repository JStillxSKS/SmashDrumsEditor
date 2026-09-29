/**
 * Real Ogg Vorbis packaging for .indies exports.
 *
 * The game decodes audio.ogg as Ogg Vorbis — writing MP3/WAV bytes under an
 * .ogg name produced a file the game could not play. Ogg sources pass through
 * untouched; anything else is transcoded with ffmpeg.wasm (loaded lazily from
 * public/ffmpeg/, copied there by scripts/copy-ffmpeg-core.cjs on install).
 */

let ffmpegPromise: Promise<import("@ffmpeg/ffmpeg").FFmpeg> | null = null;

async function getFFmpeg(): Promise<import("@ffmpeg/ffmpeg").FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const ffmpeg = new FFmpeg();
      const base = `${import.meta.env.BASE_URL}ffmpeg`;
      await ffmpeg.load({
        coreURL: `${base}/ffmpeg-core.js`,
        wasmURL: `${base}/ffmpeg-core.wasm`,
      });
      return ffmpeg;
    })();
  }
  return ffmpegPromise;
}

const OGG_MAGIC = [0x4f, 0x67, 0x67, 0x53]; // "OggS"

export function isOggBytes(bytes: Uint8Array): boolean {
  return OGG_MAGIC.every((b, i) => bytes[i] === b);
}

async function transcodeToOggBlob(file: File): Promise<Blob> {
  const { fetchFile } = await import("@ffmpeg/util");
  const ffmpeg = await getFFmpeg();
  const ext = (file.name.split(".").pop() ?? "audio").toLowerCase();
  const input = `input.${ext}`;
  await ffmpeg.writeFile(input, await fetchFile(file));
  const code = await ffmpeg.exec(["-i", input, "-vn", "-c:a", "libvorbis", "-q:a", "5", "audio.ogg"]);
  if (code !== 0) {
    throw new Error(`Audio transcode to Ogg failed (ffmpeg exit ${code}).`);
  }
  const data = await ffmpeg.readFile("audio.ogg");
  const encoded =
    data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
  const bytes = new Uint8Array(encoded);
  if (bytes.byteLength === 0) {
    throw new Error("Audio transcode to Ogg produced no output.");
  }
  return new Blob([bytes], { type: "audio/ogg" });
}

/**
 * Bytes for audio.ogg inside the .indies package: pass Ogg sources through,
 * transcode everything else to real Ogg Vorbis.
 */
export async function ensureOggBlob(file: File): Promise<Blob> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isOggBytes(bytes)) {
    return new Blob([bytes], { type: "audio/ogg" });
  }
  return transcodeToOggBlob(file);
}
