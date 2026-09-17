/**
 * OSM tile cache via Cache API (works in Capacitor WebView + browsers).
 * Online: fetch + store. Offline: serve from cache or signal miss.
 */

const CACHE_NAME = 'airportview-osm-tiles-v1';
const TILE_URL_TEMPLATE = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const SUBDOMAINS = ['a', 'b', 'c'];

export function tileUrl(z, x, y) {
  const s = SUBDOMAINS[(x + y) % SUBDOMAINS.length];
  return TILE_URL_TEMPLATE.replace('{s}', s).replace('{z}', z).replace('{x}', x).replace('{y}', y);
}

export function isOnline() {
  return typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
}

async function openCache() {
  if (!('caches' in globalThis)) return null;
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

/** Create a Leaflet TileLayer that reads/writes Cache API. */
export function createCachedTileLayer(L, options = {}) {
  const TileLayerCached = L.TileLayer.extend({
    createTile(coords, done) {
      const tile = document.createElement('img');
      tile.alt = '';
      tile.setAttribute('role', 'presentation');
      L.DomEvent.on(tile, 'load', L.Util.bind(this._tileOnLoad, this, done, tile));
      L.DomEvent.on(tile, 'error', L.Util.bind(this._tileOnError, this, done, tile));
      if (this.options.crossOrigin || this.options.crossOrigin === '') {
        tile.crossOrigin = this.options.crossOrigin === true ? '' : this.options.crossOrigin;
      }
      tile.src = '';
      const url = this.getTileUrl(coords);
      this._loadCached(url, tile, done);
      return tile;
    },

    async _loadCached(url, tile, done) {
      const cache = await openCache();
      try {
        if (cache) {
          const hit = await cache.match(url);
          if (hit) {
            const blob = await hit.blob();
            tile.src = URL.createObjectURL(blob);
            tile.dataset.fromCache = '1';
            return;
          }
        }
        if (!isOnline()) {
          tile.dataset.miss = '1';
          // trigger error so Leaflet knows; also notify app
          tile.src =
            'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
          this.fire('tileoffline', { url });
          done(new Error('offline-miss'), tile);
          return;
        }
        const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (cache) {
          try {
            await cache.put(url, new Response(blob.slice(), { headers: { 'Content-Type': blob.type || 'image/png' } }));
          } catch {
            /* quota */
          }
        }
        tile.src = URL.createObjectURL(blob);
      } catch (err) {
        if (cache) {
          // try alternate subdomain cache keys
          for (const s of SUBDOMAINS) {
            const alt = url.replace(/\/\/[abc]\./, `//${s}.`);
            const hit = await cache.match(alt);
            if (hit) {
              const blob = await hit.blob();
              tile.src = URL.createObjectURL(blob);
              return;
            }
          }
        }
        tile.dataset.miss = '1';
        this.fire('tileoffline', { url, err });
        done(err, tile);
      }
    },
  });

  return new TileLayerCached(TILE_URL_TEMPLATE, {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    crossOrigin: true,
    ...options,
  });
}

function lon2tile(lon, z) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
}
function lat2tile(lat, z) {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z),
  );
}

/**
 * Prefetch tiles for a Leaflet LatLngBounds at zoom levels zMin..zMax.
 * Returns { ok, fail, total }.
 */
export async function prefetchTiles(bounds, zMin = 12, zMax = 16, onProgress) {
  if (!isOnline()) throw new Error('offline');
  const cache = await openCache();
  if (!cache) throw new Error('no-cache-api');

  const south = bounds.getSouth();
  const north = bounds.getNorth();
  const west = bounds.getWest();
  const east = bounds.getEast();

  const jobs = [];
  for (let z = zMin; z <= zMax; z++) {
    const x0 = lon2tile(west, z);
    const x1 = lon2tile(east, z);
    const y0 = lat2tile(north, z);
    const y1 = lat2tile(south, z);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        jobs.push({ z, x, y });
      }
    }
  }

  // Cap to avoid hammering OSM — soft limit for demo
  const MAX = 800;
  const list = jobs.slice(0, MAX);
  let ok = 0;
  let fail = 0;
  const concurrency = 4;
  let i = 0;

  async function worker() {
    while (i < list.length) {
      const idx = i++;
      const { z, x, y } = list[idx];
      const url = tileUrl(z, x, y);
      try {
        const existing = await cache.match(url);
        if (existing) {
          ok++;
        } else {
          const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
          if (!res.ok) throw new Error(String(res.status));
          const blob = await res.blob();
          await cache.put(
            url,
            new Response(blob, { headers: { 'Content-Type': blob.type || 'image/png' } }),
          );
          ok++;
          // be nice to OSM
          await new Promise((r) => setTimeout(r, 80));
        }
      } catch {
        fail++;
      }
      if (onProgress) onProgress({ ok, fail, total: list.length, done: ok + fail });
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { ok, fail, total: list.length, truncated: jobs.length > MAX };
}

export async function countCachedTilesApprox() {
  const cache = await openCache();
  if (!cache) return 0;
  const keys = await cache.keys();
  return keys.length;
}
