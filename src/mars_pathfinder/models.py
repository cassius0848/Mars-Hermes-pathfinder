"""Shared models for local Martian EVA mission planning.

共享模型：所有官方数据适配器都应转换到这些结构，避免上层代码依赖
具体 NASA / USGS 文件格式。
"""

from dataclasses import dataclass, field
from typing import Optional

import numpy as np

Point = tuple[int, int]


@dataclass(frozen=True)
class TerrainGrid:
    """Normalized elevation grid; elevation values are meters.

    标准化高程网格；高程单位为米，NaN 表示缺失值。
    """

    elevation: np.ndarray
    cell_size_m: float = 1.0
    crs: Optional[str] = None
    source: str = "unknown"

    def __post_init__(self) -> None:
        elevation = np.asarray(self.elevation, dtype=float)
        if elevation.ndim != 2:
            raise ValueError("elevation must be a two-dimensional array")
        if self.cell_size_m <= 0:
            raise ValueError("cell_size_m must be positive")
        object.__setattr__(self, "elevation", elevation)

    @property
    def shape(self) -> tuple[int, int]:
        return self.elevation.shape


@dataclass(frozen=True)
class MapLayer:
    """A geospatial layer with provenance and an explicit data category.

    带有来源和类别的数据层；类别用于区分 optical、terrain、weather 等。
    """

    name: str
    # optical / thermal / spectral / terrain / radiation / weather / chemical
    category: str
    values: np.ndarray
    units: str
    source: str
    confidence: str = "unknown"
    timestamp: Optional[str] = None

    def __post_init__(self) -> None:
        values = np.asarray(self.values, dtype=float)
        if values.ndim != 2:
            raise ValueError("map layer values must be two-dimensional")
        object.__setattr__(self, "values", values)


@dataclass(frozen=True)
class ScienceTarget:
    """A science stop supported by an observation or dataset.

    由观测或数据集支持的科学停留点；source 必须能追溯到原始记录。
    """

    target_id: str
    name: str
    location: Point
    science_value: float
    rationale: str
    source: str
    stop_duration_min: float = 0.0
    position_uncertainty_m: float = 0.0

    def __post_init__(self) -> None:
        if self.stop_duration_min < 0 or self.position_uncertainty_m < 0:
            raise ValueError("stop duration and position uncertainty must be non-negative")


@dataclass(frozen=True)
class SurfaceImageEvidence:
    """A surface image with mission provenance for a waypoint or target.

    带任务溯源信息的表面图像，用于路线节点或科学目标证据展示。
    """

    image_id: str
    local_path: str
    url: str
    page_url: str
    mission: str
    instrument: str
    sol: int
    attribution: str
    image_size_px: tuple[int, int] | None = None
    role: str = ""


@dataclass(frozen=True)
class VectorLayer:
    """A vector map layer loaded from a GeoJSON feature collection.

    从 GeoJSON 要素集合加载的矢量图层，例如 USGS 地质单元。
    """

    name: str
    geometry_type: str
    features: list[dict]
    crs: str
    source: str


@dataclass(frozen=True)
class RouteReference:
    """A cited mission route asset used for context and design reference.

    有出处的历史任务路线素材，只用于背景和交互设计参考。
    """

    reference_id: str
    title: str
    local_path: str
    url: str
    asset_url: str
    mission: str
    description: str
    data_sources: list[str]
    attribution: str
    role: str


@dataclass(frozen=True)
class EVAState:
    """Current crew and suit-resource state for a surface excursion.

    当前宇航员与宇航服资源状态；这些约束用于返航和安全检查。
    """

    crew_size: int = 2
    remaining_time_h: float = 6.0
    life_support_fraction: float = 1.0
    battery_fraction: float = 1.0
    payload_kg: float = 20.0
    reserve_fraction: float = 0.25
    metabolic_rate_kj_h: float | None = None
    resource_budget_kj: float | None = None
    resource_source: str = "unconfigured"

    def __post_init__(self) -> None:
        if self.crew_size < 1 or self.remaining_time_h <= 0 or self.payload_kg < 0:
            raise ValueError("invalid EVA state")
        for value in (self.life_support_fraction, self.battery_fraction, self.reserve_fraction):
            if not 0 <= value <= 1:
                raise ValueError("resource fractions must be between 0 and 1")
        if (self.metabolic_rate_kj_h is None) != (self.resource_budget_kj is None):
            raise ValueError("metabolic rate and resource budget must be configured together")
        if self.metabolic_rate_kj_h is not None and self.metabolic_rate_kj_h <= 0:
            raise ValueError("metabolic_rate_kj_h must be positive")
        if self.resource_budget_kj is not None and self.resource_budget_kj <= 0:
            raise ValueError("resource_budget_kj must be positive")


@dataclass(frozen=True)
class MissionConstraints:
    """Safety and mobility limits used by the planner.

    规划器使用的安全与移动能力限制；硬约束不能由 AI 权重绕过。
    """

    max_slope_deg: float = 18.0
    max_weather_risk: float = 0.85
    max_radiation_risk: float = 0.85
    speed_m_per_h: float = 3000.0

    def __post_init__(self) -> None:
        if self.max_slope_deg <= 0 or self.speed_m_per_h <= 0:
            raise ValueError("mobility limits must be positive")
        if not 0 <= self.max_weather_risk <= 1 or not 0 <= self.max_radiation_risk <= 1:
            raise ValueError("risk limits must be between 0 and 1")
