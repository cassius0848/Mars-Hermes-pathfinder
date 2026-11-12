"""Minimal Streamlit demo using the same interfaces as future official data."""

import sys
from pathlib import Path

import plotly.graph_objects as go
import streamlit as st

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from mars_pathfinder.data.loaders import load_synthetic_terrain  # noqa: E402
from mars_pathfinder.analysis.metrics import route_metrics  # noqa: E402
from mars_pathfinder.routing.search import shortest_path  # noqa: E402
from mars_pathfinder.terrain.derivatives import slope_degrees  # noqa: E402
from mars_pathfinder.terrain.traversability import slope_cost  # noqa: E402


st.set_page_config(page_title="Mars Pathfinder AI", layout="wide")
st.title("Mars Pathfinder AI")
st.caption("Synthetic DEM demo — replace the loader with official Mars data when available.")

terrain = load_synthetic_terrain()
slope = slope_degrees(terrain)
cost_grid = slope_cost(slope)
start = (2, 2)
goal = (terrain.shape[0] - 3, terrain.shape[1] - 3)

left, right = st.columns(2)
with left:
    st.subheader("Terrain")
    st.plotly_chart(go.Figure(go.Heatmap(z=terrain.elevation, colorbar_title="m")), use_container_width=True)
with right:
    st.subheader("Slope-aware route")
    path, _ = shortest_path(cost_grid, start, goal)
    route_rows, route_cols = zip(*path)
    figure = go.Figure(go.Heatmap(z=terrain.elevation, colorbar_title="m"))
    figure.add_trace(go.Scatter(x=route_cols, y=route_rows, mode="lines", line={"color": "red", "width": 3}))
    st.plotly_chart(figure, use_container_width=True)

metrics = route_metrics(path, terrain, slope)
st.json(metrics)
