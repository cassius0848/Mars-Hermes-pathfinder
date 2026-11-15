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

在线图层依赖上游服务。图集可直接选起终点规划并三维回放。自动选用 Hawksbill Gap 或 Neretva Vallis 的 1 米 HiRISE 高程，并在覆盖外使用 Jezero 20 米 CTX 或约 1 公里 MOLA。MOLA 模式用于粗略走廊筛选。 [步行规划核验](web-navigation-audit.md)

## 三维回放

默认画面以路线为中心，结合数值高程着色、配准光学影像和低角度显示侧光。可切换到光学样式、开启跟随并手动设置垂直倍率。高程、坡度、距离及搜索约束均取原始地形网格。显示灯光服务于坡面阅读，路线光照由太阳几何与地形遮挡另行计算。

## 区域多参数规划

`/atlas?area=jezero` 默认进入区域多参数模式。可以点选地图上任意有高程覆盖的两个点，也可以试算 Jezero 从着陆区到 Neretva Vallis 的约 9.5 km 路线。自动高程优先使用 1 米 HiRISE 或 20 米在线 CTX，Jezero 还可使用经验证的 100 米缓存。Jezero 以外可按在线 MOLA 支持的单段距离与纬度范围筛选约 1 公里尺度的走廊。

| 因素 | 数据和代价 |
| --- | --- |
| 坡度与时间 | 使用原始 DEM。原有坡度约束适用于每一步以及对角通行。行进时间继续作为底价。 |
| 阴影 | 由 DEM 和固定太阳几何估算地形遮挡。阴影采样随网格尺寸调整。 |
| 太阳辐照潜势 | 在 1 AU 的 NASA SORCE 总太阳辐照度约 1361 W/m² 基础上按日火距离平方反比缩放，再投影到 DEM 坡面与地形阴影。数值是大气层顶入射量投影，供路线比较。 |
| 地表温度 | OpenMARS MY24 的同一气候快照，5°网格重采样到查询位置。对超过所选比较值的温度差按行进时间加权。 |
| 气压 | 同一 OpenMARS 快照的地表气压 Pa。对低于所选比较值的差额按时间加权。 |
| TES 热惯量 | Putzig 和 Mellon 2007 的 MGS TES 夜侧热惯量，单位 J m⁻² K⁻¹ s⁻½。Jezero、Gale、Endeavour 与 Eberswalde 四区保留 PDS 原始 0.05°网格，其他区域使用该格网的 0.25°中心抽样。缺测保留，PDS 官方插值掩膜随样本一起保存。偏好权重越高，低于 500 的热惯量样本相对代价越高。 |

固定环境快照用于比较，多小时路线的日照比例和辐照潜势都按快照计算。温度与气压是再分析结果，近邻路线的数值可能接近。太阳辐照潜势未纳入大气衰减，电离辐射需要另有数据。覆盖不足的加权字段会在数据栏标出并跳过。两条计算路线重合时，页面会明确显示这一点。

候选路线卡可按实际网格对比用时、最大坡度和环境读数。选择热惯量、气压、温度、阴影或坡度可对当前路线分段着色。热惯量卡同时显示沿线采用 PDS 官方插值样本的比例。划分色阶时采用最小色域，避免把极小的变化渲染成强梯度。

三维控制区有滑杆、数字输入及真实比例按钮，可以 0.1 为步长设置 1.0–6.0 倍垂直显示。图集默认 1.5 倍。缓存区域裁切时复用原始影像窗口坐标，按裁切位置显示配准影像。

`web/atlas-regional.json` 列出两个 OpenMARS 原时间索引、源产品链接、原始数据 SHA-256 与打包偏移。二进制包保留快照的原始 float32 数值和 PDS 像元整数。可用 `scripts/build_atlas_environment.py` 复现提取。原始 PDS 文件及标签在数据目录，Zarr 元数据与分块位置可从清单复核。

[NASA PDS TES 归档](https://pds-geosciences.wustl.edu/missions/mgs/tes-timap.html) · [开放大学 OpenMARS](https://doi.org/10.21954/ou.rd.7352270) · [ARCO 数据转换](https://doi.org/10.57967/hf/8741) · [NASA Mars24 算法](https://www.giss.nasa.gov/tools/mars24/help/algorithm.html) · [NASA 总太阳辐照度](https://sunclimate.gsfc.nasa.gov/article/solar-irradiance)

## Hawksbill Gap 原位历史观测

在图集展开“官方观测与多参数权重”，选择 Hawksbill Gap 的 Sol 518 场景和各项权重。两个场景来自毅力号 NASA PDS MEDA，取四个数据产品在同一 SCLK 的记录。`web/atlas-meda.json` 记录 CSV、标签、文件哈希和时钟。 [PDS MEDA 数据说明](https://pdsatmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html) · [MEDA 仪器与各滤波通道](https://ntrs.nasa.gov/api/citations/20210014064/downloads/Rodriguez-Manfredi_et_al-2021-Space_Science_Reviews.pdf)

| 参与规划的参数 | 官方字段和使用方式 |
| --- | --- |
| 光照 | ANCILLARY 的西向方位角与天顶角由 NAIF SPICE 计算。应用换算为东向方位角，在实测 DEM 上估算固定时刻的地形遮挡。 |
| 热学 | TIRS 派生的上行地表长波辐照量（W/m²）。以该原位观测值乘路线时长作为积分参考。所选记录中地表视场没有车体阴影，车轮遮挡状态为空。 |
| 辐射 | RDS TOP 3 校准观测（250–400 nm，W/m²）乘估算的直射光时长，形成日照段相对 UV 指标。阴影中的散射紫外、电离辐射、装备和人体剂量需独立数据。 |
| 大气 | PS 派生气压（Pa）。以用户设定的比较值减观测气压，取正值后对路线时长积分。 |

A* 每一步以原有行进时间为底，加上用户权重乘坡度、阴影、热红外、日照段 UV 与低压差的归一化代价。参考尺度分别是坡度限值、100% 阴影、250 W/m²、0.02 W/m² 与 20 Pa，用于组合代价的量纲归一。地表长波与气压按同一观测点的参考值累计，相同用时的两条路线在这两项上得分一致。光照与紫外项会随路线经过的地形阴影变化，路线用时与坡度可同时参与比较。高程缺测、坡度上限与封路仍是硬约束。

这些数据是历史快照，观测时刻的环境参数在本次计算中固定。应用仅在同一 Hawksbill Gap 米级验证区启用此场景。区域外可选择原有地形模式。

源代码 `web/atlas.html`、`web/atlas.js` 和 `web/mars-data.js` 随 `python scripts/build_web.py` 一并导出。离线包用于运行任务场景，在线地图需要连接数据服务。 [USGS 20 米 CTX](https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic) · [USGS SIM 3464](https://doi.org/10.3133/sim3464) · [USGS HiRISE 目录](https://stac.astrogeology.usgs.gov/docs/data/mars/hirise_dtms/)
