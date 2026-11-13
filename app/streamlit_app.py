"""Local EVA mission-planning demo.

Run with: streamlit run app/streamlit_app.py
"""

import json
import sys
from dataclasses import replace
from pathlib import Path

import numpy as np
import plotly.graph_objects as go
from PIL import Image
import streamlit as st

PROJECT_ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from mars_pathfinder.analysis.mission import evaluate_eva_route  # noqa: E402
from mars_pathfinder.data.loaders import (  # noqa: E402
    load_geojson_layer,
    load_mars_trek_mola_sample,
    load_route_reference,
    load_surface_image_evidence,
    load_synthetic_mission,
    science_targets_from_vector,
)
from mars_pathfinder.models import EVAState, MissionConstraints  # noqa: E402
from mars_pathfinder.routing.search import shortest_path  # noqa: E402
from mars_pathfinder.terrain.costs import build_eva_cost  # noqa: E402
from mars_pathfinder.terrain.derivatives import slope_degrees  # noqa: E402


st.set_page_config(page_title="Mars Pathfinder AI — EVA Planner", layout="wide")

catalog = json.loads((PROJECT_ROOT / "data" / "source_catalog.json").read_text())
with st.sidebar.expander("NASA / mission resources", expanded=False):
    for source in catalog:
        st.markdown(f"**[{source['name']}]({source['url']})**")
        st.caption(source["role"])

jezero_sample = PROJECT_ROOT / "data" / "raw" / "jezero_mola_256.tif"
bookmarked_sample = PROJECT_ROOT / "data" / "raw" / "mars_trek_views" / "view_-92_87_-16_32_mola_256.tif"
geology_path = PROJECT_ROOT / "data" / "raw" / "usgs" / "jezero_geologic_units_100m.geojson"
optical_path = PROJECT_ROOT / "data" / "raw" / "mars_trek" / "jezero_viking_mdim21_512.jpg"

with st.sidebar:
    st.header("Mission settings")
    study_area = st.selectbox("Study area", ["Jezero (primary)", "Mars Trek bookmarked view"])

selected_sample = bookmarked_sample if study_area == "Mars Trek bookmarked view" else jezero_sample
selected_bbox = (-93.0, -16.8, -92.0, -15.8) if study_area == "Mars Trek bookmarked view" else (77.0, 18.0, 78.0, 19.0)

if selected_sample.exists():
    terrain, layers, fixture_targets = load_synthetic_mission((256, 256))
    terrain = load_mars_trek_mola_sample(selected_sample, bbox=selected_bbox)
    real_environment_layers = False
    if study_area == "Jezero (primary)" and geology_path.exists():
        geology = load_geojson_layer(geology_path, name="USGS Jezero geologic units", source="USGS SIM 3464")
        targets = science_targets_from_vector(geology, selected_bbox, terrain.shape)
    else:
        geology = None
        targets = [
            replace(fixture_targets[0], location=(40, 40), rationale="Development waypoint for the alternate Mars Trek terrain sample.", source="synthetic-demo"),
            replace(fixture_targets[1], location=(30, 70), rationale="Development waypoint for the alternate Mars Trek terrain sample.", source="synthetic-demo"),
        ]
    # No official weather or radiation layer has been selected for these views.
    # Use neutral arrays rather than inventing observations.
    weather = np.zeros(terrain.shape, dtype=float)
    radiation = np.zeros(terrain.shape, dtype=float)
    data_caption = f"NASA Mars Trek MOLA DEM · {study_area} · weather/radiation unavailable"
else:
    terrain, layers, targets = load_synthetic_mission()
    geology = None
    weather = layers["weather_demo"].values
    radiation = layers["radiation_demo"].values
    real_environment_layers = False
    data_caption = "Synthetic development fixture — no official DEM available"

if not targets:
    st.error("No science targets are available for this study area.")
    st.stop()

slope = slope_degrees(terrain)

with st.sidebar:
    target_name = st.selectbox("Science target", [target.name for target in targets])
    selected_target = next(target for target in targets if target.name == target_name)
    eva_hours = st.slider("EVA duration (hours)", 4.0, 24.0, 12.0, 1.0)
    reserve = st.slider("Return reserve", 0.10, 0.50, 0.25, 0.05)
    max_slope = st.slider("Maximum slope (degrees)", 5, 30, 18)
    display_options = ["Elevation", "Slope", "Weather risk", "Radiation risk"]
    if study_area == "Jezero (primary)" and optical_path.exists():
        display_options.append("Viking optical context")
    display_layer = st.selectbox("Map layer", display_options)

st.title("Mars Pathfinder AI")
st.caption(f"Local Martian EVA mission planner — {data_caption}")

start = (10, 10) if selected_sample.exists() else (2, 2)
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
    eva = EVAState(remaining_time_h=eva_hours, reserve_fraction=reserve)
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
    route_rows, route_cols = zip(*path)
    if display_layer == "Viking optical context" and optical_path.exists():
        optical = np.asarray(Image.open(optical_path).convert("RGB"))
        figure = go.Figure(go.Image(z=optical))
        scale = optical.shape[0] / terrain.shape[0]
        figure.add_trace(go.Scatter(x=[col * scale for col in route_cols], y=[row * scale for row in route_rows], mode="lines", name="EVA route", line={"color": "red", "width": 3}))
        figure.add_trace(go.Scatter(x=[start[1] * scale], y=[start[0] * scale], mode="markers", name="Base", marker={"color": "white", "size": 10}))
        figure.add_trace(go.Scatter(x=[goal[1] * scale], y=[goal[0] * scale], mode="markers", name="Science target", marker={"color": "yellow", "size": 12}))
        figure.update_layout(title="NASA Mars Trek Viking MDIM21 optical context", yaxis_autorange="reversed")
    else:
        figure = go.Figure(go.Heatmap(z=layer_values[display_layer], colorbar_title=display_layer))
        figure.add_trace(go.Scatter(x=route_cols, y=route_rows, mode="lines", name="EVA route", line={"color": "red", "width": 3}))
        figure.add_trace(go.Scatter(x=[start[1]], y=[start[0]], mode="markers", name="Base", marker={"color": "white", "size": 10}))
        figure.add_trace(go.Scatter(x=[goal[1]], y=[goal[0]], mode="markers", name="Science target", marker={"color": "yellow", "size": 12}))
        figure.update_layout(title=f"{display_layer} — {terrain.source}", yaxis_autorange="reversed")
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
    if not real_environment_layers:
        st.info("Weather and radiation have no selected official layer; they are shown with neutral cost and are not presented as observations.")

image_metadata_path = PROJECT_ROOT / "data" / "raw" / "perseverance" / "sol1934_sample.json"
image_evidence = load_surface_image_evidence(image_metadata_path) if image_metadata_path.exists() else None
if image_evidence is not None:
    with st.expander("Surface image evidence — Perseverance"):
        st.image(str(PROJECT_ROOT / image_evidence.local_path), caption=f"Sol {image_evidence.sol} · {image_evidence.instrument} · {image_evidence.attribution}")
        st.caption(f"Image ID: {image_evidence.image_id}")
        st.markdown(f"[Open original NASA image]({image_evidence.url}) · [Open image page]({image_evidence.page_url})")

route_reference_path = PROJECT_ROOT / "data" / "raw" / "references" / "curiosity_mount_sharp_path.json"
route_reference = load_route_reference(route_reference_path) if route_reference_path.exists() else None
if route_reference is not None:
    with st.expander("Historical route reference — Curiosity Mount Sharp"):
        st.image(str(PROJECT_ROOT / route_reference.local_path), caption=route_reference.title)
        st.caption(route_reference.description)
        st.caption(f"Data sources: {', '.join(route_reference.data_sources)}")
        st.caption(route_reference.attribution)
        st.markdown(f"[Open NASA reference page]({route_reference.url}) · [Open original asset]({route_reference.asset_url})")

if geology is not None:
    with st.expander("USGS Jezero geology context"):
        unit_names = sorted({feature.get("properties", {}).get("name", "Unknown") for feature in geology.features})
        st.metric("Mapped geologic units", len(unit_names))
        st.caption(f"{len(geology.features)} simplified polygon features · {geology.crs}")
        st.write(", ".join(unit_names[:12]) + (" …" if len(unit_names) > 12 else ""))
        st.markdown("[Open USGS SIM 3464](https://doi.org/10.3133/sim3464)")
