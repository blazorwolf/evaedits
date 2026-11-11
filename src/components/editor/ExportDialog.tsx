"use client";
import { useEffect, useState } from "react";
import type { Clip } from "@/lib/types";
import type { ExportQuality } from "@/lib/ffmpeg";
import { loadSourceFile } from "@/lib/storage";

export function ExportDialog({ clips, name, onClose }: { clips: Clip[]; name: string; onClose: () => void }) {
  const [quality, setQuality] = useState<ExportQuality>("1080p");
  const [progress, setProgress] = useState<number | null>(null);
  const [label, setLabel] = useState("");
  const [result, setResult] = useState<{ blob: Blob; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);

  const fileName = `${name.trim() || "video"}.mp4`.replace(/[\\/:*?"<>|]/g, "-");

  const run = async () => {
    setError(null);
    setProgress(0);
    setLabel("Loading video engine…");
    try {
      const { exportVertical } = await import("@/lib/ffmpeg");
      const blob = await exportVertical(
        clips,
        async (id) => {
          const f = await loadSourceFile(id);
          if (!f) throw new Error("A source video is missing");
          return f;
        },
        quality,
        (p, l) => { setProgress(p); setLabel(l); },
      );
      setResult({ blob, url: URL.createObjectURL(blob) });
    } catch (e) {
      console.error(e);
      setError("Export failed. Try 720p, or fewer or shorter clips.");
      setProgress(null);
    }
  };

  const file = result ? new File([result.blob], fileName, { type: "video/mp4" }) : null;
  const canShare = !!file && typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [file] });
  const working = progress !== null && !result;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" role="dialog" aria-label="Export">
      <div className="w-full max-w-md space-y-4 rounded-t-3xl bg-white p-5 sm:rounded-3xl dark:bg-neutral-900">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Export for Reels, TikTok &amp; Stories</h2>
          {!working && <button onClick={onClose} aria-label="Close" className="text-xl text-neutral-500">×</button>}
        </div>

        {!result && (
          <>
            <p className="text-sm text-neutral-500">Vertical 9:16 MP4. Your clips are cropped to fill the frame.</p>
            <div className="flex gap-2">
              {(["1080p", "720p"] as const).map((q) => (
                <button
                  key={q}
                  disabled={working}
                  onClick={() => setQuality(q)}
                  className={`flex-1 rounded-xl border px-3 py-2 text-sm ${
                    quality === q ? "border-violet-600 bg-violet-50 dark:bg-violet-950" : "border-neutral-300 dark:border-neutral-700"
                  }`}
                >
                  {q === "1080p" ? "1080 × 1920 (best)" : "720 × 1280 (faster)"}
                </button>
              ))}
            </div>
            {working ? (
              <div className="space-y-1">
                <div className="h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                  <div className="h-full bg-violet-600 transition-[width]" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
                </div>
                <p className="text-xs text-neutral-500" data-testid="export-label">{label} · keep this tab open</p>
              </div>
            ) : (
              <button onClick={run} className="w-full rounded-xl bg-violet-600 py-3 font-medium text-white">Export video</button>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
          </>
        )}

        {result && file && (
          <div className="space-y-3">
            <video src={result.url} controls playsInline className="mx-auto max-h-[50dvh] rounded-xl bg-black" data-testid="export-result" />
            <div className="flex gap-2">
              <a href={result.url} download={fileName} className="flex-1 rounded-xl bg-violet-600 py-3 text-center font-medium text-white">Download</a>
              {canShare && (
                <button onClick={() => navigator.share({ files: [file], title: name }).catch(() => {})} className="flex-1 rounded-xl border border-neutral-300 py-3 font-medium dark:border-neutral-700">
                  Share
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
