# 机场全景 · Airport View（Android 离线版）

Capacitor 包装的现有 Vite + Leaflet Web 应用，面向 Android 的离线 MVP。

- **包名**：`com.huming.airportview`
- **调试 APK**：`/workspace/deliverables/airportview-offline-debug.apk`

## 离线能力摘要

| 层级 | 能力 |
|------|------|
| L1 | 打包 ~6300 机场索引，断网可搜 |
| L2 | 每机场预置 `bbox`，一屏适配不依赖 Overpass |
| L3 | **常用机场（CTU/TFU/PVG/PEK/CAN/SHA/HKG/LAX/NRT/LHR）内置 z12–z15 离线底图**；其它机场可联网缓存 |

瓦片加载：内置 `offline-tiles/` → Cache API → 网络。详见 [docs/android-offline-build.md](docs/android-offline-build.md)。

## 快速构建

```bash
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export ANDROID_HOME=/workspace/android-sdk
npm install
# 可选重新拉瓦片：npm run seed-offline-tiles
VITE_BASE=./ npm run build && npx cap sync android
cd android && ./gradlew assembleDebug
cp app/build/outputs/apk/debug/app-debug.apk /workspace/deliverables/airportview-offline-debug.apk
```

## 验收（飞行模式）

1. 搜索 CTU → 选中后应直接显示底图（无需点「缓存」）。
2. 离线横幅：`常用机场已内置离线底图；其他机场仍可联网缓存`。

## 许可

© OpenStreetMap contributors；预置瓦片见 `public/offline-tiles/manifest.json` 归属说明。
