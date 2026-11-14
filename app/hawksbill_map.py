"""Display EVA routes on georeferenced local Mars grids."""

import base64
from io import BytesIO
from math import ceil

import numpy as np
import plotly.graph_objects as go
from PIL import Image
from rasterio.transform import xy

from mars_pathfinder.data.jezero_region import grid_axes


def _waypoint_label(package, target):
    return target.name.split(" · ", 1)[0] if package.observation_references else target.name


def _local_points(package, points):
    rows, cols = zip(*points)
    return xy(package.transform, rows, cols)


def route_layers(package, layer):
    x, y = grid_axes(package.transform, package.terrain.shape)
    if layer == "HiRISE local orthophoto":
        picture = Image.fromarray(package.optical_rgb)
        stream = BytesIO()
        picture.save(stream, format="JPEG", quality=90)
        step = package.terrain.cell_size_m * package.terrain.shape[0] / picture.height
        left, top = package.transform.c, package.transform.f
        return go.Image(
            source="data:image/jpeg;base64," + base64.b64encode(stream.getvalue()).decode("ascii"),
            x0=left + step / 2, y0=top - step / 2, dx=step, dy=-step, hoverinfo="skip",
        )

    if layer == "THEMIS thermal context":
        x, y = grid_axes(package.thermal_transform, package.thermal.shape)
        return go.Heatmap(x=x, y=y, z=package.thermal, colorscale="Inferno",
                          colorbar={"title": "THEMIS DN"}, zsmooth=False, hoverongaps=False)

    values = package.slope if layer == "Slope" else package.terrain.elevation
    color_title = "坡度（°）" if layer == "Slope" else "高程（米）"
    return go.Heatmap(x=x, y=y, z=values, colorscale="Cividis", colorbar={"title": color_title}, hoverongaps=False)


def render_map(package, layer, path, stops):
    figure = go.Figure(route_layers(package, layer))
    if path:
        x, y = _local_points(package, path)
        figure.add_trace(go.Scatter(x=x, y=y, mode="lines", name="EVA 路线",
                                    line={"color": "#15dfc3", "width": 4}))
    marked = [package.base_point, *(target.location for target in stops)]
    x, y = _local_points(package, marked)
    figure.add_trace(go.Scatter(
        x=x, y=y, text=["模拟基地", *(_waypoint_label(package, target) for target in stops)],
        hovertext=["模拟基地", *(target.name for target in stops)],
        mode="markers+text", textposition="top right", name="模拟任务航点",
        marker={"size": 10, "color": "#ffce89", "line": {"color": "#322219", "width": 1}},
        textfont={"color": "#ffdcad", "size": 12},
        hovertemplate="%{hovertext}<extra></extra>",
    ))
    if package.observation_references:
        references = package.observation_references
        east, north = zip(*(reference.xy_m for reference in references))
        figure.add_trace(go.Scatter(
            x=east, y=north, text=[reference.rover_reference for reference in references],
            mode="markers", name="火星车参考位置",
            marker={"size": 19, "color": "#9de1ff", "symbol": "circle-open", "line": {"width": 1.5}},
            hovertemplate="%{text}<extra></extra>",
        ))
    left, top = package.transform.c, package.transform.f
    width = package.terrain.shape[1] * package.transform.a
    height = package.terrain.shape[0] * abs(package.transform.e)
    figure.update_layout(
        height=550, margin={"l": 36, "r": 16, "t": 8, "b": 42},
        xaxis={"title": "东向 · 米", "range": [left, left + width], "constrain": "domain"},
        yaxis={"title": "北向 · 米", "range": [top - height, top], "scaleanchor": "x", "scaleratio": 1,
               "constrain": "domain"},
        legend={"orientation": "h", "y": -0.14}, uirevision=package.name,
    )
    return figure


def render_terrain(package, path, stops):
    x, y = grid_axes(package.transform, package.terrain.shape)
    elevation = package.terrain.elevation
    step = max(2, ceil(max(elevation.shape) / 150))
    draw_rows = np.r_[np.arange(0, len(y) - 1, step), len(y) - 1]
    draw_cols = np.r_[np.arange(0, len(x) - 1, step), len(x) - 1]
    figure = go.Figure(go.Surface(x=x[draw_cols], y=y[draw_rows], z=elevation[np.ix_(draw_rows, draw_cols)],
                                  colorscale="Earth", showscale=False, name="HiRISE 地形"))
    if path:
        x_path, y_path = _local_points(package, path)
        rows, cols = zip(*path)
        figure.add_trace(go.Scatter3d(x=x_path, y=y_path, z=elevation[rows, cols] + 0.4, mode="lines",
                                      line={"width": 6, "color": "#15dfc3"}, name="EVA 路线"))
    marked = [package.base_point, *(target.location for target in stops)]
    rows, cols = zip(*marked)
    x_marked, y_marked = _local_points(package, marked)
    figure.add_trace(go.Scatter3d(
        x=x_marked, y=y_marked, z=elevation[rows, cols] + 0.4,
        text=["模拟基地", *(_waypoint_label(package, target) for target in stops)], mode="markers+text",
        textfont={"color": "#302017", "size": 12},
        marker={"size": 4, "color": "#ffce89"}, name="模拟任务航点",
    ))
    figure.update_layout(
        height=560, margin={"l": 8, "r": 8, "t": 8, "b": 24}, uirevision=package.name,
        legend={"orientation": "h", "y": 1.01, "x": 0.02},
        scene={"xaxis_title": "东向 · 米", "yaxis_title": "北向 · 米", "zaxis_title": "高程 · 米",
               "aspectmode": "data", "camera": {"eye": {"x": 1.5, "y": -1.5, "z": 1.35}}},
    )
    return figure


def elevation_profile(package, path, segments):
    rows, cols = np.asarray(path).T
    step = package.terrain.cell_size_m
    length = np.hypot(np.diff(rows), np.diff(cols)) * step
    distance = np.r_[0, np.cumsum(length)]
    heights = package.terrain.elevation[rows, cols]
    stops = np.cumsum([int(segment["nodes"]) - 1 for segment in segments[:-1]])
    figure = go.Figure(go.Scatter(x=distance, y=heights, mode="lines", line={"color": "#db8b62"}, name="地形"))
    figure.add_trace(go.Scatter(x=distance[stops], y=heights[stops], mode="markers",
                                marker={"color": "#ffce89", "size": 8}, name="科学站点"))
    figure.update_layout(height=230, margin={"l": 44, "r": 12, "t": 4, "b": 34},
                         xaxis_title="沿路线距离 · 米", yaxis_title="高程 · 米", showlegend=False)
    return figure
