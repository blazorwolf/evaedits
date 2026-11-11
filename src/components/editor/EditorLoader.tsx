"use client";
import dynamic from "next/dynamic";

// The editor uses browser-only APIs (video, IndexedDB, ffmpeg.wasm), so skip server rendering.
const Editor = dynamic(() => import("./Editor"), {
  ssr: false,
  loading: () => <p className="p-4 text-center text-neutral-500">Loading editor…</p>,
});

export default function EditorLoader() {
  return <Editor />;
}
