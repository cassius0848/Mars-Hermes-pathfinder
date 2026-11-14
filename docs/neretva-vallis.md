# Neretva Vallis 步行任务

第二个步行区以 **77.3030°E、18.4945°N** 为中心，采用火星本地方位等距投影，边长 **1,120 m**，面积约 **1.25 km²**。它约为 Hawksbill Gap 局部区面积的 4.6 倍。登陆区到 Neretva 的 100 m 网格走廊约 9.54 km。该走廊提供跨区地形筛查，局部路线从模拟基地单独计算。 [Jezero 区域数据](jezero-navigation-scope.md) · [数据清单](../data/local/neretva-vallis/manifest.json)

## 两个观察站

| 站点 | 任务 | 坐标依据 |
| --- | --- | --- |
| 北岸 Bright Angel · Cheyava Falls | 记录浅色硫酸盐脉和有深色边缘的斑点。对照毅力号 Sol 1212 的 WATSON 图像 | NASA Sol 1210 行驶结束定位 `56_0`，位于拍摄区附近 [NASA 照片](https://science.nasa.gov/resource/perseverance-finds-a-rock-with-leopard-spots/) · [行驶定位](https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json) |
| 南岸 Serpentine Rapids · Malgosa Crest | 观察磨蚀圆面上的红色基岩、浅色区和毫米级绿斑，比较两岸露头纹理。NASA 记载绿斑的成分待定 | NASA Sol 1243 WATSON 图像对应车体参考编号 `56_3438`，PDS 中对应定位记录为 Sol 1231 [NASA 照片](https://science.nasa.gov/blog/red-rocks-with-green-spots-at-serpentine-rapids/) · [PDS PLACES 定位表](https://pds-geosciences.wustl.edu/m2020/urn-nasa-pds-mars2020_rover_places/data_localizations/) |

应用用空心圈表示火星车参考位置，用实心点表示模拟停靠点。我从距参考位置 25 m 内选择最近的可达网格中心，要求该格坡度不超过 10°，并能在 18° 的规划阈值下从模拟基地抵达。最终两站分别偏移 3.91 m 和 0.43 m。偏移是地图上的两点距离，现场露头位置、可见性和绝对定位精度仍需独立核对。 [数据清单](../data/local/neretva-vallis/manifest.json)

## 数据如何进入地图

| 数据 | 应用用途 | 本地处理 |
| --- | --- | --- |
| MRO HiRISE 1 m 数字地形 | 提供步行网格、坡度、路线剖面和三维地形 | 按 HTTP 字节范围读取原始 TIFF 的相关行，重新投影并按 2 m 网格平均 [USGS HiRISE 数据](https://doi.org/10.5066/P9REJ9JN) |
| MRO HiRISE 正射影像 | 提供与路线叠加的二维底图 | 从 Mars Trek 取 64 张第 16 级瓦片，拼接后重投影到 1 m 显示网格 [Mars Trek 图层说明](https://trek.nasa.gov/tiles/Mars/EQ/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd/1.0.0/WMTSCapabilities.xml) |
| Mars Odyssey THEMIS | 提供 100 m 红外背景，显示相对红外强度 | 从区域图裁片，用最近邻保留 100 m 网格尺度 [THEMIS 数据目录](https://stac.astrogeology.usgs.gov/docs/data/mars/themis_controlled_mosaics/) |
| Mars 2020 Perseverance | 提供两张现场特写、观测日期和历史定位 | 每站离线保留一张官方图，配图与定位记录分别注明 Sol [北岸观测](https://science.nasa.gov/resource/perseverance-finds-a-rock-with-leopard-spots/) · [南岸观测](https://science.nasa.gov/blog/red-rocks-with-green-spots-at-serpentine-rapids/) |

约 2.45 MB 的离线包包含这三张栅格、两张科学照片和数据清单。各栅格的有效像元覆盖均为 100%，覆盖率按各自范围统计。THEMIS 的红外强度只用于查看地表背景，路线代价使用高程派生坡度。首次联网重建只取约 96.5 MB 高程字节和约 4.2 MB 的影像瓦片及照片。脚本核验 TIFF 文件头与每段 HTTP 响应，并在清单记录产品 URL 和本地 SHA-256。 [数据清单](../data/local/neretva-vallis/manifest.json) · [重建脚本](../scripts/build_neretva_site.py)

```bash
python scripts/build_neretva_site.py --cache survey-cache/neretva
streamlit run app/streamlit_app.py
```

日常演示直接运行第二条命令，从 Jezero 地图打开 `Open Neretva Vallis EVA planner`。重建使用仓库中的区域 THEMIS 栅格。

## 路线对比

下表使用 18° 坡度上限、100 分钟预算、8 分钟返航预留、15 m/min 模拟步速和每站 12 分钟。两条双站路线都按南岸、北岸、基地的顺序，距离按地图上的水平步行长度计算。

| 双站方案 | 路程 | 步行和观察耗时 | 坡度 ≥ 12° 的路段 | 预留以外的时间余量 |
| --- | ---: | ---: | ---: | ---: |
| 最短 | 839 m | 79.9 min | 43 m | 12.1 min |
| 坡度加权 | 845 m | 80.3 min | 25 m | 11.7 min |

把预算缩为 45 分钟后，推荐路线只访问南岸，往返约 337 m，耗时约 34.4 分钟，扣除预留后还剩约 2.6 分钟。关掉外部网络请求后，地图、两张 NASA 照片与路线重算仍可工作。当前任务用坡度和时间比较路线。脚下碎石、沙地承载力、实时天气、辐射和生命支持容量需要补齐，界面保留生命支持状态提示。

## 西缘数据核验

USGS 的西缘新版 `v003` 拼图以约 5.47 GB 的 ZIP 发布。实测可用 HTTP Range 读取 ZIP 目录、抽取高程和单波段质量图，合计传输约 741 MB。两个 TIFF 解压后的文件长度和 CRC-32 都与 ZIP 目录一致。本次核验用新版的高程与质量图，旧版 Mars 2020 TRN 产品提供 Neretva 应用数据。 [USGS 西缘发布](https://doi.org/10.5066/P13CPYYU) · [官方 ZIP](https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSR_TRN_HiRISE_soc_003_USGS_release_aug2024/MSR_TRN_HiRISE_soc_003_USGS_release_aug2024_mosaics.zip)

下表以 1,120 × 1,120 m、2 m 网格核验三个候选区。高程使用均值重投影，质量代码用最近邻，各列以核验区的全部像元为分母。代码 10–14 表示立体匹配成功，15 表示人工插值。

| 核验区中心 | 新版高程覆盖 | 代码 10–14 | 代码 15 |
| --- | ---: | ---: | ---: |
| Neretva Vallis · 77.30300°E, 18.49450°N | 24.12% | 23.15% | 0.24% |
| Lookout Hill · 77.26853°E, 18.45753°N | 100% | 46.72% | 50.95% |
| 西行 Sol 2022 · 77.23322°E, 18.43559°N | 100% | 91.26% | 1.03% |

新版与 Neretva 的两条双站路线均无高程重叠。2020 年产品覆盖完整，但 USGS 提醒其最西侧 Crater Rim 立体影像存在剩余视差。当前路线应视作可复算的演示，局部坡度质量仍待独立核验。Lookout Hill 和 Sol 2022 可从区域图选取，米级路线仍需对齐影像、核对科学证据并检查路径是否经过低质量像元。 [USGS 2020 地形说明](https://astrogeology.usgs.gov/search/map/mars_2020_terrain_relative_navigation_hirise_dtm_mosaic) · [NASA Lookout Hill 照片](https://science.nasa.gov/photojournal/perseverances-view-from-lookout-hill/)
