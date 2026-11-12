# Mars Pathfinder AI

> **火星宇航员局部 EVA 任务规划工具**
>
> **A local EVA mission-planning tool for Martian astronauts**

## 中文版

### 项目定位

Mars Pathfinder AI 是 OrionX 面向 NASA Space Apps Challenge 2026 开发的研究与演示型原型。项目服务于火星表面宇航员探测任务：在一个有限的局部区域中，叠加多种 NASA 数据，帮助任务团队规划科学目标、选择安全路线并准备返航方案。

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

Python 3.11+、NumPy、SciPy、Pandas、Rasterio、PyProj、NetworkX、Streamlit、Plotly、Pytest。AI API 为可选依赖。

```bash
pip install -r requirements.txt
PYTHONPATH=src pytest
streamlit run app/streamlit_app.py
```

当前界面使用明确标记的合成任务数据。官方资源发布后，优先增加数据适配器，将数据转换为上述模型，再调整风险层、科学目标和可视化，不需要重写路径搜索核心。

### MVP 与开发路线

1. 接入三类以上真实数据并完成来源登记；
2. 建立一个有限的局部研究区域和明确科学目标；
3. 显示地形、光学 / 科学图层和危险区域；
4. 计算满足 EVA 资源约束的目标路线；
5. 展示科学停留点、现场证据、路线指标和返航检查；
6. 增加时间、天气、辐射和机器人支援模式；
7. 最后接入 AI 任务解析与路线解释。

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

The current UI uses clearly labeled synthetic mission data. When official resources arrive, add adapters that return the shared models, then adjust hazard layers, science targets, and visualizations without rewriting the search core.

### MVP and Roadmap

1. Integrate and document at least three real data types;
2. Select a bounded local study area and a clear science objective;
3. Display terrain, optical / science layers, and hazards;
4. Compute a route that satisfies EVA resource constraints;
5. Show science stops, evidence, route metrics, and return checks;
6. Add time, weather, radiation, and robot-support modes;
7. Add AI task parsing and route explanations last.

### Collaboration Rules

- Integrate modules through stable data models and function interfaces;
- Distinguish observed, derived, predicted, and synthetic data;
- Record source, version, coverage, resolution, CRS, units, and limitations;
- Do not commit large raw datasets, secrets, or personal credentials;
- Use branches such as `data`, `terrain`, `routing`, `analysis`, `ui`, `ai`, and `tests-docs`.
