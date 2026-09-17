# 机场全景 · Airport View

Mobile-first web app: browse/search airports worldwide on OpenStreetMap, then **fit the entire airport footprint** into one phone screen (runways & taxiways visible as OSM map detail).

手机端网页：在 OpenStreetMap 上浏览/搜索全球机场，选中后将**整座机场范围**适配进一屏（跑道、滑行道等 OSM 细节可见）。

**Live / GitHub Pages:** `https://huming0618.github.io/airportview/`（需先开启 Pages）

## Quick start · 快速开始

```bash
npm install
npm run dev
```

Open the printed local URL on a phone or Chrome device toolbar (mobile viewport).

构建生产包（GitHub Pages 默认 `base` 为 `/airportview/`）：

```bash
npm run build
npm run preview
```

本地根路径预览可临时覆盖：

```bash
VITE_BASE=/ npm run build && VITE_BASE=/ npm run preview
```

## Features · 功能

- 全屏地图 + 顶部搜索（机场名 / IATA / ICAO）
- Marker 聚类；点击或搜索选中机场
- **关键：** 查询 OSM Overpass `aeroway=aerodrome` 几何 → `map.fitBounds`，整座机场填满手机屏
- Overpass 失败/超时：按机场类型估算 bbox（large ≈ 0.08°、medium ≈ 0.04°、small ≈ 0.02° 半幅）
- 可选绘制机场轮廓；底部卡片：名称、IATA/ICAO、城市、国家；「定位到此机场」「返回全球视图」
- Deep link：`?q=CTU` 或 `#PVG`

## Data · 数据

Bundled dataset: `public/data/airports.json`（约 1 MB，~6300 条）

Source: [OurAirports](https://davidmegginson.github.io/ourairports-data/airports.csv)

Filter rules:

- All **large_airport** + **medium_airport** worldwide
- **small_airport** only if `scheduled_service=yes` **or** `iso_country=CN`
- Fields: iata, icao/ident, name, lat, lon, country, city, type

Regenerate:

```bash
npm run prepare-data
```

（脚本会下载 CSV 并重写 `public/data/airports.json`）

## Fit-to-airport · 机场范围适配

1. User selects an airport (search or marker).
2. App POSTs an Overpass QL query near lat/lon (radius ~6–15 km) for `way/relation["aeroway"="aerodrome"]` with geometry.
3. Bounding box from returned polygons → `fitBounds` with padding for search bar + bottom sheet.
4. Fallback estimate if Overpass is slow, rate-limited, or empty.

**Note:** Public Overpass instances can be busy. The app tries multiple endpoints and always falls back to type-based bbox so UX stays usable.

OSM tile attribution is shown on the map: © OpenStreetMap contributors.

## Deploy · 部署 GitHub Pages

1. Settings → Pages → Source: GitHub Actions or Deploy from branch `gh-pages` / `/docs`.
2. Or upload `dist/` after `npm run build` (base path `/airportview/`).
3. Ensure Pages URL matches Vite `base` in `vite.config.js`.

## Stack

- Vite + vanilla JS
- Leaflet + OSM tiles
- leaflet.markercluster
- Overpass API (runtime)

## Offline usage · 离线使用

详见调查报告：[docs/offline-usage-investigation.md](./docs/offline-usage-investigation.md)

覆盖 PWA 缓存、PMTiles/MBTiles、预计算机场足迹、桌面/移动壳、局域网 Docker 等断网方案。

## License / credits

Airport metadata © OurAirports contributors. Map data © OpenStreetMap contributors.

## Android 离线版

见 [docs/android-offline-build.md](docs/android-offline-build.md)。调试 APK 需本地用 Android SDK 构建（不入库）。

```bash
npm install
npm run build:android
cd android && ./gradlew assembleDebug
```
