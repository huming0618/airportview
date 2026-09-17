# 离线使用调查报告：Airport View（机场全景）

> 项目：https://github.com/huming0618/airportview  
> 线上：https://huming0618.github.io/airportview/  
> 报告日期：2026-09-17  
> 范围：在**无公网联网**条件下，如何继续使用本服务（不限于手机 App），含跨平台方案、数据与瓦片策略、分阶段落地建议。

---

## 1. 结论摘要

当前 Airport View 是 **依赖公网的手机优先 Web App**：

| 能力 | 现状 | 离线时 |
|------|------|--------|
| 应用壳（HTML/JS/CSS） | GitHub Pages / 本地 Vite | 可打包本地打开 |
| 机场列表 `airports.json` | 已内置（约 1 MB，~6300 条） | **已可离线** |
| 底图瓦片 | 公网 OSM XYZ | **不可用**（最大瓶颈） |
| 机场轮廓适配 | 运行时请求 Overpass | **不可用**（已有类型估算 bbox 回退） |

**核心判断：**

1. **机场元数据搜索与选中**，在拷贝静态包后即可离线工作。  
2. **“一屏看清机场全貌”** 依赖 OSM 细节瓦片；真正离线必须自备底图（缓存瓦片 / MBTiles / PMTiles / 本地瓦片服务）。  
3. **精确机场多边形** 应改为预计算进数据包，而不是依赖 Overpass。  
4. 不存在“零改造、全球高清、无限缩放、完全离线”的魔法方案；可行路径是 **按区域打包 + 预计算轮廓 + 本地托管**。

**优先推荐（对本仓库）：**

1. **短期**：静态包 + PWA 缓存 + 区域瓦片预下载（用户联网时缓存目标机场周边）。  
2. **中期**：预计算全球机场 bbox/多边形；底图用 **PMTiles/MBTiles** 区域包。  
3. **长期**：桌面（Electron/Tauri）或手机（Capacitor）壳 + 可选本地 TileServer；或 Docker 一键离线套件。

---

## 2. 当前服务的联网依赖拆解

### 2.1 应用逻辑（`src/main.js`）

- **Leaflet + OSM 栅格瓦片**：`https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`  
  - 无网 → 地图灰屏/空白。  
- **OurAirports 衍生数据**：`public/data/airports.json`  
  - 构建时写入；运行时只读本地。  
- **Overpass**：查询 `aeroway=aerodrome` 几何 → `fitBounds`  
  - 无网 → 走 `fallbackBounds`（按 large/medium/small 估算半幅），仍能缩放，但**看不到跑道细节**（细节来自瓦片，不是轮廓线本身）。  
- **GitHub Pages 托管**：访问站点本身需要联网（除非改用本地/内网托管）。

### 2.2 “没联网”的几种含义（方案要对号入座）

| 场景 | 含义 | 可用策略 |
|------|------|----------|
| A. 设备完全断网 | 无蜂窝/Wi‑Fi | 预装静态资源 + 本地瓦片包 |
| B. 仅局域网 | 无公网，有 Wi‑Fi/USB 共享 | 一台机器当离线服务器，其它设备访问 |
| C. 弱网/间歇 | 偶尔能同步 | PWA 增量缓存、先下后飞 |
| D. 物理介质分发 | U 盘/SD/光盘 | 拷贝发布包 + 区域瓦片包 |

下文“离线”默认指 **A/B/D**；C 作为增强。

---

## 3. 离线能力分层模型

建议把产品拆成三层，分别解决：

```
┌─────────────────────────────────────────┐
│ L1 应用壳 + 机场索引（已基本可离线）      │
├─────────────────────────────────────────┤
│ L2 机场足迹（bbox/多边形）预计算数据      │
├─────────────────────────────────────────┤
│ L3 底图瓦片（区域 OSM / 定制样式）        │
└─────────────────────────────────────────┘
```

- **只做 L1**：可搜索机场、看坐标、用估算框缩放 —— **体验差**（无跑道影像）。  
- **L1+L2**：缩放准确、可画轮廓 —— **仍缺底图细节**。  
- **L1+L2+L3**：接近线上体验的离线版 —— **推荐目标**。

---

## 4. 解决方案总览（按形态）

### 方案一：静态离线包（浏览器直接打开 / 内网 Nginx）

**做法：**

1. `npm run build` 得到 `dist/`。  
2. 用 `VITE_BASE=/` 构建，避免 GitHub Pages 的 `/airportview/` 路径依赖。  
3. 将 `dist/` 拷到 U 盘，或放到断网电脑的 Nginx/Caddy/`python -m http.server`。  
4. 手机通过局域网访问该主机（场景 B）。

**优点：** 实现成本最低；与现有栈一致。  
**缺点：** 默认仍指向公网 OSM；必须改瓦片源或叠缓存才有地图。  
**适用：** 内网演示、快速验证 L1。

**注意：** 用 `file://` 直接打开可能因 CORS/模块路径失败；优先用本地 HTTP 服务。

---

### 方案二：PWA + Service Worker（推荐短期增强）

**做法：**

- 使用 `vite-plugin-pwa` / Workbox / Serwist。  
- **预缓存**：App Shell + `airports.json` + JS/CSS。  
- **运行时缓存**：OSM 瓦片 `CacheFirst`（参考 webmap.dev、Voyago 等实践：瓦片缓存 7–30 天，限制条目数）。  
- **主动区域下载**：用户选机场或画框后，按 z/x/y 批量拉取瓦片写入 Cache API（仅在有网时执行）。

**优点：** 仍是一个 Web；安装到主屏幕；对“先联网再断网”友好。  
**缺点：** 浏览器缓存配额有限（移动端常数十到数百 MB）；全球瓦片不可能全下；Safari 对 SW 有限制。  
**适用：** 场景 C → A（出差前缓存 CTU/PVG 周边）。

**对本项目的改造点：**

1. 注册 SW，缓存静态资源。  
2. UI：“下载此机场离线包（z10–z16）”。  
3. 离线时瓦片走缓存；未命中显示占位与提示。

---

### 方案三：PMTiles / MBTiles 区域底图包（推荐中期核心）

这是业界目前最干净的离线底图方案之一。

#### 3.1 PMTiles（单文件 + HTTP Range）

- 用 Planetiler 等从 OSM 提取生成 `.pmtiles`。  
- Leaflet 可通过 `pmtiles` 库挂栅格层，或 MapLibre 读矢量 PMTiles。  
- Service Worker 可缓存 Range 响应，支持离线（见 Protomaps / 相关实践文章）。

**优点：** 单文件分发；无需完整瓦片目录树；适合 U 盘/内网。  
**缺点：** 需准备区域提取流水线；全球完整包体积巨大。

#### 3.2 MBTiles + TileServer GL

- 区域 `.mbtiles` + Docker/`tileserver-gl`（或 light）。  
- Leaflet 指向本地渲染出的 PNG 样式 URL，或 MapLibre 读矢量。

**优点：** 成熟、文档多；适合局域网服务器。  
**缺点：** 手机端一般不直接跑 TileServer；更适合场景 B（笔记本当服务器）。

#### 3.3 体积粗估（数量级，实际随样式/缩放变化）

| 覆盖 | 缩放约 z0–14 | 说明 |
|------|----------------|------|
| 单大型机场周边 20–40 km | 几十 MB～数百 MB | 适合“按机场下载” |
| 成都市域 | 数百 MB～数 GB | 视 zmax |
| 全国/全球全细节 | 数十 GB～TB | 不适合手机内置 |

**策略建议：** 默认提供“机场周边包”；可选“城市包”；不做默认全球全 z 级。

---

### 方案四：预计算机场足迹（替代 Overpass）

**问题：** Overpass 公网服务在离线不可用；且在线时也可能慢/限流。

**做法：**

1. 批处理脚本（CI 或本地）对每个机场调用 Overpass / 使用 Geofabrik 提取中的 `aeroway=*`，生成：  
   - `bbox: [south, west, north, east]`  
   - 可选 GeoJSON 多边形  
2. 写入 `airports.json` 扩展字段，或独立 `footprints.json`（可按 ICAO 分片）。  
3. 离线 `fitAirport` **只读本地几何**；联网时可选在线刷新。

**优点：** 离线缩放准确、轮廓可画、启动快、无运行时依赖。  
**缺点：** 数据需定期更新；全球多边形会增大包体（可用仅 bbox + 大机场完整 polygon 的混合策略）。

**强烈建议作为离线版的硬需求。**

---

### 方案五：桌面壳（Electron / Tauri）

**做法：**

- 壳内加载本地 `dist/`。  
- 内置或旁路启动 `tileserver-gl-light`，或直接读本地 PMTiles。  
- 机场数据与足迹一并打包进安装包或首次导入目录。

**优点：** 分发成 `.dmg` / `.exe` / `.AppImage`；用户双击即用；适合机房/机载电脑。  
**缺点：** 安装包体积随瓦片变大；需签名与更新通道。  
**适用：** Windows/macOS/Linux 完全断网岗位。

**Tauri 相对 Electron：** 体积更小；瓦片仍建议外置数据目录，避免把 GB 级数据打进二进制。

---

### 方案六：移动原生壳（Capacitor / Cordova）

**做法：**

- Web 前端用 Capacitor 包成 iOS/Android。  
- 底图：MapLibre + 本地 MBTiles（如 `maplibre-gl-capacitor-offline` 一类方案），或预下载瓦片到应用沙箱。  
- 大文件放扩展存储 / 用户导入。

**优点：** 应用商店分发、后台存储更可控、可做“导入离线包”。  
**缺点：** 审核、双端维护；iOS 后台与存储策略更严。  
**适用：** 一线外业、机坪工作人员、无公网外场。

---

### 方案七：局域网离线服务器（一机多端）

**架构：**

```
[离线服务器: Nginx + 静态站点 + TileServer/PMTiles]
        │  Wi‑Fi / 有线 / USB 共享网络
        ├─ 手机浏览器
        ├─ 平板
        └─ 其它电脑
```

**做法：**

1. Docker Compose：`web(dist)` + `tiles` + 可选 `footprints` 数据卷。  
2. 手机扫码打开 `http://192.168.x.x/`。  

**优点：** 瓦片只存一份；多设备共享；适合指挥所/航站楼内网。  
**缺点：** 需要一台常开主机；仍要做首次数据导入。

---

### 方案八：物理介质与预置镜像

| 介质 | 内容 | 场景 |
|------|------|------|
| U 盘 | `dist/` + 区域 PMTiles + README | 快速拷贝 |
| SD 卡 | 同上，插入树莓派当盒子 | 便携热点服务器 |
| 光盘/只读镜像 | 固定版本演示包 | 培训、展会 |
| 系统镜像 | 预装 Docker 离线套件 | 批量交付工控机 |

---

### 方案九：不改代码的“旁路”用法（权宜）

在无法改 Airport View 时，仍可用其它离线地图查看机场：

- **OsmAnd / Organic Maps / maps.me 类**：预下载离线路网，搜索机场 POI。  
- **QGIS + 本地 OSM 提取**：专业 GIS 离线分析。  
- **打印/PDF 机场图**：极端断网时的非交互方案。

这些**不能替代**本产品的“全球机场索引 + 一屏适配”产品形态，但可作应急。

---

## 5. 按平台对照表

| 平台 | 推荐方案 | 底图 | 足迹 | 说明 |
|------|----------|------|------|------|
| 手机浏览器 | PWA + 区域缓存 | SW 缓存 / 导入 PMTiles（能力有限） | 预计算 | 先联网下载再断网 |
| 桌面浏览器 | 本地静态站 + PMTiles | 本地文件/内网 | 预计算 | 最易落地 |
| Android | Capacitor + MBTiles/PMTiles | 本地库 | 预计算 | 可做“导入包” |
| iOS | 同左（注意存储与 ATS） | 本地库 | 预计算 | 大包宜 On-Demand Resources / 文件导入 |
| Windows/macOS/Linux 桌面 | Tauri/Electron | 内置 TileServer 或 PMTiles | 预计算 | 适合完全断网岗位 |
| 树莓派/工控机 | Docker Compose | TileServer + 卷 | 预计算 | 局域网多端 |
| 仅 U 盘 | 静态包 + 区域瓦片文件 | 用户自备查看器或本地 HTTP | 预计算 | 需简短启动脚本 |

---

## 6. 针对本仓库的分阶段落地路线图

### 阶段 0（0.5–1 天）：文档与静态离线包

- [x] 本报告入库。  
- [ ] README 增加“离线说明”入口。  
- [ ] 提供 `VITE_BASE=/ npm run build` 的离线构建命令。  
- [ ] 增加 `scripts/serve-offline.sh`（本地静态服务）。

### 阶段 1（2–5 天）：L2 足迹预计算 + 离线回退体验

- [ ] `scripts/prepare-footprints.js`：批量生成 bbox（及可选 polygon）。  
- [ ] `fitAirport` 优先本地足迹，再 Overpass，再类型估算。  
- [ ] 离线检测：`navigator.onLine` + 瓦片加载失败提示。

### 阶段 2（1–2 周）：L3 区域瓦片

- [ ] 选定 PMTiles 或 MBTiles 流水线（Planetiler / 第三方区域包）。  
- [ ] UI：“为当前机场下载离线底图”。  
- [ ] PWA 缓存策略与配额提示。  
- [ ] 示例数据：CTU、PVG、LAX 三个演示包。

### 阶段 3（按需）：壳与交付

- [ ] Docker Compose 一键离线套件。  
- [ ] Tauri 桌面版或 Capacitor 移动版（二选一先做需求方最多的平台）。  
- [ ] 版本化离线数据包清单（manifest：区域、z 级、体积、生成日期、OSM 纪元）。

---

## 7. 架构示意：推荐的“可离线 Airport View”

```
[机场索引 airports.json] ──┐
[足迹 footprints.*] ───────┼──► Airport View 前端
[区域 PMTiles/MBTiles] ────┘         │
                                     ▼
                        fitBounds(本地足迹) + 本地瓦片图层
```

联网增强（可选）：

- 增量更新足迹与瓦片包。  
- Overpass 仅作“在线刷新轮廓”。

---

## 8. 风险、合规与运维

1. **体积与存储：** 移动端必须按机场/城市分包；提供删除与配额提示。  
2. **新鲜度：** OSM 与机场开闭状态会变；离线包需标注生成日期。  
3. **许可：**  
   - OpenStreetMap 数据：ODbL，需保留 © OpenStreetMap contributors。  
   - OurAirports：遵循其数据条款与署名。  
   - 公网 OSM 瓦片服务使用政策：大规模批量下载应改用**自建提取**，避免违规压测 tile.openstreetmap.org。  
4. **安全：** 内网 TileServer 注意 Host 头与绑定地址；勿把管理端口暴露到不可信网络。  
5. **隐私：** 纯本地包可不经公网；PWA 缓存仍在设备本地。

---

## 9. 方案选型建议（决策树）

```
是否需要看清跑道等 OSM 细节？
 ├─ 否 → 仅静态包 + 本地足迹（估算/预计算）即可
 └─ 是 → 是否经常在同一区域断网？
      ├─ 是（如常驻成都） → 城市/机场 PMTiles + PWA/桌面壳
      └─ 否（全球到处飞） → “按机场下载离线包” + 云端/有网时同步
是否多设备共享同一内网？
 ├─ 是 → Docker/局域网 TileServer
 └─ 否 → 单机 PWA / Tauri / Capacitor
```

**对当前产品的默认建议：**  
先做 **预计算足迹 + 按机场 PMTiles/缓存下载 + PWA**；若出现固定断网机房需求，再加 **Docker 离线套件**；若要应用商店分发，再包 **Capacitor**。

---

## 10. 参考资料

- 本仓库 README 与 `src/main.js`（Leaflet / Overpass / OurAirports 流程）  
- Protomaps：PMTiles for Leaflet — https://docs.protomaps.com/pmtiles/leaflet  
- TileServer GL — https://github.com/maptiler/tileserver-gl  
- PWA 离线地图实践（Service Worker 缓存 OSM 瓦片）— 如 webmap.dev 等开源项目  
- MapLibre + Capacitor 离线 MBTiles — `@yermo/maplibre-gl-capacitor-offline` 等  
- OurAirports 数据 — https://ourairports.com / davidmegginson/ourairports-data  
- OpenStreetMap 使用政策与 ODbL — https://www.openstreetmap.org/copyright  

---

## 11. 附录：最小可行离线演示清单（MVP）

用于验证“没联网也能用”的最小集合：

1. `dist/`（`VITE_BASE=/` 构建）  
2. 扩展后的 `airports.json`（含 CTU/PVG/LAX 的预计算 bbox）  
3. 三个机场周边 PMTiles 或瓦片缓存目录（z10–z15）  
4. 本地启动脚本：`npx serve dist` 或 Nginx  
5. 验收标准：  
   - 断网后打开站点成功；  
   - 搜索 CTU 自动选中；  
   - 一屏内可见跑道级细节（依赖已下瓦片）；  
   - 不请求 `tile.openstreetmap.org` / Overpass。

---

*本报告描述方案与建议，不构成已实现功能清单。落地时请按阶段 0→3 增量提交代码。*
