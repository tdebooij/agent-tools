// Copies the Codex Harvest Live card (plugins/harvest-live) into this mod, which serves it under T3 Code.
// The plugin cache copies only this mod's folder, so the card's files must live here.
// node sync.mjs          copy the files
// node sync.mjs --check  exit 1 when a copy differs from its source
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const files = ['server.mjs', 'timer.html', 'account.mjs', 'harvest-api.mjs', 'schedule.mjs'];
const source = new URL('../../../plugins/harvest-live/', import.meta.url);
const check = process.argv.includes('--check');

let stale = 0;
for (const file of files) {
  const from = fileURLToPath(new URL(file, source));
  const to = fileURLToPath(new URL(file, import.meta.url));
  if (!check) { copyFileSync(from, to); continue; }
  if (!existsSync(to) || !readFileSync(from).equals(readFileSync(to))) { console.error(`stale: ${file}`); stale++; }
}
if (stale) { console.error('Run: node mods/harvest-live/t3-card/sync.mjs'); process.exit(1); }
console.log(check ? 'T3 card files match plugins/harvest-live.' : `Copied ${files.length} files from plugins/harvest-live.`);
