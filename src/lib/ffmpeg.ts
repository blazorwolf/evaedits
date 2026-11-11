"use client";
// All heavy video work runs in the browser through ffmpeg.wasm.
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import { FADE_SECONDS, MIN_CLIP_SECONDS, type Clip } from "./types";

let instance: Promise<FFmpeg> | null = null;

/** Load ffmpeg once. Uses the multithreaded core when the page is cross-origin isolated. */
export function getFFmpeg(): Promise<FFmpeg> {
  if (!instance) {
    instance = (async () => {
      const ff = new FFmpeg();
      if (new URLSearchParams(location.search).has("debug")) {
        ff.on("log", ({ message }) => console.log("[ffmpeg]", message));
      }
      const mt = window.crossOriginIsolated && !new URLSearchParams(location.search).has("st");
      const base = new URL(`/ffmpeg/${mt ? "mt" : "st"}/`, window.location.origin).href;
      await ff.load({
        classWorkerURL: new URL("/ffmpeg/worker/worker.js", window.location.origin).href,
        coreURL: `${base}ffmpeg-core.js`,
        wasmURL: `${base}ffmpeg-core.wasm`,
        ...(mt ? { workerURL: `${base}ffmpeg-core.worker.js` } : {}),
      });
      return ff;
    })().catch((e) => {
      instance = null;
      throw e;
    });
  }
  return instance;
}

/** Run a command and return everything ffmpeg printed. */
async function execWithLogs(ff: FFmpeg, args: string[]) {
  const lines: string[] = [];
  const onLog = ({ message }: { message: string }) => lines.push(message);
  ff.on("log", onLog);
  try {
    await ff.exec(args);
  } finally {
    ff.off("log", onLog);
  }
  return lines.join("\n");
}

async function hasAudio(ff: FFmpeg, name: string) {
  const out = await execWithLogs(ff, ["-hide_banner", "-i", name]);
  return /Stream #.*Audio:/.test(out);
}

const sourceName = (id: string) => `src_${id}`;

/**
 * Find the parts of a clip where someone is speaking or there is sound,
 * so pauses and dead air can be cut out. Returns null if the clip has no audio.
 */
export async function findNonSilentRanges(
  clip: Clip,
  file: Blob,
  { noiseDb = -35, minSilence = 0.6, padding = 0.12 } = {},
): Promise<{ start: number; end: number }[] | null> {
  const ff = await getFFmpeg();
  const name = sourceName(clip.sourceId);
  await ff.writeFile(name, await fetchFile(file));
  try {
    if (!(await hasAudio(ff, name))) return null;
    const log = await execWithLogs(ff, [
      "-hide_banner",
      "-ss", String(clip.start),
      "-t", String(clip.end - clip.start),
      "-i", name,
      "-vn",
      "-af", `silencedetect=noise=${noiseDb}dB:d=${minSilence}`,
      "-f", "null", "-",
    ]);
    // Timestamps in the log are relative to the clip's start.
    const silences: { start: number; end: number }[] = [];
    let open: number | null = null;
    for (const m of log.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
      const t = clip.start + Math.max(0, parseFloat(m[2]));
      if (m[1] === "start") open = t;
      else if (open !== null) {
        silences.push({ start: open, end: t });
        open = null;
      }
    }
    if (open !== null) silences.push({ start: open, end: clip.end });

    const kept: { start: number; end: number }[] = [];
    let cursor = clip.start;
    for (const s of silences) {
      kept.push({ start: cursor, end: s.start });
      cursor = s.end;
    }
    kept.push({ start: cursor, end: clip.end });
    return kept
      .map((r) => ({
        start: Math.max(clip.start, r.start - padding),
        end: Math.min(clip.end, r.end + padding),
      }))
      .filter((r) => r.end - r.start >= MIN_CLIP_SECONDS);
  } finally {
    await ff.deleteFile(name).catch(() => {});
  }
}

/** Build an atempo chain; each atempo filter only accepts 0.5 to 2. */
function atempo(speed: number) {
  const parts: string[] = [];
  let s = speed;
  while (s > 2) { parts.push("atempo=2"); s /= 2; }
  while (s < 0.5) { parts.push("atempo=0.5"); s /= 0.5; }
  if (Math.abs(s - 1) > 1e-6) parts.push(`atempo=${s}`);
  return parts;
}

export type ExportQuality = "1080p" | "720p";

/**
 * Render the timeline to a vertical 9:16 MP4 ready for Reels, TikTok and Stories.
 * Each clip is cropped to fill the frame, re-timed for its speed, faded where
 * the timeline asks for a fade, then all clips are joined.
 */
export async function exportVertical(
  clips: Clip[],
  getFile: (sourceId: string) => Promise<Blob>,
  quality: ExportQuality,
  onProgress: (fraction: number, label: string) => void,
): Promise<Blob> {
  const ff = await getFFmpeg();
  const [w, h] = quality === "1080p" ? [1080, 1920] : [720, 1280];

  const written = new Set<string>();
  const audioBySource = new Map<string, boolean>();
  const parts: string[] = [];
  let clipIndex = 0;
  const onProg = ({ progress }: { progress: number }) =>
    onProgress((clipIndex + Math.min(1, Math.max(0, progress))) / (clips.length + 0.2), `Rendering clip ${clipIndex + 1} of ${clips.length}`);
  ff.on("progress", onProg);

  try {
    for (; clipIndex < clips.length; clipIndex++) {
      const c = clips[clipIndex];
      const src = sourceName(c.sourceId);
      if (!written.has(src)) {
        await ff.writeFile(src, await fetchFile(await getFile(c.sourceId)));
        written.add(src);
        audioBySource.set(c.sourceId, await hasAudio(ff, src));
      }
      const srcLen = c.end - c.start;
      const outLen = srcLen / c.speed;
      const fadeIn = clipIndex > 0 && clips[clipIndex - 1].transition === "fade";
      const fadeOut = c.transition === "fade";
      const f = Math.min(FADE_SECONDS, outLen / 2);

      const v = [
        `scale=${w}:${h}:force_original_aspect_ratio=increase`,
        `crop=${w}:${h}`,
        "setsar=1",
        `setpts=(PTS-STARTPTS)/${c.speed}`,
        "fps=30",
      ];
      const a = ["aresample=44100", "asetpts=PTS-STARTPTS", ...atempo(c.speed)];
      if (fadeIn) { v.push(`fade=t=in:st=0:d=${f}`); a.push(`afade=t=in:st=0:d=${f}`); }
      if (fadeOut) { v.push(`fade=t=out:st=${outLen - f}:d=${f}`); a.push(`afade=t=out:st=${outLen - f}:d=${f}`); }

      const withAudio = audioBySource.get(c.sourceId);
      const out = `part_${clipIndex}.mp4`;
      await ff.exec([
        "-hide_banner",
        "-ss", String(c.start), "-t", String(srcLen), "-i", src,
        ...(withAudio ? [] : ["-f", "lavfi", "-t", String(srcLen), "-i", "anullsrc=r=44100:cl=stereo"]),
        "-filter_complex",
        `[0:v]${v.join(",")}[v];[${withAudio ? "0:a" : "1:a"}]${a.join(",")}[a]`,
        "-map", "[v]", "-map", "[a]",
        "-t", String(outLen),
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k", "-ac", "2",
        out,
      ]);
      parts.push(out);
    }

    onProgress(clips.length / (clips.length + 0.2), "Joining clips");
    await ff.writeFile("list.txt", parts.map((p) => `file '${p}'`).join("\n"));
    const code = await ff.exec(["-hide_banner", "-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", "-movflags", "+faststart", "final.mp4"]);
    if (code !== 0) throw new Error("ffmpeg could not join the clips");
    const data = await ff.readFile("final.mp4");
    onProgress(1, "Done");
    return new Blob([data as Uint8Array<ArrayBuffer>], { type: "video/mp4" });
  } finally {
    ff.off("progress", onProg);
    for (const name of [...written, ...parts, "list.txt", "final.mp4"]) {
      await ff.deleteFile(name).catch(() => {});
    }
  }
}
