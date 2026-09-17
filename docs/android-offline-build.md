# 机场全景 · Airport View（Android 离线版）

Capacitor 包装的现有 Vite + Leaflet Web 应用，面向 Android 的离线 MVP。

- **包名**：`com.huming.airportview`
- **调试 APK**：`/workspace/deliverables/airportview-offline-debug.apk`（构建产物也可在 `android/app/build/outputs/apk/debug/app-debug.apk`）

## 离线设计（MVP）

| 层级 | 能力 | 实现 |
|------|------|------|
| L1 应用壳 + 机场索引 | 断网可搜索/选中 | 打包 `public/data/airports.json`（~6300 机场） |
| L2 机场足迹 | 一屏适配不依赖 Overpass | 每条机场预置 `bbox: [south,west,north,east]`（按 large/medium/small 半幅估算）；`fitAirport` **优先本地 bbox**，仅在线时可选 Overpass 精细轮廓 |
| L3 底图瓦片 | 有缓存则离线显示 | Cache API 缓存 OSM 瓦片；按钮「缓存此机场离线地图」预取 z12–z16；未命中时中文提示「请先联网缓存该机场周边地图」 |

**不会**内置全球瓦片；请先联网对目标机场点「缓存此机场离线地图」，再断网使用。

## 环境要求

- Node.js 18+ / npm
- OpenJDK 17 或 21（本机构建用过 OpenJDK 21）
- Android SDK（`ANDROID_HOME`），需 `platforms;android-34`、`build-tools;34.0.0`、`platform-tools`

```bash
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64   # 按本机路径调整
export ANDROID_HOME=/workspace/android-sdk            # 或 /opt/android-sdk
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
```

`android/local.properties` 需包含：

```
sdk.dir=/workspace/android-sdk
```

## 重新构建

```bash
cd /workspace/airportview-android   # 或本仓库中对应目录
npm install
VITE_BASE=./ npm run build
npx cap sync android
cd android
./gradlew assembleDebug
```

产物：

- `android/app/build/outputs/apk/debug/app-debug.apk`
- 可复制到：`/workspace/deliverables/airportview-offline-debug.apk`

快捷脚本等价于：`npm run build:android` 后再 `cd android && ./gradlew assembleDebug`。

## 安装到手机

```bash
adb install -r /workspace/deliverables/airportview-offline-debug.apk
```

## 验收建议

1. 安装后开飞行模式：搜索 CTU / PVG 等应能出结果。
2. 选中机场应立即按本地 bbox 缩放到一屏。
3. 若从未缓存瓦片：地图空白/灰，状态栏提示先联网缓存。
4. 联网后点「缓存此机场离线地图」，再断网应能看到已缓存区域底图。

## 与线上 Web 的关系

本目录为 **Android / 离线包专用副本**（`VITE_BASE=./`），避免改坏 GitHub Pages 的 `/airportview/` 基路径。离线相关源码也可同步回主仓库 `src/`（主站仍用 `VITE_BASE=/airportview/` 构建）。

## 许可与合规

- 地图数据 © OpenStreetMap contributors（ODbL）
- 机场元数据来自 OurAirports 衍生数据
- 请勿对 `tile.openstreetmap.org` 做大规模批量下载；本 MVP 预取已限制并发与总量（约 ≤800 瓦片/次）
