/**
 * Download OurAirports CSV and write public/data/airports.json
 * Usage: npm run prepare-data
 */
import { createWriteStream, mkdirSync, writeFileSync, createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CSV_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const OUT = join(ROOT, 'public', 'data', 'airports.json');
const TMP = join(ROOT, 'tmp-airports.csv');

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

async function download() {
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  await pipeline(res.body, createWriteStream(TMP));
}

async function convert() {
  const rl = createInterface({ input: createReadStream(TMP, { encoding: 'utf8' }) });
  let headers = null;
  const airports = [];

  for await (const line of rl) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    if (!headers) {
      headers = cols.map((h) => h.replace(/^"|"$/g, ''));
      continue;
    }
    const row = Object.fromEntries(headers.map((h, i) => [h, cols[i] ?? '']));
    const type = row.type;
    if (!['large_airport', 'medium_airport', 'small_airport'].includes(type)) continue;

    const isCn = row.iso_country === 'CN';
    const scheduled = row.scheduled_service === 'yes';
    if (type === 'small_airport' && !(scheduled || isCn)) continue;

    const lat = Number(row.latitude_deg);
    const lon = Number(row.longitude_deg);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const name = (row.name || '').trim();
    if (!name) continue;

    const ident = (row.ident || '').trim();
    const icao = (row.icao_code || '').trim() || ident || null;
    const iata = (row.iata_code || '').trim() || null;

    airports.push({
      iata,
      icao,
      ident,
      name,
      lat: Math.round(lat * 1e5) / 1e5,
      lon: Math.round(lon * 1e5) / 1e5,
      country: row.iso_country,
      city: (row.municipality || '').trim() || null,
      type: type.replace('_airport', ''),
    });
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(airports));
  console.log(`Wrote ${airports.length} airports → ${OUT}`);
}

await download();
await convert();
