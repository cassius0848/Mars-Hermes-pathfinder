# Mars Pathfinder AI

> **火星智能探测与路线规划系统**
>
> **An intelligent Martian exploration and route-planning prototype**

## 中文版

### 项目简介

Mars Pathfinder AI 是 OrionX 面向 NASA Space Apps Challenge 2026 开发的研究与演示型原型，主要研究区域为 Jezero Crater（耶泽罗陨击坑）。系统综合火星地形、天气与环境、漫游车能源状态以及科学兴趣点，生成并比较候选探测路线。

本项目用于展示可解释、可验证的任务规划方法，不是飞行级导航系统。真实数据必须记录来源、分辨率、坐标系、单位和限制；合成数据只用于测试，并明确标记为 synthetic。

### 核心思路

项目采用：

```text
确定性规划引擎 + 多目标优化 + AI 任务助手 + 受控学习
```

每个路径段的综合代价可表示为：

```text
总成本 = 距离成本 + 地形风险成本 + 天气风险成本
       + 能源消耗成本 - 科研价值收益
```

能源安全、最大坡度、极端天气、不可通行区域和通信条件属于硬约束。系统可以输出最短、最省能源、最安全、科研价值最高和综合平衡等候选路线，而不是只返回一个无法解释的结果。

### 系统架构

```text
数据层：DEM、轨道影像、天气、漫游车状态、科学兴趣点
    ↓
数据接入与验证：格式、坐标系、单位、范围、缺失值
    ↓
地形与风险分析：坡度、可通行性、天气风险、能源消耗、科研价值
    ↓
路线规划：A*、Dijkstra、多目标代价函数、硬约束检查
    ↓
路线评估：距离、能源、坡度、风险、科研目标和高程剖面
    ↓
Streamlit + Plotly：地图、路线对比和任务报告
```

真实数据和合成数据使用同一套接口。官方数据发布前，可以用标记清晰的合成 DEM 验证算法；接入真实数据时只替换数据适配层。

### AI 与自学习方案

- **MVP 阶段**：规划器不依赖 AI，使用规则、代价函数、A* 和 Dijkstra 完成可验证路线规划。
- **AI 助手阶段**：通过 `AIProvider` 接入 DeepSeek 或其他模型，将自然语言任务转换为经过校验的参数，并解释路线差异。
- **受控学习阶段**：根据历史遥测校准能源和风险模型，保存模型版本；硬约束和最终路线检查始终由确定性程序负责。

AI 负责理解和解释，规划器负责计算，约束系统负责安全，学习模块负责校准。

### 推荐目录

```text
mars-pathfinder-ai/
├── app/streamlit_app.py
├── src/mars_pathfinder/
│   ├── data/          # 加载、验证、元数据
│   ├── terrain/       # 坡度、障碍、可通行性
│   ├── routing/       # A*、Dijkstra、代价函数
│   ├── analysis/      # 路线指标、比较、能源模型
│   ├── ai/            # 模型适配、任务解析、解释
│   └── visualization/ # 地图和高程剖面
├── tests/
├── data/raw/          # 原始数据，不提交大型文件
├── data/processed/
└── docs/
```

### 技术栈

Python 3.11+、NumPy、SciPy、Pandas、Rasterio、PyProj、NetworkX（或自定义搜索）、Streamlit、Plotly、Pytest；DeepSeek 等模型 API 为可选依赖。

初期避免复杂 Agent 框架，确保系统轻量、可测试，并能在普通笔记本上运行。

### MVP

1. 加载真实 Mars DEM；官方数据未发布前使用标记清晰的合成数据；
2. 显示高程和坡度；
3. 选择起点与目标点；
4. 计算最短路线和坡度感知路线；
5. 比较距离、坡度、风险和能源指标；
6. 展示路线和高程剖面；
7. 为数据处理和路径规划提供可重复测试。

### 开发路线

1. 项目基础：目录、依赖、数据模型、测试和元数据规范；
2. 地形处理：DEM 校验、裁剪、坡度和可通行性；
3. 路线引擎：A*、Dijkstra、代价函数和硬约束；
4. 交互界面：地图、起终点选择、路线比较和剖面；
5. 多源数据：天气、能源状态和科学兴趣点；
6. AI 助手：任务解析、路线解释和报告；
7. 验证展示：真实数据验证、异常测试和演示流程。

### 数据与协作规范

- 不提交大型原始数据、密钥或个人凭据；
- 区分观测、派生、预测和合成数据；
- 记录数据来源、版本、空间范围、分辨率、坐标系、单位和限制；
- 模块通过稳定的数据模型和函数接口协作；
- 可按 `data`、`terrain`、`routing`、`analysis`、`ui`、`ai`、`tests-docs` 使用独立分支。

---

## English Version

### Overview

Mars Pathfinder AI is a research and demonstration prototype by OrionX for NASA Space Apps Challenge 2026. Its primary study area is Jezero Crater. The system combines Martian terrain, weather and environmental conditions, rover energy state, and scientific points of interest to generate and compare exploration routes.

This project demonstrates explainable and testable mission planning; it is not a flight-qualified navigation system. Every real dataset must document its source, resolution, CRS, units, and limitations. Synthetic data is for testing only and must be labeled as synthetic.

### Core Approach

The system combines:

```text
Deterministic planning + multi-objective optimization
+ an AI mission assistant + controlled learning
```

A route-segment cost can be modeled as:

```text
Total cost = distance + terrain risk + weather risk
           + energy consumption - scientific value
```

Energy reserves, maximum slope, severe weather, impassable terrain, and communication requirements are hard constraints. The system may return shortest, lowest-energy, safest, highest-science-value, and balanced candidate routes with explicit metrics.

### Architecture

```text
Data: DEM, orbital imagery, weather, rover state, science targets
  → ingestion and validation
  → terrain and risk analysis
  → A* / Dijkstra / multi-objective routing
  → route metrics and mission analysis
  → Streamlit + Plotly visualization
```

Real and synthetic data share the same interfaces. Before official datasets are released, clearly labeled synthetic DEMs can validate the algorithms; real-data integration should replace the adapter layer rather than redesign the planner.

### AI and Learning Strategy

- **MVP:** a fully usable planner based on rules, cost functions, A*, and Dijkstra without an AI dependency.
- **AI assistant:** an `AIProvider` interface can connect DeepSeek or another model to parse mission requests, validate parameters, compare routes, and explain results.
- **Controlled learning:** telemetry can calibrate energy and risk models while preserving model versions. Hard constraints and final route checks remain deterministic.

AI interprets and explains; the planner computes; the constraint layer protects safety; the learning layer calibrates models.

### Suggested Structure

```text
mars-pathfinder-ai/
├── app/streamlit_app.py
├── src/mars_pathfinder/
│   ├── data/          # loading, validation, metadata
│   ├── terrain/       # slope, obstacles, traversability
│   ├── routing/       # A*, Dijkstra, cost functions
│   ├── analysis/      # metrics, comparison, energy models
│   ├── ai/            # provider, task parsing, explanations
│   └── visualization/ # maps and elevation profiles
├── tests/
├── data/raw/          # raw data; do not commit large files
├── data/processed/
└── docs/
```

### Technology Stack

Python 3.11+, NumPy, SciPy, Pandas, Rasterio, PyProj, NetworkX (or custom search), Streamlit, Plotly, and Pytest. DeepSeek or another model API is optional.

Avoid complex Agent frameworks in the initial implementation so the system remains lightweight, testable, and laptop-friendly.

### MVP Scope

1. Load a real Mars DEM, or clearly labeled synthetic data before official data is available;
2. Display elevation and slope maps;
3. Select start and destination points;
4. Compute shortest and slope-aware routes;
5. Compare distance, slope, risk, and energy metrics;
6. Display routes and elevation profiles;
7. Provide reproducible tests for terrain and routing.

### Roadmap

1. Foundation: structure, dependencies, data models, tests, and metadata;
2. Terrain processing: DEM validation, cropping, slope, and traversability;
3. Routing engine: A*, Dijkstra, costs, and hard constraints;
4. UI: maps, point selection, route comparison, and profiles;
5. Multi-source data: weather, energy state, and science targets;
6. AI assistant: task parsing, explanations, and reports;
7. Validation and demo: real-data checks, edge cases, and presentation flow.

### Data and Collaboration Rules

- Do not commit large raw datasets, secrets, or personal credentials;
- Distinguish observed, derived, predicted, and synthetic data;
- Record source, version, coverage, resolution, CRS, units, and limitations;
- Integrate modules through stable data models and function interfaces;
- Use separate branches such as `data`, `terrain`, `routing`, `analysis`, `ui`, `ai`, and `tests-docs`.

### Project Positioning

Mars Pathfinder AI is a scientific-computing, route-planning, and interactive mission-analysis prototype. It explores how heterogeneous Martian data can support explainable mission recommendations and must not be treated as a real flight or safety system.
