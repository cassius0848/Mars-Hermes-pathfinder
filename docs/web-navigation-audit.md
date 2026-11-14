# Jezero 网页导航的功能与数据自查

网页版和本地 Streamlit 共用仓库的科学数据包。网页在浏览器运行路线计算和回放，选点查询官方资料时访问 NASA 或 USGS。地图默认打开 Hawksbill Gap。右上角可切换到 Neretva Vallis 或 Jezero 区域图。 [官方任务要求](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/?tab=details) · [官方资源页](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/?tab=resources)

| 自查项 | 进入方式与实测结果 |
| --- | --- |
| 地图选取起点、终点 | 点击出发地或目的地，再点击地图。也可用方向键移动焦点、回车选点。支持单程、闭环与已录入的双科学站示例。起终点落在缺测或超坡度网格时会提示改选。 |
| 多目标走法 | 在两块 2 m 步行区内，按时间、坡度和光照比较。计算同时计入沿线爬坡降速、地形坡度上限、科学停留时间和返航预留。坡度上限与步速的模型参数属于模拟。 |
| 途中重算与三维 | 点击开始导航进入按官方 HiRISE 高程与配准正射构建的三维地形。可切换跟随、俯瞰、二维。回放时间轴、高程剖面与队员坐标同步。报告前方封路或请求返航会从当前位置重算，显示原路线剩余时间与新路线预计时间。 |
| 官方站点联动 | 目的地选点可发起 Mars Trek 瓦片、USGS SIM 3464 地质和 NASA 毅力号航点查询。响应提供瓦片、相交地质单元和最近航点。浏览器跨域策略阻断航点请求时显示同一官方数据的 Sol 2022 归档，并标明回退。 |
| 轻量偏好 | 点击记住此类路线会在此浏览器本地保存偏好。下次在满足同一预算和坡度限制的候选中优先推荐这类路线，设置可清除。 |
| 分享任务卡 | 选中路线后点击导出任务卡，下载可直接打开和打印的 HTML，内含出发地、途经站、模拟条件、路线图与高程剖面。 |

## 数据的覆盖和使用方式

| 产品 | 范围及实际用途 |
| --- | --- |
| MRO CTX 和 HiRISE 地形 | 40 km 圆区内 100 m 网格的有效高程为 100%。两块步行区的 2 m 高程、坡度栅格都无缺测。Hawksbill 的归档坡度与按 2 m 高程复算的坡度最大相差约 0.000006°。网格间距描述采样尺度，实际地形精度仍受立体匹配和配准影响。 [区域清单](../data/regional/jezero-40km/manifest.json) · [Hawksbill 来源](jezero-research/资源清单.md) · [Neretva 数据](neretva-vallis.md) |
| MRO 光学和毅力号照片 | 区域影像来自 Mars Trek CTX，有效覆盖 99.967%。局部 3D 用与二维显示共用的正射影像贴图和高程网格。Hawksbill 用同一个立体产品的配套正射。实测 Mars Trek 图层局部相对偏移约 31–33 m，在线返回瓦片用于资料对照。两张 Neretva 现场图重新获取后与归档 SHA-256 一致。 [Mars Trek API](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars) · [北岸照片](https://science.nasa.gov/resource/perseverance-finds-a-rock-with-leopard-spots/) · [南岸照片](https://science.nasa.gov/blog/red-rocks-with-green-spots-at-serpentine-rapids/) |
| Mars Odyssey THEMIS 与 USGS 地质 | 100 m 红外在三个审查范围内有有效覆盖，提供历史相对红外强度。SIM 3464 在 40 km 圆区内标注 40.64%，Hawksbill 附有局部地质图。网站按选点查询 ArcGIS 服务并区分没有返回地质单元的情况。 [THEMIS 目录](https://stac.astrogeology.usgs.gov/docs/data/mars/themis_controlled_mosaics/) · [USGS SIM 3464](https://doi.org/10.3133/sim3464) |
| Mars 2020 航点与 MEDA | 核对 708 条归档航点并保留来源。Hawksbill 显示 Sol 518 归档的气温和气压小样平均值，分别作为历史点位和历史时间段背景。 [NASA 航点](https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json) · [MEDA 档案](https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html) |
| 其余竞赛资源 | Curiosity Mount Sharp 用于呈现科学路线的参考。Worldview 的数据是地球遥感，其图层切换用于界面参考。两者在网站资源区保留官方入口。 [Curiosity 路线](https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/) · [Worldview](https://worldview.earthdata.nasa.gov/) |

导出脚本验证三份地图的源档哈希，用实际高程核对坡度，并把正射与高程放在同一投影下。另从 USGS 源产品对 Hawksbill 的高程、正射和 THEMIS 裁片分别抽查 9 个像元，原始数值全部一致。NASA 航点坐标用于位置参考，模拟停靠点与岩石的绝对位置存在未核实的误差。Neretva 的新版西缘高程没有覆盖两条预设路线，继续使用 2020 地形产品，地面小障碍和局部坡度精度仍需进一步核验。 [配准记录](jezero-research/技术审阅方案.md) · [西缘覆盖核验](neretva-vallis.md)

## 路线与三维如何复核

在 Hawksbill Gap 选 17:15、春分、100 分钟模拟预算和 8 分钟预留。时间优先方案约 583 m、69.7 分钟，模型阴影约 175 m。光照优先方案约 639 m、74.6 分钟，模型阴影约 18 m。坡度优先方案约 633 m，坡度达到 12° 的路段约 44 m。A* 搜索使用坡度上限、逐步高差、缺测和封锁区作为硬约束。步速随沿线坡度调整。太阳高度与方位按火星当地真太阳时和太阳黄经计算，在 8 m 地形采样上估计规划时刻的阴影。途中重算更新时间，范围外地形、尘埃和实时照度待补齐。 [NASA GISS Mars24 光照算法](https://www.giss.nasa.gov/tools/mars24/help/algorithm.html)

在 Neretva Vallis 调到 50 分钟预算，双站无法在扣除预留后完成，可推荐南岸往返。45 分钟时当前模拟步速模型下任何站往返均超预算。早期 Streamlit 入口使用固定步速，所以同一预算的旧结果不同。

导航后由浏览器当场把官方立体高程构成三角网，用二维正射铺成贴图。同一地图坐标驱动路线、剖面和队员位置。三维显示采用简化网格，二维规划使用原 2 m 网格。相机播放由用户操作，没有调用生成式 AI。真实地面近景三维与实时定位需要新增立体相机和实际观测，以及独立的配准验证。实时天气、辐射、生命支持容量、松软地表和脚下障碍不在当前计算里。自主学习阶段还需要实际步行或类比试验的带标签记录。

## 复现

从仓库根目录运行以下命令。首次构建仅需下载约 0.74 MB 的 Three.js 0.181.2 文件，到本地缓存并核对哈希。科学数据直接读取仓库。 [Three.js 许可](https://github.com/mrdoob/three.js/blob/r181/LICENSE) · [已构建的离线包](../releases/README.md)

```text
python -m pip install -r requirements.txt
python scripts/build_web.py
node --test tests/web_planner.test.mjs
python -m http.server 8000 --directory dist
```

浏览器访问 `http://localhost:8000/`。本地服务器可以在断开外网后提供所有图层、寻路和三维回放。需要在线查询时再连接网络。更新官方数据先运行各自重建脚本核对来源和文件后，再执行网页导出。 [托管预览入口](https://mars-pathfinder-jezero.fengboyuan030509.chatgpt.site)
