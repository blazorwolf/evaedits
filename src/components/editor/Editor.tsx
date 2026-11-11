"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Timeline } from "./Timeline";
import { TrimBar } from "./TrimBar";
import { ExportDialog } from "./ExportDialog";
import { formatTime } from "./format";
import {
  clipLength, newId, FADE_SECONDS, MIN_CLIP_SECONDS, SPEEDS, type Clip,
} from "@/lib/types";
import {
  loadProject, saveProject, saveSourceFile, loadSourceFile, pruneSourceFiles,
} from "@/lib/storage";

const HISTORY_LIMIT = 50;

function probeDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () => {
      if (Number.isFinite(v.duration)) return resolve(v.duration);
      // Some recorded files report Infinity until you seek far ahead.
      v.ondurationchange = () => Number.isFinite(v.duration) && resolve(v.duration);
      v.currentTime = 1e7;
    };
    v.onerror = () => reject(new Error("unsupported"));
    v.src = url;
  });
}

function waitFor(el: HTMLMediaElement, event: string) {
  return new Promise<void>((resolve) => el.addEventListener(event, () => resolve(), { once: true }));
}

export default function Editor() {
  const [clips, setClipsState] = useState<Clip[]>([]);
  const clipsRef = useRef<Clip[]>([]);
  const history = useRef<Clip[][]>([]);
  const trimSnapshotTaken = useRef(false);

  const [name, setName] = useState("Untitled project");
  const [urls, setUrls] = useState<Record<string, string>>({});
  const urlsRef = useRef<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const loadedSrc = useRef<string | null>(null);
  const currentIndex = useRef(0);
  const switching = useRef(false);

  const total = clips.reduce((s, c) => s + clipLength(c), 0);
  const selected = clips.find((c) => c.id === selectedId) ?? null;

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500);
  }, []);

  /** Replace the timeline, keeping an undo step unless told not to. */
  const setClips = useCallback((next: Clip[], record = true) => {
    if (record) {
      history.current.push(clipsRef.current);
      if (history.current.length > HISTORY_LIMIT) history.current.shift();
    }
    clipsRef.current = next;
    setClipsState(next);
    setSaved(false);
  }, []);

  const undo = useCallback(() => {
    const prev = history.current.pop();
    if (!prev) return;
    clipsRef.current = prev;
    setClipsState(prev);
    setSaved(false);
  }, []);

  // ---------- Restore the autosaved project ----------
  useEffect(() => {
    (async () => {
      const p = await loadProject();
      if (p) {
        const map: Record<string, string> = {};
        const kept: Clip[] = [];
        for (const c of p.clips) {
          if (!map[c.sourceId]) {
            const blob = await loadSourceFile(c.sourceId);
            if (!blob) continue;
            map[c.sourceId] = URL.createObjectURL(blob);
          }
          kept.push(c);
        }
        urlsRef.current = map;
        setUrls(map);
        clipsRef.current = kept;
        setClipsState(kept);
        setName(p.name);
        setSelectedId(kept[0]?.id ?? null);
        await pruneSourceFiles(new Set(kept.map((c) => c.sourceId)));
      }
      setLoaded(true);
    })();
  }, []);

  // ---------- Autosave ----------
  useEffect(() => {
    if (!loaded) return;
    const t = window.setTimeout(async () => {
      await saveProject({ id: "current", name, clips, updatedAt: Date.now() });
      setSaved(true);
    }, 400);
    return () => window.clearTimeout(t);
  }, [clips, name, loaded]);

  // ---------- Playback ----------
  const locate = useCallback((t: number) => {
    const cs = clipsRef.current;
    let offset = 0;
    for (let i = 0; i < cs.length; i++) {
      const len = clipLength(cs[i]);
      if (t < offset + len || i === cs.length - 1) return { index: i, clip: cs[i], offset };
      offset += len;
    }
    return null;
  }, []);

  const offsetOf = (index: number) =>
    clipsRef.current.slice(0, index).reduce((s, c) => s + clipLength(c), 0);

  const showFrame = useCallback(async (index: number, sourceTime: number) => {
    const v = videoRef.current;
    const c = clipsRef.current[index];
    if (!v || !c) return;
    currentIndex.current = index;
    const url = urlsRef.current[c.sourceId];
    if (loadedSrc.current !== url) {
      loadedSrc.current = url;
      v.src = url;
      await waitFor(v, "loadedmetadata");
    }
    v.playbackRate = c.speed;
    v.currentTime = Math.min(sourceTime, c.end);
  }, []);

  const seek = useCallback((t: number) => {
    const at = Math.max(0, t);
    const hit = locate(at);
    if (!hit) return;
    const local = Math.min(at - hit.offset, clipLength(hit.clip));
    setPlayhead(hit.offset + local);
    return showFrame(hit.index, hit.clip.start + local * hit.clip.speed);
  }, [locate, showFrame]);

  const pause = useCallback(() => {
    videoRef.current?.pause();
    setPlaying(false);
  }, []);

  const play = useCallback(async () => {
    const v = videoRef.current;
    if (!v || clipsRef.current.length === 0) return;
    const totalNow = clipsRef.current.reduce((s, c) => s + clipLength(c), 0);
    await seek(playhead >= totalNow - 0.05 ? 0 : playhead);
    await v.play().catch(() => {});
    setPlaying(true);
  }, [playhead, seek]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const v = videoRef.current;
      const cs = clipsRef.current;
      const idx = currentIndex.current;
      const c = cs[idx];
      if (!v || !c) return pause();
      if (switching.current) return;
      const len = clipLength(c);
      const offset = offsetOf(idx);
      const local = Math.max(0, (v.currentTime - c.start) / c.speed);

      // Preview fades the same way the export will.
      let opacity = 1;
      const f = Math.min(FADE_SECONDS, len / 2);
      if (idx > 0 && cs[idx - 1].transition === "fade" && local < f) opacity = local / f;
      if (c.transition === "fade" && len - local < f) opacity = Math.max(0, (len - local) / f);
      v.style.opacity = String(opacity);

      if (v.currentTime >= c.end - 0.03 || v.ended) {
        if (idx + 1 < cs.length) {
          switching.current = true;
          const next = cs[idx + 1];
          setPlayhead(offset + len);
          showFrame(idx + 1, next.start)
            .then(() => v.play())
            .catch(() => {})
            .finally(() => { switching.current = false; });
        } else {
          v.pause();
          v.style.opacity = "1";
          setPlayhead(offset + len);
          setPlaying(false);
        }
        return;
      }
      setPlayhead(offset + local);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, pause, showFrame]);

  // Keep the paused preview in step with edits.
  useEffect(() => {
    if (playing || !loaded) return;
    if (videoRef.current) videoRef.current.style.opacity = "1";
    if (clips.length) seek(Math.min(playhead, total));
    else setPlayhead(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips, urls]);

  // ---------- Editing actions ----------
  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    pause();
    setBusy("Importing…");
    const added: Clip[] = [];
    const newUrls: Record<string, string> = {};
    let failed = 0;
    for (const file of Array.from(files)) {
      const sourceId = newId();
      const url = URL.createObjectURL(file);
      try {
        const duration = await probeDuration(url);
        await saveSourceFile(sourceId, file);
        newUrls[sourceId] = url;
        added.push({
          id: newId(), sourceId, name: file.name.replace(/\.[^.]+$/, ""),
          sourceDuration: duration, start: 0, end: duration, speed: 1, transition: "cut",
        });
      } catch {
        URL.revokeObjectURL(url);
        failed++;
      }
    }
    urlsRef.current = { ...urlsRef.current, ...newUrls };
    setUrls(urlsRef.current);
    if (added.length) {
      setClips([...clipsRef.current, ...added]);
      setSelectedId(added[0].id);
    }
    setBusy(null);
    if (failed) notify(`${failed} file${failed > 1 ? "s" : ""} couldn't be opened in this browser`);
  };

  const updateClip = (id: string, patch: Partial<Clip>, record = true) =>
    setClips(clipsRef.current.map((c) => (c.id === id ? { ...c, ...patch } : c)), record);

  const splitAtPlayhead = useCallback(() => {
    const hit = locate(playhead);
    if (!hit) return;
    const { clip: c, index, offset } = hit;
    const at = c.start + (playhead - offset) * c.speed;
    if (at - c.start < MIN_CLIP_SECONDS || c.end - at < MIN_CLIP_SECONDS) {
      notify("Move the playhead further inside a clip to split it");
      return;
    }
    const a: Clip = { ...c, end: at, transition: "cut" };
    const b: Clip = { ...c, id: newId(), start: at };
    const next = [...clipsRef.current];
    next.splice(index, 1, a, b);
    setClips(next);
    setSelectedId(b.id);
  }, [locate, playhead, notify, setClips]);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    const cs = clipsRef.current;
    const i = cs.findIndex((c) => c.id === selectedId);
    const next = cs.filter((c) => c.id !== selectedId);
    setClips(next);
    setSelectedId(next[Math.min(i, next.length - 1)]?.id ?? null);
  }, [selectedId, setClips]);

  const removeSilence = async () => {
    if (!selected) return;
    pause();
    setBusy("Loading video engine and finding pauses…");
    try {
      const { findNonSilentRanges } = await import("@/lib/ffmpeg");
      const blob = await loadSourceFile(selected.sourceId);
      if (!blob) throw new Error("missing file");
      const ranges = await findNonSilentRanges(selected, blob);
      if (ranges === null) return notify("This clip has no sound, so there are no pauses to find");
      if (ranges.length === 0) return notify("This whole clip is silent");
      const removed = (selected.end - selected.start) - ranges.reduce((s, r) => s + r.end - r.start, 0);
      if (removed < 0.1) return notify("No pauses found in this clip");
      const pieces: Clip[] = ranges.map((r, k) => ({
        ...selected,
        id: k === 0 ? selected.id : newId(),
        start: r.start,
        end: r.end,
        transition: k === ranges.length - 1 ? selected.transition : "cut",
      }));
      const cs = clipsRef.current;
      const i = cs.findIndex((c) => c.id === selected.id);
      setClips([...cs.slice(0, i), ...pieces, ...cs.slice(i + 1)]);
      notify(`Removed ${removed.toFixed(1)}s of pauses (${pieces.length} pieces)`);
    } catch (e) {
      console.error(e);
      notify("Couldn't analyse this clip");
    } finally {
      setBusy(null);
    }
  };

  const newProject = () => {
    if (clips.length && !window.confirm("Start a new project? This clears the current timeline.")) return;
    pause();
    history.current = [];
    setClips([], false);
    setSelectedId(null);
    setName("Untitled project");
    setPlayhead(0);
    loadedSrc.current = null;
    if (videoRef.current) videoRef.current.removeAttribute("src");
    pruneSourceFiles(new Set());
  };

  // ---------- Keyboard shortcuts (desktop) ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || exporting) return;
      if (e.key === " ") { e.preventDefault(); if (playing) pause(); else play(); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
      else if (e.key.toLowerCase() === "s" && !e.metaKey && !e.ctrlKey) splitAtPlayhead();
      else if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing, play, pause, undo, splitAtPlayhead, deleteSelected, exporting]);

  const selectedIndex = selected ? clips.indexOf(selected) : -1;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-3 px-4 py-3">
      {/* Top bar */}
      <header className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => { setName(e.target.value); setSaved(false); }}
          aria-label="Project name"
          className="min-w-0 flex-1 truncate bg-transparent text-base font-semibold outline-none"
        />
        <span className="text-xs text-neutral-500" data-testid="save-state">{saved ? "Saved" : "Saving…"}</span>
        <button onClick={newProject} className="rounded-full px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800">New</button>
        <button
          onClick={() => { pause(); setExporting(true); }}
          disabled={!clips.length}
          className="rounded-full bg-violet-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Export
        </button>
      </header>

      {/* Preview, framed 9:16 like the export */}
      <div className="relative mx-auto aspect-[9/16] h-[48dvh] max-w-full overflow-hidden rounded-2xl bg-black">
        <video ref={videoRef} playsInline preload="auto" className="h-full w-full object-cover" data-testid="preview" />
        {!clips.length && loaded && (
          <button
            onClick={() => fileInput.current?.click()}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/80"
          >
            <span className="text-4xl">＋</span>
            <span className="text-sm">Import videos</span>
          </button>
        )}
      </div>

      {/* Transport */}
      <div className="flex items-center gap-3">
        <button
          onClick={playing ? pause : play}
          disabled={!clips.length}
          aria-label={playing ? "Pause" : "Play"}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-900 text-white disabled:opacity-40 dark:bg-white dark:text-black"
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <span className="font-mono text-sm tabular-nums" data-testid="time">
          {formatTime(playhead)} / {formatTime(total)}
        </span>
        <div className="flex-1" />
        <button onClick={undo} className="rounded-full px-3 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800">Undo</button>
        <button
          onClick={() => fileInput.current?.click()}
          className="rounded-full border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
        >
          + Add
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="video/*"
          multiple
          hidden
          data-testid="file-input"
          onChange={(e) => { importFiles(e.target.files); e.target.value = ""; }}
        />
      </div>

      <Timeline
        clips={clips}
        selectedId={selectedId}
        playhead={playhead}
        onSelect={(id, t) => { pause(); setSelectedId(id); seek(t); }}
        onReorder={(next) => setClips(next)}
        onToggleTransition={(id) => {
          const c = clipsRef.current.find((x) => x.id === id);
          if (c) updateClip(id, { transition: c.transition === "fade" ? "cut" : "fade" });
        }}
      />

      {/* Tools for the selected clip */}
      {selected && (
        <section className="space-y-3 rounded-2xl bg-neutral-100 p-3 dark:bg-neutral-900">
          <TrimBar
            clip={selected}
            onTrim={(start, end, edge) => {
              pause();
              updateClip(selected.id, { start, end }, !trimSnapshotTaken.current);
              trimSnapshotTaken.current = true;
              // Show the frame at the edge being dragged.
              const off = offsetOf(selectedIndex);
              if (edge === "start") { setPlayhead(off); showFrame(selectedIndex, start); }
              else { setPlayhead(off + (end - start) / selected.speed); showFrame(selectedIndex, end); }
            }}
            onTrimEnd={() => { trimSnapshotTaken.current = false; }}
          />

          <div>
            <p className="mb-1 text-xs text-neutral-500">Speed</p>
            <div className="flex flex-wrap gap-1.5">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  onClick={() => updateClip(selected.id, { speed: s })}
                  className={`rounded-full px-3 py-1 text-sm ${
                    selected.speed === s ? "bg-violet-600 text-white" : "bg-white dark:bg-neutral-800"
                  }`}
                >
                  {s}×
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-sm">
            <button onClick={splitAtPlayhead} className="rounded-xl bg-white py-2 dark:bg-neutral-800">Split</button>
            <button onClick={removeSilence} className="rounded-xl bg-white py-2 dark:bg-neutral-800">Cut pauses</button>
            <button onClick={deleteSelected} className="rounded-xl bg-white py-2 text-red-600 dark:bg-neutral-800">Delete</button>
          </div>
        </section>
      )}

      {busy && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="rounded-2xl bg-white px-5 py-4 text-sm shadow dark:bg-neutral-900">{busy}</div>
        </div>
      )}
      {toast && (
        <div role="status" data-testid="toast" className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-sm rounded-xl bg-neutral-900 px-4 py-3 text-sm text-white shadow-lg dark:bg-white dark:text-black">
          {toast}
        </div>
      )}
      {exporting && (
        <ExportDialog
          clips={clips}
          name={name}
          onClose={() => setExporting(false)}
        />
      )}
    </div>
  );
}
