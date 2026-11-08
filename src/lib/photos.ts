// Relevant, freely licensed (commercial-use) listing-style photos, grouped by property type and bundled in /public/photos
// so the game never depends on an external image service at runtime. See scripts/refresh-photos for how they were gathered.
import pool from "./photoPool.json";

const POOL = pool as Record<string, string[]>;
const ALL = Object.values(POOL).flat();

/** The n-th photo for a type (cycling), so properties of the same type get different pictures. */
export async function photoFor(type: string, index = Math.floor(Math.random() * 1000)): Promise<string | null> {
  const list = POOL[type]?.length ? POOL[type] : ALL;
  return list.length ? list[index % list.length] : null;
}

/** Assigns a matching photo to every property that has none (or all, when forced). Returns how many were set. */
export async function fillPhotos(
  props: { property_id: string; type: string; image_url: string | null; enabled: boolean }[],
  save: (id: string, url: string) => Promise<unknown>,
  onProgress?: (done: number, total: number) => void,
  force = false,
): Promise<number> {
  const todo = props.filter((p) => p.enabled && (force || !p.image_url));
  const offset = force ? Math.floor(Math.random() * 1000) : 0;
  const seen = new Map<string, number>();
  let done = 0;
  for (const p of todo) {
    const i = seen.get(p.type) ?? 0;
    seen.set(p.type, i + 1);
    const url = await photoFor(p.type, i + offset);
    if (url) { await save(p.property_id, url); done++; }
    onProgress?.(done, todo.length);
  }
  return done;
}
