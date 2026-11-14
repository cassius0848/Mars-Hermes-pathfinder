# 首版火星导航范围

以 Jezero 西部三角洲、陨石坑底和西侧越岭走廊为任务主线。区域地图中心设在 **77.74°E、18.44°N**，采用火星本地方位等距投影，**半径 40 km，直径 80 km，约 5,027 km²**。这个中心用于制图。圆区覆盖 Jezero 主体、毅力号登陆区、Hawksbill Gap、Neretva Vallis 和已有航点记录的西部路线。归档中的 708 个 NASA 行驶定位点全部在圈内，最后一个记录为 Sol 2022。 [NASA 毅力号地图](https://science.nasa.gov/mission/mars-2020-perseverance/location-map/) · [NASA 行驶定位档案](https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json) · [Jezero 命名档案](https://planetarynames.wr.usgs.gov/Feature/14300)

## 为什么先做 Jezero

Jezero 的同一区域有 MRO CTX 区域高程与影像、HiRISE 立体高程、Mars Odyssey THEMIS 热红外、USGS SIM 3464 地质图，以及毅力号路径、地面照片和 MEDA 的历史观测。Hawksbill Gap 的 Swift Run 和 Hazeltop 已有实际采样证据与可复算的局部网格。Gale crater 也有 Curiosity 实证和地质价值，可作为第二场景。Jezero 还已有 NASA/USGS 为毅力号西缘作业发布的高分辨率拼图和质量信息，可用于下一批局部步行区核验。 [NASA Jezero 岩石样本](https://science.nasa.gov/mission/mars-2020-perseverance/mars-rock-samples/) · [Curiosity 的 Gale 场景](https://science.nasa.gov/photojournal/context-of-curiosity-landing-site-in-gale-crater/) · [USGS Jezero 西侧 HiRISE 产品](https://www.usgs.gov/data/mars-sample-return-hirise-mosaics-terrain-relative-navigation)

## 数据覆盖与可用功能

覆盖以圆形边界内的 100 m 网格中心统计。检查了源 CTX 高程的有效像元和缺测值。在同一中心测得 25、30、35、40 km 都有完整 CTX 高程，45 km 降到约 98.88%。40 km 是当前打包并实测的范围。 [区域包与测量记录](../data/regional/jezero-40km/manifest.json)

| 图层 | 圆区覆盖 | 应用中的作用 |
| --- | ---: | --- |
| USGS/JPL CTX 20 m 数值高程 | 100% | 重投影并平均到 100 m，生成区域坡度，用于粗略走廊计算。 [产品目录](https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/CTX/index.html) |
| JPL Mars Trek CTX 光学瓦片 | 99.97% | 第 9 级的 25 张瓦片重投影到同一地图网格。空白保留为影像缺测。 [图层能力文件](https://trek.nasa.gov/tiles/Mars/EQ/Jezero_CTX_BlockAdj_dd/1.0.0/WMTSCapabilities.xml) |
| Mars Odyssey THEMIS 日间红外 | 100% | 区域相对红外亮度，图例用 DN。 [产品说明](https://stac.astrogeology.usgs.gov/docs/data/mars/themis_controlled_mosaics/) |
| USGS SIM 3464 地质单元 | 40.64% | 在原生火星坐标中获取要素、简化并重投影，保留地质图出版尺度和缺测边界。 [出版物](https://pubs.usgs.gov/publication/sim3464) · [图层服务](https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Jezero_FeatureServiceFromPro/FeatureServer/8) |
| 历史火星车位置 | 708 个归档点在圈内 | 从 NASA 航点 JSON 投影，图上标出行驶历史和 Sol。 [NASA 位置地图](https://science.nasa.gov/mission/mars-2020-perseverance/location-map/) |

区域图支持选择已知位置或输入火星东经与纬度，运行坡度限制下的 A*，显示粗略走廊、距离和 100 m 网格上的最大坡度。`25°` 是区域走廊筛选的演示阈值。对小于网格的岩块、松沙或沟槽，步行前需要在高精度数据中核验。计算走廊与火星车历史路线各有图例。

Hawksbill Gap 提供约 **520 × 520 m、2 m** 的步行任务计算。HiRISE 正射影像按其真实 CRS 和仿射变换重投影到 DTM 边界内的显示网格，二维、剖面和三维共用实际高程。采样地点的历史坐标和靠近露头的模拟观察航点仍以来源与距离说明。默认 80 min 预算和 8 min 预留下，双站最短路线约 583 m，坡度加权路线约 611 m。以 12° 作为暴露比较阈值，坡度加权路线上的陡坡段从约 172 m 降到约 55 m。将预算改为 55 min，推荐约 495 m 的 Hazeltop 单站，时间余量约 2.0 min。步速和停留属于模拟情景。 [Hawksbill Gap 研究包](jezero-research/README.md)

## 复现与扩展

四个 GeoTIFF 和清单合计约 3.4 MB，应用运行时从仓库中的文件读取。安装项目依赖后，从仓库根目录运行 `streamlit run app/streamlit_app.py`。选择 `Jezero region · 40 km`，可以切换地图图层、试算走廊，然后进入 `Hawksbill Gap research package`。

联网重建数据时运行 `python scripts/build_jezero_region.py --cache survey-cache`。命令下载一次约 90 MB 的 CTX 源高程，获取 25 张小瓦片、一块 THEMIS 切片及 USGS 地质要素。最终包裁到 40 km 并附产品 URL 和 SHA-256。可按局部数据的覆盖、配准误差、DTM 质量和科学证据选择下一块步行区，先核验 Neretva Vallis 或西缘 HiRISE 数据，再将合格的局部区接入区域图。 [USGS 西缘 HiRISE 数据发布](https://www.usgs.gov/data/mars-sample-return-hirise-mosaics-terrain-relative-navigation)
