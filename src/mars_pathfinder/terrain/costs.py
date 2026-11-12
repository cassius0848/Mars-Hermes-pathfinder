"""Mission cost surfaces for terrain, weather, radiation, and science value."""

import numpy as np


def build_eva_cost(
    slope: np.ndarray,
    *,
    weather_risk: np.ndarray | None = None,
    radiation_risk: np.ndarray | None = None,
    science_value: np.ndarray | None = None,
    max_slope_deg: float = 18.0,
    max_weather_risk: float = 0.85,
    max_radiation_risk: float = 0.85,
    terrain_weight: float = 1.0,
    weather_weight: float = 1.0,
    radiation_weight: float = 1.0,
    science_weight: float = 0.35,
) -> np.ndarray:
    """Build a positive cost grid and encode safety limits as infinity."""

    slope = np.asarray(slope, dtype=float)
    if max_slope_deg <= 0:
        raise ValueError("max_slope_deg must be positive")
    shape = slope.shape

    def layer_or_zero(layer: np.ndarray | None) -> np.ndarray:
        if layer is None:
            return np.zeros(shape, dtype=float)
        values = np.asarray(layer, dtype=float)
        if values.shape != shape:
            raise ValueError("all mission layers must share the same shape")
        return values

    weather = layer_or_zero(weather_risk)
    radiation = layer_or_zero(radiation_risk)
    science = np.clip(layer_or_zero(science_value), 0, None)
    base = terrain_weight * (1.0 + np.nan_to_num(slope, nan=np.inf) / max_slope_deg)
    cost = base * (1.0 + weather_weight * weather + radiation_weight * radiation)
    cost = cost - science_weight * science
    cost = np.maximum(cost, 0.1)
    blocked = (
        ~np.isfinite(slope)
        | (slope > max_slope_deg)
        | ~np.isfinite(weather)
        | (weather > max_weather_risk)
        | ~np.isfinite(radiation)
        | (radiation > max_radiation_risk)
    )
    return np.where(blocked, np.inf, cost)
