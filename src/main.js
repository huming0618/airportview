import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import './style.css';
import {
  createCachedTileLayer,
  prefetchTiles,
  isOnline,
  countCachedTilesApprox,
} from './tileCache.js';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const FALLBACK_HALF_SPAN = {
  large: 0.055,
  medium: 0.03,
  small: 0.015,
};

const WORLD_VIEW = { center: [25, 15], zoom: 2 };

/** @type {import('leaflet').Map} */
let map;
/** @type {L.MarkerClusterGroup} */
let cluster;
/** @type {L.LayerGroup} */
let outlineLayer;
/** @type {Array<object>} */
let airports = [];
/** @type {object|null} */
let selected = null;
/** @type {AbortController|null} */
let overpassAbort = null;
/** @type {import('leaflet').TileLayer|null} */
let baseTiles = null;
let offlineTileWarned = false;
let prefetching = false;

const el = {
  input: document.getElementById('search-input'),
  clear: document.getElementById('clear-search'),
  results: document.getElementById('search-results'),
  status: document.getElementById('status'),
  sheet: document.getElementById('sheet'),
  title: document.getElementById('sheet-title'),
  meta: document.getElementById('sheet-meta'),
  codes: document.getElementById('sheet-codes'),
  btnFit: document.getElementById('btn-fit'),
  btnWorld: document.getElementById('btn-world'),
  btnCache: document.getElementById('btn-cache'),
  offlineBanner: document.getElementById('offline-banner'),
};

function showStatus(text) {
  if (!text) {
    el.status.hidden = true;
    el.status.textContent = '';
    return;
  }
  el.status.hidden = false;
  el.status.textContent = text;
}

function updateOfflineBanner() {
  if (!el.offlineBanner) return;
  if (!isOnline()) {
    el.offlineBanner.hidden = false;
    el.offlineBanner.textContent =
      '离线模式：机场搜索与本地范围可用；地图瓦片需事先缓存';
  } else {
    el.offlineBanner.hidden = true;
  }
}

function initMap() {
  map = L.map('map', {
    zoomControl: false,
    attributionControl: true,
    maxZoom: 19,
  }).setView(WORLD_VIEW.center, WORLD_VIEW.zoom);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  baseTiles = createCachedTileLayer(L);
  baseTiles.addTo(map);
  baseTiles.on('tileoffline', () => {
    if (offlineTileWarned) return;
    offlineTileWarned = true;
    showStatus('请先联网缓存该机场周边地图');
    setTimeout(() => {
      showStatus('');
      offlineTileWarned = false;
    }, 3500);
  });

  cluster = L.markerClusterGroup({
    maxClusterRadius: 50,
    disableClusteringAtZoom: 10,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
  });
  map.addLayer(cluster);

  outlineLayer = L.layerGroup().addTo(map);

  window.addEventListener('online', () => {
    updateOfflineBanner();
    showStatus('网络已恢复');
    setTimeout(() => showStatus(''), 1500);
  });
  window.addEventListener('offline', () => {
    updateOfflineBanner();
    showStatus('已进入离线模式');
    setTimeout(() => showStatus(''), 2000);
  });
  updateOfflineBanner();
}

function airportLabel(a) {
  const codes = [a.iata, a.icao].filter(Boolean).join(' / ');
  return codes ? `${a.name} (${codes})` : a.name;
}

function addMarkers() {
  cluster.clearLayers();
  const icon = L.divIcon({
    className: 'airport-marker',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });

  for (const a of airports) {
    const m = L.marker([a.lat, a.lon], { icon, title: airportLabel(a) });
    m.on('click', () => selectAirport(a, { fit: true }));
    cluster.addLayer(m);
  }
}

function normalizeQuery(q) {
  return q.trim().toUpperCase();
}

function searchAirports(q) {
  const raw = q.trim();
  if (raw.length < 1) return [];
  const upper = normalizeQuery(raw);
  const lower = raw.toLowerCase();

  const scored = [];
  for (const a of airports) {
    let score = 0;
    if (a.iata && a.iata === upper) score = 100;
    else if (a.icao && a.icao === upper) score = 95;
    else if (a.ident && a.ident === upper) score = 90;
    else if (a.iata && a.iata.startsWith(upper)) score = 80;
    else if (a.icao && a.icao.startsWith(upper)) score = 75;
    else if (a.name.toLowerCase().includes(lower)) score = 50;
    else if (a.city && a.city.toLowerCase().includes(lower)) score = 40;
    else continue;
    scored.push({ a, score });
  }
  scored.sort((x, y) => y.score - x.score || x.a.name.localeCompare(y.a.name));
  return scored.slice(0, 30).map((s) => s.a);
}

function renderResults(list) {
  if (!list.length) {
    el.results.hidden = true;
    el.results.innerHTML = '';
    return;
  }
  el.results.hidden = false;
  el.results.innerHTML = list
    .map((a, i) => {
      const codes = [a.iata, a.icao].filter(Boolean).join(' · ') || a.ident;
      const place = [a.city, a.country].filter(Boolean).join(', ');
      return `<li role="option" data-idx="${i}" tabindex="-1">
        <div class="result-name">${escapeHtml(a.name)}</div>
        <div class="result-sub">${escapeHtml(codes)}${place ? ' · ' + escapeHtml(place) : ''}</div>
      </li>`;
    })
    .join('');
  el.results._items = list;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function openSheet(a) {
  selected = a;
  el.title.textContent = a.name;
  el.meta.textContent = [a.city, a.country, typeLabel(a.type)]
    .filter(Boolean)
    .join(' · ');
  const codes = [];
  if (a.iata) codes.push(`IATA ${a.iata}`);
  if (a.icao) codes.push(`ICAO ${a.icao}`);
  el.codes.textContent = codes.join(' · ') || a.ident;
  el.sheet.hidden = false;
  if (el.btnCache) {
    el.btnCache.disabled = prefetching;
    el.btnCache.hidden = false;
  }
  setTimeout(() => map.invalidateSize(), 50);
}

function typeLabel(t) {
  return { large: '大型机场', medium: '中型机场', small: '小型机场' }[t] || t;
}

function fallbackBounds(a) {
  const half = FALLBACK_HALF_SPAN[a.type] ?? 0.04;
  return L.latLngBounds(
    [a.lat - half, a.lon - half],
    [a.lat + half, a.lon + half],
  );
}

/** Prefer baked bbox [south, west, north, east] on airport record. */
function localBounds(a) {
  if (Array.isArray(a.bbox) && a.bbox.length === 4) {
    const [s, w, n, e] = a.bbox;
    const b = L.latLngBounds([s, w], [n, e]);
    if (b.isValid()) return b;
  }
  return fallbackBounds(a);
}

function collectCoords(geom) {
  const coords = [];
  if (!geom) return coords;
  if (geom.type === 'Point') {
    coords.push([geom.coordinates[1], geom.coordinates[0]]);
  } else if (geom.type === 'LineString' || geom.type === 'MultiPoint') {
    for (const c of geom.coordinates) coords.push([c[1], c[0]]);
  } else if (geom.type === 'Polygon' || geom.type === 'MultiLineString') {
    for (const ring of geom.coordinates) {
      for (const c of ring) coords.push([c[1], c[0]]);
    }
  } else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates) {
      for (const ring of poly) {
        for (const c of ring) coords.push([c[1], c[0]]);
      }
    }
  } else if (geom.type === 'GeometryCollection') {
    for (const g of geom.geometries || []) coords.push(...collectCoords(g));
  }
  return coords;
}

function featureCentroid(f) {
  const coords = collectCoords(f.geometry);
  if (!coords.length) return null;
  let lat = 0;
  let lon = 0;
  for (const [la, lo] of coords) {
    lat += la;
    lon += lo;
  }
  return L.latLng(lat / coords.length, lon / coords.length);
}

function pickBestAerodromeFeatures(features, a) {
  if (!features.length) return [];
  const preferred = features.filter((f) => {
    const t = f.geometry?.type;
    return t === 'Polygon' || t === 'MultiPolygon';
  });
  const pool = preferred.length ? preferred : features;
  const point = L.latLng(a.lat, a.lon);

  const containing = [];
  const scored = [];
  for (const f of pool) {
    const coords = collectCoords(f.geometry);
    if (!coords.length) continue;
    const b = L.latLngBounds(coords);
    const c = featureCentroid(f);
    const dist = c ? point.distanceTo(c) : Infinity;
    if (b.contains(point)) containing.push({ f, b, dist });
    scored.push({ f, b, dist });
  }

  const candidates = containing.length ? containing : scored;
  if (!candidates.length) return [];

  candidates.sort((x, y) => x.dist - y.dist);
  const best = candidates[0];

  const maxExtra =
    Math.max(best.b.getNorth() - best.b.getSouth(), best.b.getEast() - best.b.getWest()) *
    0.35;
  const kept = [];
  for (const c of candidates) {
    if (c === best) {
      kept.push(c.f);
      continue;
    }
    if (c.dist <= best.dist + 800 && best.b.intersects(c.b.pad(0.05))) {
      const extra = Math.max(
        Math.abs(c.b.getNorth() - best.b.getNorth()),
        Math.abs(c.b.getSouth() - best.b.getSouth()),
        Math.abs(c.b.getEast() - best.b.getEast()),
        Math.abs(c.b.getWest() - best.b.getWest()),
      );
      if (extra <= maxExtra + 0.01) kept.push(c.f);
    }
  }
  return kept.length ? kept : [best.f];
}

function boundsFromOverpass(geojson, a) {
  const features = geojson?.features || [];
  if (!features.length) return null;

  const use = pickBestAerodromeFeatures(features, a);
  if (!use.length) return null;

  let bounds = null;
  const outlineFeatures = [];

  for (const f of use) {
    const coords = collectCoords(f.geometry);
    if (!coords.length) continue;
    const b = L.latLngBounds(coords);
    bounds = bounds ? bounds.extend(b) : b;
    if (f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon') {
      outlineFeatures.push(f);
    }
  }

  return bounds ? { bounds, outlineFeatures } : null;
}

async function queryOverpass(a, signal) {
  const radius = a.type === 'large' ? 12000 : a.type === 'medium' ? 8000 : 5000;
  const query = `
[out:json][timeout:25];
(
  way["aeroway"="aerodrome"](around:${radius},${a.lat},${a.lon});
  relation["aeroway"="aerodrome"](around:${radius},${a.lat},${a.lon});
);
out geom;
`.trim();

  let lastErr;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const features = osmToFeatures(data.elements || []);
      return { type: 'FeatureCollection', features };
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      lastErr = err;
    }
  }
  throw lastErr || new Error('Overpass failed');
}

function osmToFeatures(elements) {
  const features = [];
  for (const el of elements) {
    if (el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 3) {
      const ring = el.geometry.map((p) => [p.lon, p.lat]);
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
      features.push({
        type: 'Feature',
        properties: el.tags || {},
        geometry: { type: 'Polygon', coordinates: [ring] },
      });
    } else if (el.type === 'relation' && Array.isArray(el.members)) {
      const outers = [];
      for (const m of el.members) {
        if (m.role === 'outer' && Array.isArray(m.geometry) && m.geometry.length >= 2) {
          const ring = m.geometry.map((p) => [p.lon, p.lat]);
          const first = ring[0];
          const last = ring[ring.length - 1];
          if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
          outers.push(ring);
        }
      }
      if (outers.length === 1) {
        features.push({
          type: 'Feature',
          properties: el.tags || {},
          geometry: { type: 'Polygon', coordinates: outers },
        });
      } else if (outers.length > 1) {
        features.push({
          type: 'Feature',
          properties: el.tags || {},
          geometry: { type: 'MultiPolygon', coordinates: outers.map((r) => [r]) },
        });
      }
    }
  }
  return features;
}

function drawOutline(features) {
  outlineLayer.clearLayers();
  if (!features?.length) return;
  L.geoJSON(
    { type: 'FeatureCollection', features },
    {
      style: {
        className: 'aerodrome-outline',
        color: '#3b82f6',
        weight: 2,
        opacity: 0.85,
        fillColor: '#3b82f6',
        fillOpacity: 0.08,
      },
    },
  ).addTo(outlineLayer);
}

function applyFit(bounds) {
  const padTop =
    72 +
    (parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--safe-top'),
    ) || 0);
  const padBottom = el.sheet.hidden ? 24 : 200;
  map.invalidateSize();
  map.fitBounds(bounds, {
    paddingTopLeft: [16, padTop],
    paddingBottomRight: [16, padBottom],
    maxZoom: 15,
    animate: true,
  });
}

/**
 * Offline-first fit:
 * 1) local baked bbox
 * 2) Overpass only if online and we want finer outline (optional upgrade)
 * 3) type fallback already covered by localBounds
 */
async function fitAirport(a) {
  if (overpassAbort) overpassAbort.abort();
  overpassAbort = new AbortController();
  const { signal } = overpassAbort;

  outlineLayer.clearLayers();

  const baked = localBounds(a);
  applyFit(baked);

  if (!isOnline()) {
    showStatus('离线：已按本地范围适配');
    setTimeout(() => showStatus(''), 2200);
    return;
  }

  // Online: try Overpass for better outline (non-blocking after local fit)
  showStatus('正在获取精确机场边界…');
  try {
    const geojson = await queryOverpass(a, signal);
    const parsed = boundsFromOverpass(geojson, a);
    if (parsed?.bounds && parsed.bounds.isValid()) {
      drawOutline(parsed.outlineFeatures);
      applyFit(parsed.bounds);
      showStatus('已按 OSM 机场边界适配');
    } else {
      showStatus('未找到精确边界，使用本地范围');
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.warn('Overpass failed', err);
    showStatus('Overpass 失败，使用本地范围');
  }

  setTimeout(() => showStatus(''), 2200);
}

async function cacheSelectedAirport() {
  if (!selected || prefetching) return;
  if (!isOnline()) {
    showStatus('请先联网缓存该机场周边地图');
    setTimeout(() => showStatus(''), 2500);
    return;
  }
  prefetching = true;
  if (el.btnCache) el.btnCache.disabled = true;
  const bounds = localBounds(selected).pad(0.15);
  showStatus('正在缓存离线地图… 0%');
  try {
    const result = await prefetchTiles(bounds, 12, 16, ({ done, total }) => {
      const pct = total ? Math.round((done / total) * 100) : 0;
      showStatus(`正在缓存离线地图… ${pct}%`);
    });
    const n = await countCachedTilesApprox();
    showStatus(
      `已缓存 ${result.ok}/${result.total} 瓦片（库内约 ${n}）${
        result.truncated ? '（已限流截断）' : ''
      }`,
    );
  } catch (err) {
    console.warn(err);
    showStatus('缓存失败：' + (err.message || '未知错误'));
  } finally {
    prefetching = false;
    if (el.btnCache) el.btnCache.disabled = false;
    setTimeout(() => showStatus(''), 3500);
  }
}

function selectAirport(a, { fit = true } = {}) {
  openSheet(a);
  el.results.hidden = true;
  el.input.value = airportLabel(a);
  el.clear.hidden = false;
  if (fit) fitAirport(a);
}

function goWorld() {
  if (overpassAbort) overpassAbort.abort();
  outlineLayer.clearLayers();
  selected = null;
  el.sheet.hidden = true;
  showStatus('');
  map.setView(WORLD_VIEW.center, WORLD_VIEW.zoom, { animate: true });
  setTimeout(() => map.invalidateSize(), 50);
}

function wireUi() {
  let debounce;
  el.input.addEventListener('input', () => {
    const q = el.input.value;
    el.clear.hidden = !q;
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      renderResults(searchAirports(q));
    }, 120);
  });

  el.input.addEventListener('focus', () => {
    if (el.input.value.trim()) renderResults(searchAirports(el.input.value));
  });

  el.clear.addEventListener('click', () => {
    el.input.value = '';
    el.clear.hidden = true;
    el.results.hidden = true;
    el.input.focus();
  });

  el.results.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-idx]');
    if (!li) return;
    const idx = Number(li.dataset.idx);
    const a = el.results._items?.[idx];
    if (a) selectAirport(a, { fit: true });
  });

  el.btnFit.addEventListener('click', () => {
    if (selected) fitAirport(selected);
  });

  el.btnWorld.addEventListener('click', goWorld);

  if (el.btnCache) {
    el.btnCache.addEventListener('click', () => cacheSelectedAirport());
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      el.results.hidden = true;
    }
  });
}

function applyDeepLink() {
  const params = new URLSearchParams(location.search);
  let q = params.get('q') || params.get('iata') || '';
  if (!q && location.hash.length > 1) {
    try {
      q = decodeURIComponent(location.hash.slice(1));
    } catch {
      q = location.hash.slice(1);
    }
  }
  q = (q || '').trim();
  if (!q) return false;

  el.input.value = q;
  el.clear.hidden = false;
  const hits = searchAirports(q);
  if (!hits.length) {
    renderResults([]);
    showStatus(`未找到机场：${q}`);
    setTimeout(() => showStatus(''), 2500);
    return false;
  }

  const upper = normalizeQuery(q);
  const exact =
    hits.find((a) => a.iata === upper) ||
    hits.find((a) => a.icao === upper) ||
    hits.find((a) => a.ident === upper) ||
    hits[0];

  selectAirport(exact, { fit: true });
  return true;
}

async function loadData() {
  showStatus('加载机场数据…');
  const res = await fetch(`${import.meta.env.BASE_URL}data/airports.json`);
  if (!res.ok) throw new Error('无法加载 airports.json');
  airports = await res.json();
  showStatus(`已加载 ${airports.length} 个机场`);
  setTimeout(() => showStatus(''), 1500);
}

async function main() {
  initMap();
  wireUi();
  try {
    await loadData();
    addMarkers();
    requestAnimationFrame(() => {
      applyDeepLink();
    });
  } catch (err) {
    console.error(err);
    showStatus('机场数据加载失败');
  }
}

main();
