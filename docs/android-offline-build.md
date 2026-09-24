# 机场全景 · Airport View（Android 离线版）

Capacitor 包装的 Vite + Leaflet Web 应用，面向 Android 的离线 MVP。

- **包名**：`com.huming.airportview`
- **调试 APK**：`/workspace/deliverables/airportview-offline-debug.apk`（构建产物也可在 `android/app/build/outputs/apk/debug/app-debug.apk`）

## 离线设计

| 层级 | 能力 | 实现 |
|------|------|------|
| L1 应用壳 + 机场索引 | 断网可搜索/选中 | 打包 `public/data/airports.json`（~6300 机场） |
| L2 机场足迹 | 一屏适配不依赖 Overpass | 每条机场预置 `bbox: [south,west,north,east]`；`fitAirport` **优先本地 bbox**，仅在线时可选 Overpass 精细轮廓 |
| L3 底图瓦片 | **常用机场开箱离线** | 预置 `public/offline-tiles/{z}/{x}/{y}.png`（z12–z15）；运行时 Cache API；按钮可联网预取其它机场 |

### 内置离线底图（L3 预置）

以下机场按各自 `bbox` 预下载栅格瓦片（z12–z15），随 APK 打包，**无需先点「缓存」即可离线显示**：

`CTU` `TFU` `PVG` `PEK` `CAN` `SHA` `HKG` `LAX` `NRT` `LHR`

瓦片加载顺序：

1. 内置 `offline-tiles/{z}/{x}/{y}.png`（绝对 URL，见 `resolveAssetUrl`）
2. Cache API（运行时缓存）
3. 网络 OSM → 失败则 Carto Positron（在线时）

离线时地图 `maxZoom` 限制为 15（与预置 z12–z15 一致）；详见 [android-offline-v3-fix.md](./android-offline-v3-fix.md)。

首次启动会尽量把内置瓦片暖进 Cache API（best-effort）。其它机场仍需联网点「缓存此机场离线地图」。

重新生成瓦片包：

```bash
npm run seed-offline-tiles
# 约 1.5 req/s，User-Agent 可识别；OSM 受限时自动回退 Carto Positron
```

产物：`public/offline-tiles/` + `manifest.json`（机场列表、瓦片数、来源归属）。

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
cd /workspace/airportview-android   # 或本仓库根目录（含 android/）
npm install
# 可选：npm run seed-offline-tiles
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
2. 选中 **CTU**（或其它内置机场）应立即按本地 bbox 缩放，**无需点缓存**即可看到底图瓦片。
3. 未内置的机场：地图可能空白/灰，状态栏提示可联网缓存；离线横幅文案为「常用机场已内置离线底图；其他机场仍可联网缓存」。
4. 联网后点「缓存此机场离线地图」，再断网应能看到已缓存区域底图。

## 与线上 Web 的关系

Android / 离线包使用 `VITE_BASE=./`。离线相关源码与 `public/offline-tiles` 同步在 GitHub `huming0618/airportview`；主站 GitHub Pages 仍可用 `VITE_BASE=/airportview/` 构建。

## 许可与合规

- 地图数据 © OpenStreetMap contributors（ODbL）；预置瓦片可能来自 OSM 官方栅格或 CARTO Positron（见 `offline-tiles/manifest.json`）
- 机场元数据来自 OurAirports 衍生数据
- 批量预下载仅覆盖少数机场 bbox × z12–z15，并限速；请勿对 tile 服务做城市级 / 全球级抓取
