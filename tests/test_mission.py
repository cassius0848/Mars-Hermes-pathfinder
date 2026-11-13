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
