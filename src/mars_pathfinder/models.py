"""Shared models for local Martian EVA mission planning."""

from dataclasses import dataclass, field
from typing import Optional

import numpy as np

Point = tuple[int, int]


@dataclass(frozen=True)
class TerrainGrid:
    """Normalized elevation grid; elevation values are meters."""

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
    """A geospatial layer with provenance and an explicit data category."""

    name: str
    category: str  # optical, thermal, spectral, terrain, radiation, weather, chemical
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
    """A science stop supported by an observation or dataset."""

    target_id: str
    name: str
    location: Point
    science_value: float
    rationale: str
    source: str


@dataclass(frozen=True)
class SurfaceImageEvidence:
    """A surface image with mission provenance for a waypoint or target."""

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
class EVAState:
    """Current crew and suit-resource state for a surface excursion."""

    crew_size: int = 2
    remaining_time_h: float = 6.0
    life_support_fraction: float = 1.0
    battery_fraction: float = 1.0
    payload_kg: float = 20.0
    reserve_fraction: float = 0.25

    def __post_init__(self) -> None:
        if self.crew_size < 1 or self.remaining_time_h <= 0 or self.payload_kg < 0:
            raise ValueError("invalid EVA state")
        for value in (self.life_support_fraction, self.battery_fraction, self.reserve_fraction):
            if not 0 <= value <= 1:
                raise ValueError("resource fractions must be between 0 and 1")


@dataclass(frozen=True)
class MissionConstraints:
    """Safety and mobility limits used by the planner."""

    max_slope_deg: float = 18.0
    max_weather_risk: float = 0.85
    max_radiation_risk: float = 0.85
    speed_m_per_h: float = 3000.0

    def __post_init__(self) -> None:
        if self.max_slope_deg <= 0 or self.speed_m_per_h <= 0:
            raise ValueError("mobility limits must be positive")
        if not 0 <= self.max_weather_risk <= 1 or not 0 <= self.max_radiation_risk <= 1:
            raise ValueError("risk limits must be between 0 and 1")
