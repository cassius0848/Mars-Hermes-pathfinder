"""Routing algorithm checks / 路线算法检查。"""

import numpy as np

from mars_pathfinder.routing.search import shortest_path
from mars_pathfinder.terrain.derivatives import slope_degrees
from mars_pathfinder.terrain.traversability import slope_cost
from mars_pathfinder.data.loaders import load_synthetic_terrain


def test_dijkstra_and_astar_reach_goal():
    costs = np.ones((8, 8), dtype=float)
    dijkstra_path, dijkstra_cost = shortest_path(costs, (0, 0), (7, 7), use_astar=False)
    astar_path, astar_cost = shortest_path(costs, (0, 0), (7, 7), use_astar=True)
    assert dijkstra_path[0] == astar_path[0] == (0, 0)
    assert dijkstra_path[-1] == astar_path[-1] == (7, 7)
    assert np.isclose(dijkstra_cost, astar_cost)


def test_impassable_cells_are_avoided():
    # The only crossing is the explicit opening at (2, 2).
    # 只有显式设置的 (2, 2) 缺口可以穿过障碍带。
    costs = np.ones((5, 5), dtype=float)
    costs[2, :] = np.inf
    costs[2, 2] = 1.0
    path, _ = shortest_path(costs, (0, 0), (4, 4))
    assert (2, 2) in path


def test_synthetic_terrain_has_valid_slope_costs():
    terrain = load_synthetic_terrain((12, 12))
    slope = slope_degrees(terrain)
    cost = slope_cost(slope)
    assert slope.shape == terrain.shape
    assert cost.shape == terrain.shape
    assert np.isfinite(cost).any()


def test_closed_loop_returns_to_base():
    from mars_pathfinder.routing.mission import closed_loop_route

    costs = np.ones((8, 8), dtype=float)
    path, total, segments = closed_loop_route(costs, (0, 0), [(7, 7)])
    assert path[0] == path[-1] == (0, 0)
    assert len(segments) == 2
    assert total > 0


def test_diagonal_corner_cutting_is_blocked():
    """A diagonal cannot pass between two orthogonal obstacles."""

    costs = np.ones((3, 3), dtype=float)
    costs[0, 1] = np.inf
    costs[1, 0] = np.inf
    try:
        shortest_path(costs, (0, 0), (1, 1))
    except ValueError as error:
        assert "no traversable route" in str(error)
    else:
        raise AssertionError("diagonal corner cutting was not blocked")


def test_obstacle_mask_forces_a_detour():
    """External obstacle masks must block cells and preserve a detour."""

    from mars_pathfinder.terrain.costs import build_eva_cost

    slope = np.zeros((5, 5), dtype=float)
    obstacles = np.zeros((5, 5), dtype=bool)
    obstacles[2, 1:4] = True
    costs = build_eva_cost(slope, obstacle_mask=obstacles, max_slope_deg=18)
    path, _ = shortest_path(costs, (2, 0), (2, 4))
    assert all(not obstacles[point] for point in path)


def test_blocked_endpoint_is_rejected():
    from mars_pathfinder.terrain.costs import build_eva_cost

    obstacles = np.zeros((3, 3), dtype=bool)
    obstacles[1, 1] = True
    costs = build_eva_cost(np.zeros((3, 3)), obstacle_mask=obstacles)
    try:
        shortest_path(costs, (0, 0), (1, 1))
    except ValueError as error:
        assert "impassable" in str(error)
    else:
        raise AssertionError("blocked endpoint was accepted")
