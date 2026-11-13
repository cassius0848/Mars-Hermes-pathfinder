"""EVA mission evaluation checks / EVA 任务评估检查。"""

import numpy as np

from mars_pathfinder.analysis.mission import evaluate_eva_route
from mars_pathfinder.data.loaders import load_synthetic_mission
from mars_pathfinder.models import EVAState, MissionConstraints
from mars_pathfinder.routing.search import shortest_path
from mars_pathfinder.terrain.costs import build_eva_cost
from mars_pathfinder.terrain.derivatives import slope_degrees


def test_eva_route_reports_target_and_resource_status():
    terrain, layers, targets = load_synthetic_mission((20, 20))
    slope = slope_degrees(terrain)
    science = np.zeros(terrain.shape)
    science[targets[0].location] = targets[0].science_value
    costs = build_eva_cost(
        slope,
        weather_risk=layers["weather_demo"].values,
        radiation_risk=layers["radiation_demo"].values,
        science_value=science,
        max_slope_deg=45,
    )
    path, _ = shortest_path(costs, (1, 1), targets[0].location)
    report = evaluate_eva_route(path, terrain, slope, EVAState(), MissionConstraints(max_slope_deg=45), targets)
    assert targets[0].target_id in report["target_ids"]
    assert report["distance_m"] > 0
    assert isinstance(report["safety_ok"], bool)
    assert report["science_stop_time_h"] == 0.0
    assert report["resource_status"] == "unconfigured"
    assert report["safety_ok"] is False


def test_science_stop_time_is_included_in_eva_budget():
    from mars_pathfinder.models import ScienceTarget, TerrainGrid

    terrain = TerrainGrid(np.zeros((3, 3)), cell_size_m=1.0)
    slope = np.zeros((3, 3))
    target = ScienceTarget("target", "target", (1, 1), 1.0, "test", "test", stop_duration_min=30)
    report = evaluate_eva_route([(0, 0), (1, 1), (0, 0)], terrain, slope, EVAState(remaining_time_h=1), MissionConstraints(speed_m_per_h=3600), [target])
    assert report["walk_time_h"] > 0
    assert report["science_stop_time_h"] == 0.5
    assert report["estimated_time_h"] == report["walk_time_h"] + 0.5


def test_configured_resource_model_is_checked_with_units():
    from mars_pathfinder.models import ScienceTarget, TerrainGrid

    terrain = TerrainGrid(np.zeros((3, 3)), cell_size_m=1.0)
    slope = np.zeros((3, 3))
    eva = EVAState(remaining_time_h=1, metabolic_rate_kj_h=1000, resource_budget_kj=5000, resource_source="NASA reference scenario")
    report = evaluate_eva_route([(0, 0), (1, 1), (0, 0)], terrain, slope, eva, MissionConstraints(speed_m_per_h=3600), [])
    assert report["resource_status"] == "configured"
    assert report["resource_used_kj"] is not None
    assert report["resource_available_kj"] == 3750
