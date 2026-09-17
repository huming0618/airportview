/**
 * Bake type-based bbox into public/data/airports.json
 * bbox: [south, west, north, east]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HALF = { large: 0.055, medium: 0.03, small: 0.015 };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'public/data/airports.json');
const airports = JSON.parse(fs.readFileSync(file, 'utf8'));
for (const a of airports) {
  const half = HALF[a.type] ?? 0.04;
  a.bbox = [
    +(a.lat - half).toFixed(6),
    +(a.lon - half).toFixed(6),
    +(a.lat + half).toFixed(6),
    +(a.lon + half).toFixed(6),
  ];
}
fs.writeFileSync(file, JSON.stringify(airports));
console.log(`Updated ${airports.length} airports with bbox`);
