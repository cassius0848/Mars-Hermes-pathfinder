"""Closed-loop mission routing / 闭环任务路线规划。"""

from __future__ import annotations

from mars_pathfinder.models import Point
from mars_pathfinder.routing.search import shortest_path


def closed_loop_route(
    cost_grid,
    start: Point,
    stops: list[Point],
    *,
    use_astar: bool = True,
) -> tuple[list[Point], float, list[dict[str, object]]]:
    """Plan base → ordered stops → base and return segment evidence.

    规划基地→按给定顺序的科学站→基地，并返回每段路径证据。
    The caller controls stop order; no hidden reordering is performed.
    """

    if not stops:
        raise ValueError("at least one science stop is required")
    sequence = [start, *stops, start]
    full_path: list[Point] = []
    segments: list[dict[str, object]] = []
    total_cost = 0.0
    for index, (origin, destination) in enumerate(zip(sequence, sequence[1:]), start=1):
        segment, segment_cost = shortest_path(cost_grid, origin, destination, use_astar=use_astar)
        if full_path:
            full_path.extend(segment[1:])
        else:
            full_path.extend(segment)
        segments.append({
            "index": index,
            "start": origin,
            "goal": destination,
            "cost": segment_cost,
            "nodes": len(segment),
        })
        total_cost += segment_cost
    return full_path, total_cost, segments
