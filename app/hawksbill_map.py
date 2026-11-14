"""Plan and display Hawksbill Gap routes on the archived local Mars grid."""

import base64
from io import BytesIO

import numpy as np
import plotly.graph_objects as go
from PIL import Image
from rasterio.transform import xy

from mars_pathfinder.data.jezero_region import grid_axes


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

    values = package.slope if layer == "Slope" else package.terrain.elevation
    color_title = "Slope (°)" if layer == "Slope" else "Elevation (m)"
    return go.Heatmap(x=x, y=y, z=values, colorscale="Cividis", colorbar={"title": color_title}, hoverongaps=False)


def render_map(package, layer, path, stops):
    figure = go.Figure(route_layers(package, layer))
    if path:
        x, y = _local_points(package, path)
        figure.add_trace(go.Scatter(x=x, y=y, mode="lines", name="EVA route",
                                    line={"color": "#15dfc3", "width": 4}))
    marked = [package.base_point, *(target.location for target in stops)]
    x, y = _local_points(package, marked)
    figure.add_trace(go.Scatter(
        x=x, y=y, text=["Simulated base", *(target.name for target in stops)],
        mode="markers+text", textposition="top right", name="Mission waypoints",
        marker={"size": 10, "color": "#ffce89", "line": {"color": "#322219", "width": 1}},
        textfont={"color": "#ffdcad", "size": 12},
        hovertemplate="%{text}<extra></extra>",
    ))
    left, top = package.transform.c, package.transform.f
    width = package.terrain.shape[1] * package.transform.a
    height = package.terrain.shape[0] * abs(package.transform.e)
    figure.update_layout(
        height=550, margin={"l": 36, "r": 16, "t": 8, "b": 42},
        xaxis={"title": "East · m", "range": [left, left + width], "constrain": "domain"},
        yaxis={"title": "North · m", "range": [top - height, top], "scaleanchor": "x", "scaleratio": 1,
               "constrain": "domain"},
        legend={"orientation": "h", "y": -0.14}, uirevision="hawksbill_2d",
    )
    return figure


def render_terrain(package, path, stops):
    x, y = grid_axes(package.transform, package.terrain.shape)
    elevation = package.terrain.elevation
    step = 2
    figure = go.Figure(go.Surface(x=x[::step], y=y[::step], z=elevation[::step, ::step],
                                  colorscale="Earth", showscale=False, name="HiRISE terrain"))
    if path:
        x_path, y_path = _local_points(package, path)
        rows, cols = zip(*path)
        figure.add_trace(go.Scatter3d(x=x_path, y=y_path, z=elevation[rows, cols] + 0.4, mode="lines",
                                      line={"width": 6, "color": "#15dfc3"}, name="EVA route"))
    marked = [package.base_point, *(target.location for target in stops)]
    rows, cols = zip(*marked)
    x_marked, y_marked = _local_points(package, marked)
    figure.add_trace(go.Scatter3d(
        x=x_marked, y=y_marked, z=elevation[rows, cols] + 0.4,
        text=["Simulated base", *(target.name for target in stops)], mode="markers+text",
        marker={"size": 4, "color": "#ffce89"}, name="Mission waypoints",
    ))
    figure.update_layout(
        height=560, margin={"l": 8, "r": 8, "t": 8, "b": 24}, uirevision="hawksbill_3d",
        scene={"xaxis_title": "East · m", "yaxis_title": "North · m", "zaxis_title": "Elevation · m",
               "aspectmode": "data"},
    )
    return figure


def elevation_profile(package, path, segments):
    rows, cols = np.asarray(path).T
    step = package.terrain.cell_size_m
    length = np.hypot(np.diff(rows), np.diff(cols)) * step
    distance = np.r_[0, np.cumsum(length)]
    heights = package.terrain.elevation[rows, cols]
    stops = np.cumsum([int(segment["nodes"]) - 1 for segment in segments[:-1]])
    figure = go.Figure(go.Scatter(x=distance, y=heights, mode="lines", line={"color": "#db8b62"}, name="Terrain"))
    figure.add_trace(go.Scatter(x=distance[stops], y=heights[stops], mode="markers",
                                marker={"color": "#ffce89", "size": 8}, name="Science stops"))
    figure.update_layout(height=230, margin={"l": 44, "r": 12, "t": 4, "b": 34},
                         xaxis_title="Distance along route · m", yaxis_title="Elevation · m", showlegend=False)
    return figure
