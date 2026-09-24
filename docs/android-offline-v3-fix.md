# Android offline tile loading fix (v3)

## Root causes fixed

1. **Bundled tile URL resolution** — Relative `./offline-tiles/...` (via `import.meta.env.BASE_URL`) could fail depending on the Capacitor WebView document URL. Tiles and `airports.json` now resolve with `resolveAssetUrl()` anchored to `window.location` + Vite base (absolute `https://localhost/...` under `androidScheme: https`).

2. **Zoom outside seeded range** — Map `maxZoom` was 19 while bundled tiles are only z12–z15. Offline pinch-zoom requested blank z16–z19 tiles. Offline now caps map/layer maxZoom at 15 (`syncOfflineZoomLimits`); online still allows 19. `fitBounds` already used maxZoom 15.

3. **OSM blocked in WebView** — Network path tried only OSM. OSM often 403/429s WebViews. After OSM fails, loader tries **Carto Positron** (`basemaps.cartocdn.com/light_all`). Prefetch uses the same fallbacks.

4. **Cache warm race / tileoffline flash** — First paint could fire `tileoffline` before bundled fetch completed. Manifest warm now retries, is awaited up to ~2.5s before deep-link fit, and UI only warns after several misses.

5. **`done()` callback** — Success paths correctly rely on img `load` → Leaflet `_tileOnLoad` → `done(null)`. Miss paths no longer also call `done(err)` (which double-fired with the placeholder `load`). `onceDone` guards against double completion.

6. **Error / miss tile** — Transparent 1×1 GIF replaced with a **light gray** placeholder so missing tiles are visible vs “broken”.

7. **Coverage** — Did not re-seed z11 (APK size / download time). Offline zoom cap keeps the viewport within z12–z15 seeded coverage for common airports (CTU/TFU/…).

## Load order

bundled `offline-tiles/{z}/{x}/{y}.png` → Cache API → OSM network → Carto Positron network → gray placeholder.

## Build / release

```bash
VITE_BASE=./ npm run build && npx cap sync android
cd android && ./gradlew assembleDebug
# APK → /workspace/deliverables/airportview-offline-debug.apk
# GitHub release tag: android-offline-v3
```
