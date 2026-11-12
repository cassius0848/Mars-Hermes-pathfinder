"""Grid-based Dijkstra and A* search."""

from heapq import heappop, heappush
from math import hypot
from typing import Callable

import numpy as np

Point = tuple[int, int]
Heuristic = Callable[[Point, Point], float]


def _neighbors(point: Point, shape: tuple[int, int]):
    row, col = point
    for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)):
        nr, nc = row + dr, col + dc
        if 0 <= nr < shape[0] and 0 <= nc < shape[1]:
            yield (nr, nc), hypot(dr, dc)


def shortest_path(cost_grid: np.ndarray, start: Point, goal: Point, *, use_astar: bool = True) -> tuple[list[Point], float]:
    """Find a least-cost path on a positive grid.

    The A* heuristic is scaled by the minimum finite cell cost so it remains
    admissible for mission cost surfaces whose cells may cost less than 1.
    """

    costs = np.asarray(cost_grid, dtype=float)
    if costs.ndim != 2:
        raise ValueError("cost_grid must be two-dimensional")
    finite_costs = costs[np.isfinite(costs)]
    if finite_costs.size == 0 or np.any(finite_costs <= 0):
        raise ValueError("cost_grid must contain positive finite costs")
    for point in (start, goal):
        if not (0 <= point[0] < costs.shape[0] and 0 <= point[1] < costs.shape[1]):
            raise ValueError(f"point outside grid: {point}")
        if not np.isfinite(costs[point]):
            raise ValueError(f"point is impassable: {point}")

    minimum_cost = float(np.min(finite_costs))
    heuristic: Heuristic = lambda a, b: hypot(a[0] - b[0], a[1] - b[1]) * minimum_cost
    frontier: list[tuple[float, float, Point]] = [(0.0, 0.0, start)]
    distances = {start: 0.0}
    previous: dict[Point, Point] = {}

    while frontier:
        _, distance, current = heappop(frontier)
        if distance != distances.get(current):
            continue
        if current == goal:
            break
        for neighbor, step_distance in _neighbors(current, costs.shape):
            if not np.isfinite(costs[neighbor]):
                continue
            step_cost = step_distance * (costs[current] + costs[neighbor]) / 2.0
            candidate = distance + step_cost
            if candidate < distances.get(neighbor, np.inf):
                distances[neighbor] = candidate
                previous[neighbor] = current
                estimate = heuristic(neighbor, goal) if use_astar else 0.0
                heappush(frontier, (candidate + estimate, candidate, neighbor))

    if goal not in distances:
        raise ValueError("no traversable route exists between start and goal")

    path = [goal]
    while path[-1] != start:
        path.append(previous[path[-1]])
    path.reverse()
    return path, distances[goal]
