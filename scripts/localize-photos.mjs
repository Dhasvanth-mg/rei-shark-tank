// Downloads every remote photo in src/lib/photoPool.json into public/photos and rewrites the pool to local paths.
// Usage: node scripts/localize-photos.mjs
import fs from "fs";
import path from "path";

const root = path.resolve(import.meta.dirname, "..");
const file = path.join(root, "src/lib/photoPool.json");
const outDir = path.join(root, "public/photos");
fs.mkdirSync(outDir, { recursive: true });
const pool = JSON.parse(fs.readFileSync(file, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const next = {};

for (const [type, urls] of Object.entries(pool)) {
  next[type] = [];
  let n = 0;
  for (const u of urls) {
    if (u.startsWith("/photos/")) { next[type].push(u); n++; continue; }
    const name = `${type}-${++n}.jpg`;
    const dest = path.join(outDir, name);
    try {
      let ok = false;
      for (let a = 0; a < 3 && !ok; a++) {
        const r = await fetch(u, { headers: { "User-Agent": "REI-SharkTank/1.0 (fraternity game; dhasvanth2612@gmail.com)" } });
        if (r.ok && r.headers.get("content-type")?.startsWith("image/")) {
          fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
          ok = true;
        } else await sleep(4000);
      }
      if (ok) next[type].push(`/photos/${name}`);
      else console.log("skip", u);
    } catch (e) { console.log("fail", u, e.message); }
    await sleep(1500);
  }
  console.log(type, next[type].length);
  fs.writeFileSync(file, JSON.stringify({ ...pool, ...next }, null, 1));
}
fs.writeFileSync(file, JSON.stringify(next, null, 1));
console.log("done");
