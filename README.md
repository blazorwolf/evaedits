# evaedits

One app. Every creative tool. From inspiration to final post.

This is the prototype, starting with the short-form video editor (Reels, TikToks, Stories).

## Run it

```bash
npm install      # also copies the ffmpeg.wasm cores into public/ffmpeg
npm run dev      # http://localhost:3000/editor
```

## What the editor does today

- Import several videos at once from the camera roll or files
- Timeline: tap a clip to select it and move the playhead, long-press (phone) or drag (desktop) to reorder
- Trim by dragging the yellow handles, split at the playhead, delete, undo
- Speed per clip from 0.25× to 4×
- Straight cut or fade between any two clips (tap the dot between them)
- **Cut pauses**: finds silence in the selected clip and removes it
- Autosave: the project and its videos are kept in the browser (IndexedDB), so a refresh picks up where you left off
- Export a vertical 9:16 MP4 (1080×1920 or 720×1280), cropped to fill the frame, with Download and Share on phones

Desktop shortcuts: Space play/pause, S split, Delete remove, Ctrl/Cmd+Z undo.

## How it works

Everything runs in the browser. Video processing (silence detection, export) uses
[ffmpeg.wasm](https://ffmpegwasm.netlify.app/). The multithreaded build needs
`SharedArrayBuffer`, so `next.config.ts` sends cross-origin isolation headers
(COOP/COEP) on every route. ffmpeg's core and worker files are served from
`public/ffmpeg` (copied by `scripts/copy-ffmpeg.mjs`, not committed).

Debug flags for the editor URL: `?st` forces the single-threaded ffmpeg core, `?debug` logs ffmpeg output to the console.

## Known limits

- Speed is constant per clip; speed ramps are not built yet.
- Export runs on the device, so long or 1080p exports on older phones are slow. 720p is faster.
- Formats the browser can't play (for example HEVC .mov in some desktop browsers) can't be imported yet.
