# 火星在线地图

在线地图可在全球、Jezero、Gale、Endeavour、Eberswalde 和两个 Jezero 步行区之间跳转、缩放和平移。浏览器只请求当前视野内的 NASA WMTS 瓦片。 [打开地图](https://mars-pathfinder-jezero.fengboyuan030509.chatgpt.site/atlas.html) · [NASA Mars Trek 接口](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars)

| 图层或功能 | 数据与范围 |
| --- | --- |
| 全球地图 | Mars Trek 提供 Viking 光学、MOLA 地形着色和 THEMIS 日间红外瓦片。极区和图层像元覆盖遵循各官方产品。 |
| Jezero 轨道影像 | 叠加官方 CTX 和 HiRISE 正射瓦片。缩放会读取对应分辨率，区域外由底图接续。透明度可调整。 |
| Jezero 地质 | 按视野向 USGS SIM 3464 查询多边形几何，经投影转换后与影像叠加。地质面覆盖取决于 USGS 的制图范围。 |
| 全球数值高程 | 在地图选两个点，向 NASA MOLA 请求沿线 24 个数值样点。较小视野可直接下载官方按范围导出的浮点 GeoTIFF。 |
| Jezero 20 米数值高程 | 放大至约 10 公里内并打开 CTX 高程图层。网页核对 USGS 原始 TIFF 文件头，按字节范围读取相交行，并把真实高程着色叠加。 |
| 立体高程产品目录 | 按视野在 USGS STAC 检索 HiRISE 立体高程，查看覆盖边界与可用的高程、正射、质量图链接。 |

在线地图可选择出发地和目的地并在同一页计算路线。浏览器使用 A* 比较时间、坡度、爬升和给定太阳时的模拟阴影，相同路径合并。Jezero 支持时间预算、预留时间及往返规划。三维地形直接由规划使用的数值高程构建，路线可旋转查看、暂停或拖动进度。

| 规划高程 | 覆盖与限制 |
| --- | --- |
| HiRISE 2 米网格 | 两点位于同一个验证区时可用，覆盖 Hawksbill Gap 和 Neretva Vallis，使用已配准的官方高程与正射影像。 |
| 在线 CTX 20 米网格 | Jezero 的 USGS/JPL 产品覆盖内可用，两点相距最多 15 公里。浏览器按字节区间读取路线周边的原始高程。 |
| 在线 MOLA 约 1 公里网格 | 其他区域可比较大尺度地形走廊。两点相距 3–120 公里，南北纬 80° 以内，路线窗口不跨 ±180°。网页从 NASA 请求路线周边的数值 GeoTIFF。 |

在线图层依赖上游服务。网页分别显示影像失败、未制图地质面、有效高程缺测及目录无结果。MOLA 走廊只用于地形初筛，岩块和小陡坎超出其空间分辨率。 [步行规划核验](web-navigation-audit.md)

源代码 `web/atlas.html`、`web/atlas.js` 和 `web/mars-data.js` 随 `python scripts/build_web.py` 一并导出。离线包用于运行任务场景，在线地图需要连接数据服务。 [USGS 20 米 CTX](https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic) · [USGS SIM 3464](https://doi.org/10.3133/sim3464) · [USGS HiRISE 目录](https://stac.astrogeology.usgs.gov/docs/data/mars/hirise_dtms/)
