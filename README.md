# Mars Pathfinder AI

> **火星宇航员局部 EVA 任务规划工具**
>
> **A local EVA mission-planning tool for Martian astronauts**

**队友入口**：[在线演示](https://mars-pathfinder-jezero.fengboyuan030509.chatgpt.site/) · [离线网页 ZIP](releases/mars-pathfinder-jezero-offline.zip) · [使用说明与校验](releases/README.md)

## 中文版

### 项目定位

Mars Pathfinder AI 是 Hermesx 面向 NASA Space Apps Challenge 2026 开发的研究与演示型原型。项目服务于火星表面宇航员探测任务：在一个有限的局部区域中，叠加多种 NASA 数据，帮助任务团队规划科学目标、选择安全路线并准备返航方案。

项目不是飞行级导航或安全系统。真实数据必须记录来源、版本、空间分辨率、坐标系、单位、时间和限制；合成数据只用于算法和界面测试，并明确标记为 `synthetic`。

### 任务场景

默认研究区域为 Jezero Crater，但系统支持替换为其他区域。演示任务可以描述为：

> 两名宇航员从基地出发，在局部地质区域调查科学目标，在满足坡度、环境风险、EVA 时长和生命支持余量的条件下完成探测并安全返航。

规划对象以双人宇航员 EVA 为主；漫游车或机器人运输作为后续协同模式，而不是系统唯一用户。

### 核心能力

- 为一个明确的科学目标选择局部探测区域；
- 叠加至少三类数据，例如地形、光学、光谱 / 热学、天气或辐射；
- 计算坡度、障碍、天气风险和辐射风险；
- 根据宇航员 EVA 时间、生命支持、电池、负载和返航储备规划路线；
- 使用 A* / Dijkstra 比较最短、最低风险、最低资源消耗和高科研价值路线；
- 标出科学停留点、危险区域、路线距离、预计时间和返航状态；
- 显示沿路线的图像或数据证据，让宇航员了解目标点的环境；
- 在新的环境或资源状态到达后重新规划。

### 数据融合思路

```text
地形数据       → 能不能走？
光学影像       → 到达后可能看到什么？
光谱 / 热学数据 → 为什么值得去？
天气 / 辐射数据 → 什么时候更安全？
科学观测记录   → 目标的证据和科研价值是什么？
```

第一版建议至少使用三类有明确来源的数据：

1. **地形**：DEM、坡度和障碍物；
2. **光学**：HiRISE、CTX 或任务表面图像；
3. **光谱或热学**：CRISM、THEMIS 或其他适用数据；
4. 可选加入天气、大气、辐射或化学数据。

### 系统架构

```text
任务定义层
├── 科学目标与研究区域
├── 起点、科学停留点和返航点
├── EVA 时间、人员、负载和资源储备
└── 最大坡度与环境安全阈值

数据接入层
├── TerrainGrid：高程 DEM
├── MapLayer：光学、热学、光谱、天气、辐射等栅格
└── ScienceTarget：目标位置、科研价值和证据来源

分析层
├── 坡度与可通行性
├── 天气 / 辐射风险
├── 障碍和数据缺失
└── 路线不确定性与数据可信度

规划层
├── A* / Dijkstra
├── 多目标代价函数
├── EVA 资源与硬约束
└── 返航 / 应急路线

展示层
├── 局部高分辨率地图
├── 路线与科学目标
├── 表面图像和证据预览
├── 高程 / 坡度剖面
└── EVA 任务报告
```

路径段的综合代价可以表示为：

```text
总成本 = 距离成本 + 地形风险 + 天气风险 + 辐射风险
       + 资源消耗 - 科研价值收益
```

以下条件属于硬约束，不能被 AI 或普通权重抵消：

- 最大坡度和不可通行区域；
- 天气、辐射等环境风险阈值；
- EVA 总时长；
- 生命支持、电池和返航资源储备；
- 数据缺失或置信度不足的区域（按任务策略处理）。

### AI 与自学习策略

AI 是任务助手，不是未经验证的导航器：

1. 用户用自然语言描述科学目标和任务偏好；
2. DeepSeek 等模型通过 `AIProvider` 转换为结构化参数；
3. 程序校验硬约束和数据范围；
4. A* / Dijkstra 计算候选路线；
5. AI 解释路线差异、风险和证据来源。

初期不训练完整 Agent。真实火星任务数据不足，强化学习也容易受到模拟与现实差异影响。后续可用遥测校准能源和风险模型，但硬约束、路线检查和模型版本必须由程序控制。

### 官方资源入口

项目已将本次发布的资源入口登记在 [`data/source_catalog.json`](data/source_catalog.json)，并在界面侧栏提供链接。它们的作用不同：

- [NASA Mars Trek](https://trek.nasa.gov/mars/)：局部区域、坐标和行星图层发现；
- NASA Mars Trek MOLA ImageServer：已接入 Jezero 附近 256×256 高程样本，并保存了团队提供的 Mars Trek 书签区域作为可选研究区；
- NASA Mars Trek Viking MDIM21：已接入 Jezero 512×512 真实光学镶嵌图；
- Perseverance Sol 1934 SHERLOC_WATSON 图像：已保存为路线节点的表面证据样本；
- [USGS Astrogeology Mars Maps](https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars)：已接入 Jezero 地质单元 GeoJSON，作为科学目标背景；
- [Perseverance Raw Images](https://mars.nasa.gov/mars2020/multimedia/raw-images/)：科学目标和路线节点的表面图像证据；
- [Curiosity Mount Sharp Route](https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/)：已保存 NASA 路线动画，作为多任务数据叠加和路线叙事参考。

详细接入顺序、数据边界和元数据要求见 [`docs/data-sources.md`](docs/data-sources.md)。

### 代码结构

```text
mars-pathfinder-ai/
├── app/streamlit_app.py       # 局部 EVA 规划界面
├── src/mars_pathfinder/
│   ├── models.py              # TerrainGrid、MapLayer、EVAState 等
│   ├── data/                  # 官方数据加载、校验、元数据
│   ├── terrain/               # 坡度、可通行性、任务代价面
│   ├── routing/               # A*、Dijkstra、路线搜索
│   ├── analysis/              # EVA 评估、资源和科研指标
│   ├── ai/                    # 预留：模型适配、任务解析、解释
│   └── visualization/         # 预留：地图、剖面和图像证据
├── tests/                     # 地形、路线和 EVA 约束测试
├── data/raw/                  # 原始数据，不提交大型文件
├── data/processed/            # 对齐后的局部数据
└── docs/architecture.md
```

当前代码已经提供 `TerrainGrid`、`MapLayer`、`ScienceTarget`、`EVAState`、`MissionConstraints`、合成任务 fixture、GeoTIFF DEM 加载接口、EVA 代价面、A* / Dijkstra 和任务评估接口。

### 技术栈与运行

中文版浏览器导航支持地图选点、路线对比、三维回放、封路绕行和在线查询 NASA / USGS。可从已核验的 GeoTIFF 导出静态网页，在本机或托管站点运行。[网页操作、数据自查与复现](docs/web-navigation-audit.md)

Python 3.11+、NumPy、SciPy、Pandas、Rasterio、PyProj、NetworkX、Streamlit、Plotly、Pytest。AI API 为可选依赖。

```bash
pip install -r requirements.txt
PYTHONPATH=src pytest
streamlit run app/streamlit_app.py
```

启动后默认进入 Jezero 40 km 区域地图。可切换 CTX 光学影像、高程、坡度、THEMIS 红外和 USGS 地质，查看毅力号历史路线，或在 100 m 网格上试算区域走廊。区域图可打开 Hawksbill Gap 和 Neretva Vallis 两个 2 m 步行规划器，均支持离线二维地图、高程剖面和三维地形。团队的 MOLA 样本和 Mars Trek 书签可通过研究区选择器访问。 [首版导航范围与数据来源](docs/jezero-navigation-scope.md)

### Hawksbill Gap 研究包

队友的 `docs/jezero-research/` 归档已经接入 Streamlit 的研究包模式。选择 `Hawksbill Gap research package` 后，应用读取真实的 2 m HiRISE DTM、派生坡度、配套正射图、THEMIS 区域热红外、USGS SIM 3464 局部地质和 Perseverance/PDS 科学证据点。归档路线只用于对照，实时路线仍由当前 A* 规划器重新计算。MEDA 作为时间序列证据显示，不会被复制成虚假的空间天气栅格。

### Neretva Vallis 两岸任务

从 Streamlit 区域图点击「打开 Neretva Vallis EVA 规划器」。在 1.12 × 1.12 km 的 HiRISE 地图上，可以比较北岸 Cheyava Falls 和南岸 Malgosa Crest 的岩石纹理。默认预算为 100 分钟，包含 8 分钟返航预留和每站 12 分钟观察。把预算改为 45 分钟，可以看到推荐路线改成南岸单站。 [数据切片、来源与实测路线](docs/neretva-vallis.md)

### MVP 实机演示脚本

推荐用一次 3–5 分钟的 Hawksbill Gap 任务完成演示：

1. 在 `Jezero region · 40 km` 试算从毅力号登陆区到 Hawksbill Gap 的粗略走廊，然后打开约 520×520 米的局部 EVA 规划器；
2. 展示 HiRISE DTM、正射图、USGS 地质、THEMIS 热红外和 Perseverance 图像证据；
3. 选择 Swift Run 与 Hazeltop，显示两名宇航员的科学任务；
4. 比较同一站序的最短和坡度加权路线，查看总距离、陡坡段距离、科学停留和返航余量；
5. 在配准的正射图和同源三维地形中查看路线，结合高程剖面判断坡段；
6. 将模拟预算从 80 分钟改为 55 分钟，查看推荐路线从双站往返调整为 Hazeltop 单站；
7. 明确说明天气、辐射和生命支持容量尚未配置，因此系统不会宣称飞行级安全。

演示叙事对应官方挑战的四个问题：**为什么去**（USGS 地质与 Perseverance 证据）、**怎么走**（HiRISE DTM 与 A*）、**途中看到什么**（正射和表面图像）、**能否返回**（闭环路线、停留时间和资源状态）。

### MVP 与开发路线

1. 接入三类以上真实数据并完成来源登记；
2. 建立一个有限的局部研究区域和明确科学目标；
3. 显示地形、光学 / 科学图层和危险区域；
4. 计算满足 EVA 资源约束的目标路线；
5. 展示科学停留点、现场证据、路线指标和返航检查；
6. 增加时间、天气、辐射和机器人支援模式；
7. 最后接入 AI 任务解析与路线解释。

### 真实数据优先

主规划链必须由已登记的 NASA / USGS 数据驱动。当前已经真实接入 MOLA 高程、Viking MDIM21 光学图、USGS SIM 3464 地质单元、Perseverance 图像和 Curiosity 路线动画。天气和辐射尚未选定官方产品时使用中性无数据代价，不生成或伪装成观测值。

合成数据只允许用于单元测试和界面 fallback，必须带有 `synthetic-demo` 标记，不能混入未来 AI 训练集。完整规则见 [`docs/data-policy.md`](docs/data-policy.md)。

当前真实路线权重为：MOLA 地形 `1.0`、USGS 科学目标 `0.5`；天气和辐射在没有官方产品时均为 `0.0`。
路线规划现在按闭环执行：基地 → 按任务顺序的科学目标 → 基地，EVA 时间和返航储备覆盖完整往返。
科学停留时间现在计入 EVA 总预算；NASA EVA 资源参考见 [`docs/eva-resource-sources.md`](docs/eva-resource-sources.md)。
未配置有来源的代谢率和资源容量时，系统会显示 `resource model unconfigured`，不会宣称生命支持安全。

### 验证与 CI

项目包含 GitHub Actions 测试工作流。每次推送或 Pull Request 会安装固定依赖并运行完整 `pytest` 套件；研究包测试会验证真实 DTM、USGS 目标、闭环路线和配准不确定性。

### 协作原则

- 模块通过稳定的数据模型和函数接口协作；
- 区分观测、派生、预测和合成数据；
- 记录数据来源、版本、覆盖范围、分辨率、坐标系、单位和限制；
- 不提交大型原始数据、密钥或个人凭据；
- 可按 `data`、`terrain`、`routing`、`analysis`、`ui`、`ai`、`tests-docs` 使用独立分支。

---

## English Version

### Positioning

Mars Pathfinder AI is a research and demonstration prototype by OrionX for NASA Space Apps Challenge 2026. It is designed for **local astronaut EVA mission planning on Mars**: combining multiple NASA data layers to select science targets, plan a safe route, and prepare a return or contingency plan.

This is not a flight-qualified navigation or safety system. Every real dataset must record its source, version, spatial resolution, CRS, units, time, and limitations. Synthetic data is for algorithm and UI testing only and must be labeled `synthetic`.

### Mission Scenario

The default study region is Jezero Crater, but the system is designed for any selected local region. A representative mission is:

> Two astronauts leave a base, investigate a science target, and return safely while respecting slope, environmental risk, EVA duration, life-support margin, and battery constraints.

The primary user is a two-person astronaut EVA team. Rover or robot logistics can be added as a support mode rather than defining the entire system.

### Core Capabilities

- Define a science objective and a bounded local study area;
- Fuse at least three data types, such as terrain, optical, spectral / thermal, weather, or radiation;
- Compute slope, obstacles, weather risk, and radiation risk;
- Plan around EVA time, life support, battery, payload, and return reserves;
- Compare shortest, lowest-risk, lowest-resource, and highest-science-value routes with A* / Dijkstra;
- Show science stops, hazards, distance, estimated time, and return status;
- Provide image or data evidence along the route;
- Replan when environmental or crew-resource state changes.

### Data Fusion

```text
Terrain          → Can the crew traverse it?
Optical imagery  → What may the crew see there?
Spectral / thermal → Why is the site scientifically valuable?
Weather / radiation → When is it safer to visit?
Science records  → What evidence supports the target?
```

The initial real-data plan should include at least:

1. **Terrain**: DEM, slope, and obstacles;
2. **Optical**: HiRISE, CTX, or mission surface imagery;
3. **Spectral or thermal**: CRISM, THEMIS, or an appropriate official source;
4. Optional weather, atmospheric, radiation, or chemical layers.

### Architecture

```text
Mission definition
  → data ingestion and provenance
  → terrain and hazard analysis
  → multi-objective EVA cost surface
  → A* / Dijkstra route planning
  → EVA resource and safety evaluation
  → local map, evidence, profiles, and mission report
```

The route cost may be modeled as:

```text
Total cost = distance + terrain risk + weather risk + radiation risk
           + resource use - science value
```

Hard constraints include maximum slope, impassable terrain, environmental thresholds, EVA duration, life-support and battery reserves, and a defined policy for missing or low-confidence data.

### AI and Learning Strategy

AI is a mission assistant, not an unchecked navigation authority:

1. The user describes a science objective and mission preference;
2. DeepSeek or another model converts it through `AIProvider`;
3. The program validates ranges and hard constraints;
4. A* / Dijkstra computes candidate routes;
5. The model explains route differences, risks, and evidence.

Do not train a full Agent initially. Real Martian mission data is limited, and simulation-to-reality gaps are significant. Later, telemetry can calibrate energy and risk models, while constraints, route validation, and model versions remain program-controlled.

### Official Resource Entry Points

The released resource links are cataloged in [`data/source_catalog.json`](data/source_catalog.json) and shown in the Streamlit sidebar. They have different roles:

- [NASA Mars Trek](https://trek.nasa.gov/mars/) for local-area, coordinate, and planetary-layer discovery;
- NASA Mars Trek MOLA ImageServer, integrated as a bounded 256×256 Jezero sample plus the supplied bookmarked view as an optional study area;
- NASA Mars Trek Viking MDIM21, integrated as a real 512×512 Jezero optical mosaic;
- A Perseverance Sol 1934 SHERLOC_WATSON image, stored as surface evidence for route waypoints;
- [USGS Astrogeology Mars Maps](https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars) with the Jezero geologic-unit GeoJSON used for science context;
- [Perseverance Raw Images](https://mars.nasa.gov/mars2020/multimedia/raw-images/) for surface-view evidence at targets and waypoints;
- [Curiosity Mount Sharp Route](https://science.nasa.gov/resource/curiositys-proposed-path-up-mount-sharp/) as a downloaded NASA route animation and cited multi-mission reference.

See [`docs/data-sources.md`](docs/data-sources.md) for adapter order, provenance, and metadata requirements.

### Code Structure

```text
mars-pathfinder-ai/
├── app/streamlit_app.py       # local EVA planning UI
├── src/mars_pathfinder/
│   ├── models.py              # terrain, layers, targets, EVA state
│   ├── data/                  # official-data loaders and metadata
│   ├── terrain/               # slope, traversability, cost surfaces
│   ├── routing/               # A*, Dijkstra, route search
│   ├── analysis/              # EVA, resource, and science metrics
│   ├── ai/                    # reserved provider and explanation layer
│   └── visualization/         # reserved map, profile, and evidence views
├── tests/
├── data/raw/                  # raw data; do not commit large files
├── data/processed/
└── docs/architecture.md
```

The current scaffold provides `TerrainGrid`, `MapLayer`, `ScienceTarget`, `EVAState`, `MissionConstraints`, a synthetic mission fixture, a GeoTIFF DEM loader, an EVA cost surface, A* / Dijkstra, and EVA evaluation.

### Technology and Run Commands

Python 3.11+, NumPy, SciPy, Pandas, Rasterio, PyProj, NetworkX, Streamlit, Plotly, and Pytest. AI APIs are optional.

```bash
pip install -r requirements.txt
PYTHONPATH=src pytest
streamlit run app/streamlit_app.py
```

The app opens the 40 km Jezero map. Switch among CTX imagery and elevation, terrain slope, THEMIS infrared imagery, and USGS geology. Screen corridors on a 100 m grid, then open the Hawksbill Gap or Neretva Vallis EVA planner for 2 m route planning, georeferenced imagery, a route profile, and 3D terrain. The study-area selector also includes the earlier MOLA samples. [Navigation scope and data sources](docs/jezero-navigation-scope.md) · [Neretva Vallis walkthrough](docs/neretva-vallis.md)

### MVP Live Demo Script

Use a 3–5 minute Hawksbill Gap mission: select the research package, show the real HiRISE, USGS, THEMIS, and Perseverance layers, compare forward/reverse/single-stop closed-loop routes, inspect the optical evidence, adjust EVA time or reserve, and state clearly that spatial weather, radiation, and life-support capacity are not configured. The story answers **why go**, **how to walk**, **what will be seen**, and **whether the crew can return**.

### MVP and Roadmap

1. Integrate and document at least three real data types;
2. Select a bounded local study area and a clear science objective;
3. Display terrain, optical / science layers, and hazards;
4. Compute a route that satisfies EVA resource constraints;
5. Show science stops, evidence, route metrics, and return checks;
6. Add time, weather, radiation, and robot-support modes;
7. Add AI task parsing and route explanations last.

### Real-data policy

The primary planner must be driven by documented NASA / USGS products. Real MOLA elevation, Viking MDIM21 optical imagery, USGS SIM 3464 geology, a Perseverance image, and the Curiosity route reference are already integrated. Weather and radiation use neutral no-data costs until official products are selected; the system never invents observations.

Synthetic data is limited to unit tests and UI fallback, must carry the `synthetic-demo` label, and must not enter a future AI training set. See [`docs/data-policy.md`](docs/data-policy.md).

Current real-route weights are explicit: MOLA terrain `1.0`, USGS science target `0.5`, and weather/radiation `0.0` until official products are selected.
Route planning is closed-loop: base → ordered science targets → base, with EVA time and return reserve evaluated over the full loop.

### Validation and CI

GitHub Actions installs the declared dependencies and runs the full `pytest` suite on pushes and pull requests. Research-package tests cover the real DTM, USGS targets, closed-loop routes, and alignment uncertainty.

### Collaboration Rules

- Integrate modules through stable data models and function interfaces;
- Distinguish observed, derived, predicted, and synthetic data;
- Record source, version, coverage, resolution, CRS, units, and limitations;
- Do not commit large raw datasets, secrets, or personal credentials;
- Use branches such as `data`, `terrain`, `routing`, `analysis`, `ui`, `ai`, and `tests-docs`.
