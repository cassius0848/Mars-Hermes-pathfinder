# 火星在线地图

在线地图可在全球、Jezero、Gale、Endeavour、Eberswalde 和两个 Jezero 步行区之间跳转、缩放和平移。全球视图用虚线连接四个经典陨石坑，局部视图可继续用同一套 NASA/USGS 图层和在线高程剖面。浏览器从 NASA 读取当前图层的 WMTS 瓦片矩阵，只请求覆盖当前视野的瓦片。 [打开地图](https://mars-pathfinder-jezero.fengboyuan030509.chatgpt.site/atlas.html) · [NASA Mars Trek 接口](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars)

| 图层或功能 | 数据与范围 |
| --- | --- |
| 全球地图 | Mars Trek 提供 Viking 光学、MOLA 地形着色和 THEMIS 日间红外瓦片。全球视图叠加 Jezero、Gale、Endeavour、Eberswalde 的经典陨石坑网络。极区和图层像元覆盖遵循各官方产品。 |
| 经典陨石坑区域 | 四个区域按钮定位到约 2–3° 的局部视野，并保留拖动、缩放、NASA MOLA 两点剖面、MOLA GeoTIFF 导出和上游数据链接。 |
| Jezero 轨道影像 | 叠加官方 CTX 和 HiRISE 正射瓦片。缩放会读取对应分辨率，区域外由底图接续。透明度可调整。 |
| Jezero 地质 | 按视野向 USGS SIM 3464 查询多边形几何，经投影转换后与影像叠加。地质面覆盖取决于 USGS 的制图范围。 |
| 全球数值高程 | 在地图选两个点，向 NASA MOLA 请求沿线 24 个数值样点。较小视野可直接下载官方按范围导出的浮点 GeoTIFF。 |
| Jezero 20 米数值高程 | 放大至约 10 公里内并打开 CTX 高程图层。网页核对 USGS 原始 TIFF 文件头，按字节范围读取相交行，并把真实高程着色叠加。 |
| 立体高程产品目录 | 按视野在 USGS STAC 检索 HiRISE 立体高程，查看覆盖边界与可用的高程、正射、质量图链接。 |

经典陨石坑的数据源面板也会随区域按钮切换：Gale 使用 USGS/NASA MSL Gale Merged DEM 1m v3，Endeavour 使用 NASA/HiRISE Western Rim DTM，Eberswalde 使用 NASA/HiRISE Delta Structure DTM。原始产品体量分别约 3.6 GB、675 MB 和 412 MB，因此只链接官方原始产品，待裁切和质量核验后再进入本地 A* 包。详细入口和裁切规范见 [经典陨石坑数据包说明](classic-crater-data.md)。

在线图层依赖上游服务。网页分别显示影像失败、未制图地质面、有效高程缺测及目录无结果。四个经典陨石坑的在线模式用于跨区域地形筛选和路线剖面核验；米级 A*、预算约束、候选路线和导航回放仍在 Jezero 任务地图进行，两个步行区使用已配准的 2 米任务数据包，40 公里区域走廊使用 100 米规划网格。这样全球地图的范围扩展不会把没有本地 DEM/坡度包的区域误称为米级可行走路线。 [步行规划核验](web-navigation-audit.md)

源代码 `web/atlas.html`、`web/atlas.js` 和 `web/mars-data.js` 随 `python scripts/build_web.py` 一并导出。离线包用于运行任务场景，在线地图需要连接数据服务。 [USGS 20 米 CTX](https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic) · [USGS SIM 3464](https://doi.org/10.3133/sim3464) · [USGS HiRISE 目录](https://stac.astrogeology.usgs.gov/docs/data/mars/hirise_dtms/)
