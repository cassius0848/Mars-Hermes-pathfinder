"""Check local coverage and exercise two walking costs on the measured DEM."""

import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image
from rasterio.transform import from_origin, rowcol, xy
from rasterio.warp import Resampling, reproject
import rasterio
from pyproj import Transformer
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra

from crop_sources import GEOGRAPHIC, LOCAL, ROOT


def projected_grid(filename, spacing, fill, method):
    side = int(520 / spacing)
    transform = from_origin(-260, 260, spacing, spacing)
    result = np.full((side, side), fill, dtype=np.float32)
    with rasterio.open(ROOT / "derived" / filename) as source:
        reproject(rasterio.band(source, 1), result, dst_transform=transform,
                  dst_crs=LOCAL, dst_nodata=fill, resampling=method)
    return result, transform


def graph_for(slope, elevation, weighted):
    rows, cols = slope.shape
    index = np.arange(rows * cols).reshape(rows, cols)
    valid = np.isfinite(slope) & (slope <= 18)
    edges = []
    for dr, dc in [(0, 1), (1, 0), (1, 1), (1, -1)]:
        src = (slice(0, rows-dr), slice(max(-dc, 0), min(cols-dc, cols)))
        dst = (slice(dr, rows), slice(max(dc, 0), min(cols+dc, cols)))
        can_walk = valid[src] & valid[dst]
        if dr and dc:
            can_walk &= valid[src[0], dst[1]] & valid[dst[0], src[1]]
        distance = 2 * np.hypot(dr, dc)
        grade = np.degrees(np.arctan(np.abs(elevation[dst] - elevation[src]) / distance))
        can_walk &= grade <= 18
        weight = 1 + 4 * (np.maximum(slope[src], slope[dst]) / 18) ** 2 if weighted else np.ones_like(grade)
        edges.append((index[src][can_walk], index[dst][can_walk], distance * weight[can_walk]))
    start, end, cost = (np.concatenate(part) for part in zip(*edges))
    return coo_matrix((cost, (start, end)), shape=(index.size, index.size)).tocsr()


def plan(graph, nodes, elevation, slope):
    segments = []
    for start, goal in zip(nodes, nodes[1:]):
        source = np.ravel_multi_index(start, slope.shape)
        target = np.ravel_multi_index(goal, slope.shape)
        costs, prev = dijkstra(graph, directed=False, indices=source, return_predecessors=True)
        if not np.isfinite(costs[target]):
            raise ValueError(f"Unreachable {start} → {goal}")
        segment = [target]
        while segment[-1] != source:
            segment.append(int(prev[segment[-1]]))
        segments.append(np.column_stack(np.unravel_index(segment[::-1], slope.shape)))
    path = np.concatenate([segments[0], *(part[1:] for part in segments[1:])])
    elevations = elevation[tuple(path.T)]
    return path, {
        "distance_m": round(float(np.linalg.norm(np.diff(path, axis=0), axis=1).sum() * 2), 2),
        "max_cell_slope_deg": round(float(slope[tuple(path.T)].max()), 2),
        "ascent_m": round(float(np.maximum(np.diff(elevations), 0).sum()), 2),
        "segments_m": [round(float(np.linalg.norm(np.diff(s, axis=0), axis=1).sum() * 2), 2) for s in segments],
    }


def main():
    forward = Transformer.from_crs(GEOGRAPHIC, LOCAL, always_xy=True)
    inverse = Transformer.from_crs(LOCAL, GEOGRAPHIC, always_xy=True)
    evidence = {"Swift Run": (77.40617078, 18.458931), "Hazeltop": (77.40588851, 18.45863707)}
    exact = {name: forward.transform(*coords) for name, coords in evidence.items()}
    elevation, transform = projected_grid("jezero-dtm-native.tif", 2, np.nan, Resampling.average)
    ortho, _ = projected_grid("jezero-ortho-native.tif", 0.5, np.nan, Resampling.average)
    print("Local terrain and optical grids reprojected", flush=True)
    dy, dx = np.gradient(elevation, 2)
    slope = np.degrees(np.arctan(np.hypot(dx, dy)))
    rows, cols = np.indices(slope.shape)
    xx = -259 + 2 * cols
    yy = 259 - 2 * rows
    graph = graph_for(slope, elevation, False)
    from scipy.sparse.csgraph import connected_components
    _, groups = connected_components(graph, directed=False)
    groups = groups.reshape(slope.shape)
    biggest = np.argmax(np.bincount(groups.ravel()))
    possible = (groups == biggest) & (slope <= 12)
    stops = []
    candidates = [(-165, -90), (exact["Swift Run"][0]+14, exact["Swift Run"][1]),
                  (exact["Hazeltop"][0]-14, exact["Hazeltop"][1])]
    for candidate in candidates:
        distance = (xx-candidate[0])**2 + (yy-candidate[1])**2
        stops.append(np.unravel_index(np.argmin(np.where(possible, distance, np.inf)), slope.shape))
    assert len(set(stops)) == 3
    assert all(np.hypot(*np.subtract(xy(transform, *stop), site)) <= 30
               for stop, site in zip(stops[1:], exact.values()))
    nodes = [*stops, stops[0]]
    gentle_graph = graph_for(slope, elevation, True)
    routes = {"Shortest constrained": plan(graph, nodes, elevation, slope),
              "Slope-penalized": plan(gentle_graph, nodes, elevation, slope)}
    single_stop = {name: plan(graph, [stops[0], stop, stops[0]], elevation, slope)[1]
                   for name, stop in zip(evidence, stops[1:])}
    print("Both terrain-constrained round trips solved", flush=True)
    coords = [xy(transform, *stop) for stop in stops]
    budget = {"available_min": 55, "speed_m_per_min": 15, "stops_min": [12, 12], "reserve_min": 8}
    for _, metrics in routes.values():
        metrics["planned_minutes"] = round(metrics["distance_m"] / 15 + 24, 2)
        metrics["margin_after_reserve_minutes"] = round(55 - 8 - metrics["planned_minutes"], 2)
        metrics["margin_at_80_min_after_reserve_minutes"] = round(80 - 8 - metrics["planned_minutes"], 2)
    for metrics in single_stop.values():
        metrics["planned_minutes"] = round(metrics["distance_m"] / 15 + 12, 2)
        metrics["margin_after_reserve_minutes"] = round(55 - 8 - metrics["planned_minutes"], 2)
    summary = {"planning_grid": [260, 260], "grid_spacing_m": 2,
               "valid_fraction": float(np.isfinite(elevation).mean()),
               "elevation_range_m": [float(np.nanmin(elevation)), float(np.nanmax(elevation))],
               "simulated_constraints": {"max_slope_deg": 18, **budget},
               "evidence_lonlat": evidence,
               "modeled_waypoints_lonlat": dict(zip(["base", "A", "B"], [inverse.transform(*p) for p in coords])),
               "evidence_pixel_dtm_m": {name: float(elevation[rowcol(transform, *point)]) for name, point in exact.items()},
               "observation_stop_offset_m": dict(zip(evidence, [round(float(np.hypot(*np.subtract(point, stop))), 2) for point, stop in zip(exact.values(), coords[1:])])),
               "routes": {name: metrics for name, (_, metrics) in routes.items()},
               "single_stop_shortest": single_stop}
    (ROOT / "derived" / "validation.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    features = []
    for name, (path, metrics) in routes.items():
        xs, ys = xy(transform, path[:, 0], path[:, 1])
        lons, lats = inverse.transform(xs, ys)
        features.append({"type": "Feature", "properties": {"name": name, **metrics},
                         "geometry": {"type": "LineString", "coordinates": list(zip(lons, lats))}})
    (ROOT / "derived" / "jezero-route-preview.json").write_text(json.dumps({
        "type": "FeatureCollection", "coordinate_reference": "Mars planetocentric lon/lat, east positive, IAU sphere",
        "purpose": "terrain-only analysis with modeled stops and limits", "features": features,
    }, indent=2), encoding="utf-8")
    from rasterio.crs import CRS
    for name, raster in [("elevation", elevation), ("slope", slope)]:
        with rasterio.open(ROOT / "derived" / f"jezero-{name}-local-2m.tif", "w",
                           driver="GTiff", width=raster.shape[1], height=raster.shape[0], count=1,
                           dtype="float32", crs=CRS.from_string(LOCAL), transform=transform,
                           nodata=np.nan, compress="deflate") as dst:
            dst.write(raster.astype(np.float32), 1)
    fig, axes = plt.subplots(1, 2, figsize=(13.0, 7.1), facecolor="#111923", layout="constrained")
    fig.suptitle("Jezero · Hawksbill Gap | measured terrain, simulated EVA", color="white", fontsize=19)
    colors = ["#44ded5", "#f1b261"]
    extent = (-260, 260, -260, 260)
    axes[0].imshow(ortho, extent=extent, cmap="gray", origin="upper", vmin=np.nanpercentile(ortho, 5), vmax=np.nanpercentile(ortho, 96))
    im = axes[1].imshow(slope, extent=extent, cmap="magma", origin="upper", vmin=0, vmax=30)
    axes[1].contour(xx, yy, slope, levels=[18], colors=["white"], linewidths=0.3, alpha=.65)
    cb = fig.colorbar(im, ax=axes[1], shrink=.72, label="Terrain slope (°)")
    cb.ax.yaxis.label.set_color("white")
    cb.ax.tick_params(colors="white")
    for axis, title in zip(axes, ["MRO HiRISE orthophoto", "HiRISE-derived slope"]):
        axis.set(title=title, xlabel="Local east (m)", ylabel="Local north (m)")
        axis.title.set_color("white")
        axis.xaxis.label.set_color("white")
        axis.yaxis.label.set_color("white")
        axis.tick_params(colors="#ccd5dc")
        axis.set_facecolor("#111923")
        for j, (name, (path, _)) in enumerate(routes.items()):
            axis.plot(-259 + 2*path[:,1], 259 - 2*path[:,0], color=colors[j],
                      ls="-" if j == 0 else "--", lw=2.2, label=name)
        axis.scatter(*np.array(coords).T, marker="o", c="white", edgecolors="#111923", zorder=7, label="Modeled stops")
        axis.scatter(*np.array(list(exact.values())).T, marker="x", c="#f8da71", zorder=8, label="PDS sample locations")
        for name, point, offset in zip(["Base", "A", "B"], coords, [(7, -12), (12, 8), (-22, -17)]):
            axis.annotate(name, point, xytext=offset, textcoords="offset points", color="white", fontsize=10, weight="bold")
        axis.set_xlim(-260,260)
        axis.set_ylim(-260,260)
    axes[0].legend(loc="upper left", fontsize=8, framealpha=.93)
    fig.supxlabel("NASA/JPL-Caltech/UArizona HiRISE · USGS Astrogeology ARD · NASA PDS | Terrain-only feasibility check", color="#ccd5dc", fontsize=10)
    fig.savefig(ROOT / "derived" / "jezero-terrain-route-preview.png", dpi=150)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
