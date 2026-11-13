"""Local EVA mission-planning demo.

Run with: streamlit run app/streamlit_app.py
"""

import json
import sys
from dataclasses import replace
from pathlib import Path

import numpy as np
import plotly.graph_objects as go
import streamlit as st

PROJECT_ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from mars_pathfinder.analysis.mission import evaluate_eva_route  # noqa: E402
from mars_pathfinder.data.loaders import load_mars_trek_mola_sample, load_surface_image_evidence, load_synthetic_mission  # noqa: E402
from mars_pathfinder.models import EVAState, MissionConstraints  # noqa: E402
from mars_pathfinder.routing.search import shortest_path  # noqa: E402
from mars_pathfinder.terrain.costs import build_eva_cost  # noqa: E402
from mars_pathfinder.terrain.derivatives import slope_degrees  # noqa: E402


st.set_page_config(page_title="Mars Pathfinder AI — EVA Planner", layout="wide")

with st.sidebar.expander("NASA / mission resources", expanded=False):
    catalog = json.loads((PROJECT_ROOT / "data" / "source_catalog.json").read_text())
    for source in catalog:
        st.markdown(f"**[{source["name"]}]({source["url"]})**  ")
        st.caption(source["role"])
st.title("Mars Pathfinder AI")
st.caption(f"Local Martian EVA mission planner — {data_caption}")

image_metadata_path = PROJECT_ROOT / "data" / "raw" / "perseverance" / "sol1934_sample.json"
image_evidence = load_surface_image_evidence(image_metadata_path) if image_metadata_path.exists() else None

mola_sample = PROJECT_ROOT / "data" / "raw" / "jezero_mola_256.tif"
if mola_sample.exists():
    terrain, layers, targets = load_synthetic_mission((256, 256))
    terrain = load_mars_trek_mola_sample(mola_sample)
    targets = [
        replace(targets[0], location=(40, 40)),
        replace(targets[1], location=(30, 70)),
    ]
    data_caption = "NASA Mars Trek MOLA DEM + synthetic weather/radiation fixture"
else:
    terrain, layers, targets = load_synthetic_mission()
    data_caption = "Synthetic DEM + synthetic weather/radiation fixture"
slope = slope_degrees(terrain)
weather = layers["weather_demo"].values
radiation = layers["radiation_demo"].values

with st.sidebar:
    st.header("Mission settings")
    target_name = st.selectbox("Science target", [target.name for target in targets])
    selected_target = next(target for target in targets if target.name == target_name)
    reserve = st.slider("Return reserve", 0.10, 0.50, 0.25, 0.05)
    max_slope = st.slider("Maximum slope (degrees)", 5, 30, 18)
    display_layer = st.selectbox("Map layer", ["Elevation", "Slope", "Weather risk", "Radiation risk"])

start = (10, 10) if mola_sample.exists() else (2, 2)
goal = selected_target.location
science = np.zeros(terrain.shape, dtype=float)
science[goal] = selected_target.science_value
cost_grid = build_eva_cost(
    slope,
    weather_risk=weather,
    radiation_risk=radiation,
    science_value=science,
    max_slope_deg=float(max_slope),
)

try:
    path, planning_cost = shortest_path(cost_grid, start, goal)
    eva = EVAState(reserve_fraction=reserve)
    constraints = MissionConstraints(max_slope_deg=float(max_slope))
    report = evaluate_eva_route(path, terrain, slope, eva, constraints, targets)
except ValueError as exc:
    st.error(f"No safe route: {exc}")
    st.stop()

layer_values = {
    "Elevation": terrain.elevation,
    "Slope": slope,
    "Weather risk": weather,
    "Radiation risk": radiation,
}

left, right = st.columns([3, 2])
with left:
    figure = go.Figure(go.Heatmap(z=layer_values[display_layer], colorbar_title=display_layer))
    route_rows, route_cols = zip(*path)
    figure.add_trace(go.Scatter(x=route_cols, y=route_rows, mode="lines", name="EVA route", line={"color": "red", "width": 3}))
    figure.add_trace(go.Scatter(x=[start[1]], y=[start[0]], mode="markers", name="Base", marker={"color": "white", "size": 10}))
    figure.add_trace(go.Scatter(x=[goal[1]], y=[goal[0]], mode="markers", name="Science target", marker={"color": "yellow", "size": 12}))
    figure.update_layout(title=f"{display_layer} — {layers['optical_demo'].source}", yaxis_autorange="reversed")
    st.plotly_chart(figure, use_container_width=True)

with right:
    st.subheader("Mission report")
    st.metric("Route distance", f"{report['distance_m']:.0f} m")
    st.metric("Estimated EVA time", f"{report['estimated_time_h']:.2f} h")
    st.metric("Maximum slope", f"{report['max_slope_deg']:.1f}°")
    st.metric("Planning cost", f"{planning_cost:.1f}")
    if report["safety_ok"]:
        st.success("Resource reserve and route-time checks passed")
    else:
        st.warning("Route exceeds the current EVA resource reserve")
    st.caption(f"Science target: {selected_target.rationale} Source: {selected_target.source}")

if image_evidence is not None:
    with st.expander("Surface image evidence — Perseverance"):
        st.image(str(PROJECT_ROOT / image_evidence.local_path), caption=f"Sol {image_evidence.sol} · {image_evidence.instrument} · {image_evidence.attribution}")
        st.caption(f"Image ID: {image_evidence.image_id}")
        st.markdown(f"[Open original NASA image]({image_evidence.url}) · [Open image page]({image_evidence.page_url})")
