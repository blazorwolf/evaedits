// Autosave: the project and its source videos live in IndexedDB,
// so a refresh or closed tab picks up exactly where you left off.
import { get, set, del, keys } from "idb-keyval";
import type { Project } from "./types";

const PROJECT_KEY = "project:current";
const fileKey = (id: string) => `file:${id}`;

export async function loadProject(): Promise<Project | undefined> {
  return get<Project>(PROJECT_KEY);
}

export async function saveProject(p: Project) {
  await set(PROJECT_KEY, p);
}

export async function saveSourceFile(id: string, file: Blob) {
  await set(fileKey(id), file);
}

export async function loadSourceFile(id: string): Promise<Blob | undefined> {
  return get<Blob>(fileKey(id));
}

/** Remove stored files that no clip uses any more. */
export async function pruneSourceFiles(usedIds: Set<string>) {
  for (const k of await keys()) {
    const s = String(k);
    if (s.startsWith("file:") && !usedIds.has(s.slice(5))) await del(k);
  }
}
