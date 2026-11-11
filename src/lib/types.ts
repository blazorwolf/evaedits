export type Transition = "cut" | "fade";

/** One piece of footage on the timeline. Several clips can share one source file. */
export interface Clip {
  id: string;
  /** Key of the source video file in storage. */
  sourceId: string;
  name: string;
  /** Full length of the source file, in seconds. */
  sourceDuration: number;
  /** Trim points within the source, in seconds. */
  start: number;
  end: number;
  /** Playback speed multiplier (0.25 to 4). */
  speed: number;
  /** How this clip leads into the next one. */
  transition: Transition;
}

export interface Project {
  id: string;
  name: string;
  clips: Clip[];
  updatedAt: number;
}

export const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 3, 4] as const;
export const FADE_SECONDS = 0.4;
export const MIN_CLIP_SECONDS = 0.2;

export function clipLength(c: Clip) {
  return (c.end - c.start) / c.speed;
}

export function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
