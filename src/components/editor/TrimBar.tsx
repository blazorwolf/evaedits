"use client";
import { useRef } from "react";
import { MIN_CLIP_SECONDS, type Clip } from "@/lib/types";
import { formatTime } from "./format";

/** Drag either edge to trim the selected clip within its source video. */
export function TrimBar({ clip, onTrim, onTrimEnd }: {
  clip: Clip;
  onTrim: (start: number, end: number, edge: "start" | "end") => void;
  onTrimEnd: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const d = clip.sourceDuration;

  const drag = (edge: "start" | "end") => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = track.current!.getBoundingClientRect();
      const t = Math.min(d, Math.max(0, ((ev.clientX - r.left) / r.width) * d));
      if (edge === "start") onTrim(Math.min(t, clip.end - MIN_CLIP_SECONDS), clip.end, edge);
      else onTrim(clip.start, Math.max(t, clip.start + MIN_CLIP_SECONDS), edge);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      onTrimEnd();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const left = (clip.start / d) * 100;
  const right = 100 - (clip.end / d) * 100;

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-neutral-500">
        <span>In {formatTime(clip.start)}</span>
        <span>Trim</span>
        <span>Out {formatTime(clip.end)}</span>
      </div>
      <div ref={track} className="relative h-10 rounded-lg bg-neutral-200 dark:bg-neutral-800" data-testid="trimbar">
        <div
          className="absolute inset-y-0 rounded-lg border-y-2 border-yellow-400 bg-yellow-400/20"
          style={{ left: `${left}%`, right: `${right}%` }}
        />
        <Handle side="start" pos={left} onPointerDown={drag("start")} />
        <Handle side="end" pos={100 - right} onPointerDown={drag("end")} />
      </div>
    </div>
  );
}

function Handle({ side, pos, onPointerDown }: {
  side: "start" | "end"; pos: number; onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role="slider"
      aria-label={side === "start" ? "Trim start" : "Trim end"}
      aria-valuenow={pos}
      data-testid={`trim-${side}`}
      onPointerDown={onPointerDown}
      className={`absolute inset-y-0 flex w-5 cursor-ew-resize touch-none items-center justify-center bg-yellow-400 ${
        side === "start" ? "rounded-l-lg" : "-translate-x-full rounded-r-lg"
      }`}
      style={{ left: `${pos}%` }}
    >
      <span className="h-4 w-0.5 rounded bg-yellow-900/60" />
    </div>
  );
}
