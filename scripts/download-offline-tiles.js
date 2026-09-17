#!/usr/bin/env node
/**
 * Pre-seed raster tiles for common airports into public/offline-tiles/{z}/{x}/{y}.png
 * ~1–2 req/s effective (2 workers × ~500ms). Zoom z12–z15. Resumes existing files.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'offline-tiles');
const AIRPORTS_PATH = path.join(ROOT, 'public', 'data', 'airports.json');

const TARGET_IATA = ['CTU', 'TFU', 'PVG', 'PEK', 'CAN', 'SHA', 'HKG', 'LAX', 'NRT', 'LHR'];
const Z_MIN = 12;
const Z_MAX = 15;
const WORKERS = 3;
const DELAY_MS = 350;
const UA =
  'AirportViewOfflineSeeder/1.0 (https://github.com/huming0618/airportview; educational offline pack; contact via GitHub issues)';

const OSM_TMPL = (s, z, x, y) => `https://${s}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
const CARTO_TMPL = (s, z, x, y) =>
  `https://${s}.basemaps.cartocdn.com/light_all/${z}/${x}/${y}.png`;
const SUBS = ['a', 'b', 'c', 'd'];

function lon2tile(lon, z) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
}
function lat2tile(lat, z) {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z),
  );
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let preferCarto = true;
let osmFailStreak = 0;

async function fetchTile(z, x, y) {
  const s = SUBS[(x + y) % SUBS.length];
  const osmS = s === 'd' ? 'a' : s;
  const urls = preferCarto
    ? [CARTO_TMPL(s, z, x, y), OSM_TMPL(osmS, z, x, y)]
    : [OSM_TMPL(osmS, z, x, y), CARTO_TMPL(s, z, x, y)];
  let lastErr;
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'image/png,image/*;q=0.8,*/*;q=0.5',
          Referer: 'https://github.com/huming0618/airportview',
        },
      });
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`);
        if (res.status === 403 || res.status === 429 || res.status === 418) {
          preferCarto = true;
        }
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 50) {
        lastErr = new Error('tiny');
        continue;
      }
      const fromCarto = url.includes('cartocdn');
      if (fromCarto) preferCarto = true;
      else osmFailStreak = 0;
      return { buf, fromCarto };
    } catch (e) {
      lastErr = e;
    }
  }
  osmFailStreak++;
  if (osmFailStreak >= 3) preferCarto = true;
  throw lastErr || new Error('fail');
}

async function main() {
  const airports = JSON.parse(fs.readFileSync(AIRPORTS_PATH, 'utf8'));
  const byIata = new Map();
  for (const a of airports) {
    if (a.iata && TARGET_IATA.includes(a.iata)) byIata.set(a.iata, a);
  }

  const airportMeta = [];
  const tileSet = new Map();

  for (const code of TARGET_IATA) {
    const a = byIata.get(code);
    if (!a) {
      console.warn(`SKIP missing: ${code}`);
      continue;
    }
    const [south, west, north, east] = a.bbox;
    let count = 0;
    for (let z = Z_MIN; z <= Z_MAX; z++) {
      const x0 = lon2tile(west, z);
      const x1 = lon2tile(east, z);
      const y0 = lat2tile(north, z);
      const y1 = lat2tile(south, z);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const key = `${z}/${x}/${y}`;
          if (!tileSet.has(key)) tileSet.set(key, { z, x, y });
          count++;
        }
      }
    }
    airportMeta.push({ iata: code, name: a.name, bbox: a.bbox, tileCount: count });
    console.log(`${code}: ${count} tiles`);
  }

  const jobs = [...tileSet.values()];
  console.log(`Unique tiles: ${jobs.length}`);
  fs.mkdirSync(OUT, { recursive: true });

  let ok = 0;
  let fail = 0;
  let skipped = 0;
  let cartoCount = 0;
  let osmCount = 0;
  let next = 0;
  const t0 = Date.now();

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= jobs.length) return;
      const { z, x, y } = jobs[i];
      const destDir = path.join(OUT, String(z), String(x));
      const dest = path.join(destDir, `${y}.png`);
      if (fs.existsSync(dest) && fs.statSync(dest).size > 50) {
        skipped++;
        ok++;
      } else {
        fs.mkdirSync(destDir, { recursive: true });
        try {
          const { buf, fromCarto } = await fetchTile(z, x, y);
          fs.writeFileSync(dest, buf);
          ok++;
          if (fromCarto) cartoCount++;
          else osmCount++;
        } catch (e) {
          fail++;
          console.warn(`FAIL ${z}/${x}/${y}: ${e.message}`);
        }
        await sleep(DELAY_MS);
      }
      if ((ok + fail) % 40 === 0 || i === jobs.length - 1) {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
        console.log(
          `[${ok + fail}/${jobs.length}] ok=${ok} fail=${fail} skip=${skipped} osm=${osmCount} carto=${cartoCount} ${elapsed}s`,
        );
      }
    }
  }

  await Promise.all(Array.from({ length: WORKERS }, () => worker()));

  let fileCount = 0;
  let bytes = 0;
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith('.png')) {
        fileCount++;
        bytes += fs.statSync(p).size;
      }
    }
  }
  walk(OUT);

  const provider =
    cartoCount > osmCount
      ? 'Carto Positron (light_all) + OpenStreetMap data'
      : 'OpenStreetMap raster tiles';

  const manifest = {
    generatedAt: new Date().toISOString(),
    zoom: { min: Z_MIN, max: Z_MAX },
    airports: airportMeta,
    uniqueRequested: jobs.length,
    downloadedOk: ok,
    failed: fail,
    skippedExisting: skipped,
    providersUsed: { osm: osmCount, carto: cartoCount },
    attribution:
      'Map tiles © OpenStreetMap contributors (ODbL) and/or © CARTO (Positron). Bundled for offline Airport View demo only.',
    provider,
    pathTemplate: 'offline-tiles/{z}/{x}/{y}.png',
    onDiskPngCount: fileCount,
    onDiskBytes: bytes,
    onDiskMB: Math.round((bytes / (1024 * 1024)) * 100) / 100,
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('DONE', manifest.onDiskMB, 'MB', fileCount, 'pngs fail=', fail);
  if (fail > jobs.length * 0.05) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
