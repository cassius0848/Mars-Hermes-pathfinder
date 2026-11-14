"""Local EVA mission-planning demo.

Run with: streamlit run app/streamlit_app.py

局部火星 EVA 任务规划演示。运行：streamlit run app/streamlit_app.py
"""

import json
import sys
from pathlib import Path

import numpy as np
import plotly.graph_objects as go
from PIL import Image
import streamlit as st

PROJECT_ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from hawksbill_map import elevation_profile, render_map, render_terrain  # noqa: E402
from jezero_atlas import LOCAL_VIEW, NERETVA_VIEW, REGIONAL_VIEW, render_jezero_atlas  # noqa: E402
from mars_pathfinder.analysis.mission import STEEP_TERRAIN_DEG  # noqa: E402
from mars_pathfinder.data.loaders import (  # noqa: E402
    load_geojson_layer,
    load_mars_trek_mola_sample,
    load_route_reference,
    load_surface_image_evidence,
    load_synthetic_mission,
    science_targets_from_vector,
)
from mars_pathfinder.data.research import load_hawksbill_gap_package, load_neretva_package  # noqa: E402
from mars_pathfinder.ai.context_builder import build_mission_context  # noqa: E402
from mars_pathfinder.ai.provider import MockProvider  # noqa: E402
from mars_pathfinder.models import EVAState, MissionConstraints, ScienceTarget  # noqa: E402
from mars_pathfinder.routing.candidates import generate_candidates, pareto_filter, select_recommended  # noqa: E402
from mars_pathfinder.terrain.costs import build_eva_cost  # noqa: E402
from mars_pathfinder.terrain.derivatives import slope_degrees  # noqa: E402


st.set_page_config(page_title="Mars Pathfinder AI — EVA Planner", layout="wide")
load_hawksbill_gap_package = st.cache_data(show_spinner=False)(load_hawksbill_gap_package)
load_neretva_package = st.cache_data(show_spinner=False)(load_neretva_package)
generate_candidates = st.cache_data(show_spinner=False, max_entries=16)(generate_candidates)

catalog = json.loads((PROJECT_ROOT / "data" / "source_catalog.json").read_text())
with st.sidebar.expander("NASA / mission resources", expanded=False):
    for source in catalog:
        st.markdown(f"**[{source['name']}]({source['url']})**")
        st.caption(source["role"])

# Local samples are small, reviewable exports from the official services.
# 本地样本来自官方服务的有限范围导出，便于审查和重复运行。
jezero_sample = PROJECT_ROOT / "data" / "raw" / "jezero_mola_256.tif"
bookmarked_sample = PROJECT_ROOT / "data" / "raw" / "mars_trek_views" / "view_-92_87_-16_32_mola_256.tif"
geology_path = PROJECT_ROOT / "data" / "raw" / "usgs" / "jezero_geologic_units_100m.geojson"
optical_path = PROJECT_ROOT / "data" / "raw" / "mars_trek" / "jezero_viking_mdim21_512.jpg"
research_root = PROJECT_ROOT / "docs" / "jezero-research"
neretva_root = PROJECT_ROOT / "data" / "local" / "neretva-vallis"
research_photo_path = research_root / "raw" / "perseverance-sol518-mastcam-z.png"
science_mosaic = research_root / "raw" / "perseverance-pia24924-fig-a.png"

with st.sidebar:
    st.header("Mission settings")
    study_area = st.selectbox(
        "Study area", [REGIONAL_VIEW, LOCAL_VIEW, NERETVA_VIEW, "Jezero (primary)", "Mars Trek bookmarked view"],
        key="study_area",
    )

if study_area == REGIONAL_VIEW:
    render_jezero_atlas(PROJECT_ROOT)
    st.stop()

selected_sample = bookmarked_sample if study_area == "Mars Trek bookmarked view" else jezero_sample
selected_bbox = (-93.0, -16.8, -92.0, -15.8) if study_area == "Mars Trek bookmarked view" else (77.0, 18.0, 78.0, 19.0)

is_neretva = study_area == NERETVA_VIEW
if study_area in (LOCAL_VIEW, NERETVA_VIEW):
    research_package = load_neretva_package(neretva_root) if is_neretva else load_hawksbill_gap_package(research_root)
    terrain = research_package.terrain
    slope = research_package.slope
    geology = research_package.geology
    targets = research_package.science_targets
    research_thermal = research_package.thermal
    start = research_package.base_point
    has_official_environment_layers = False
    weather = np.zeros(terrain.shape, dtype=float)
    radiation = np.zeros(terrain.shape, dtype=float)
    data_caption = (
        "Neretva Vallis · 1.12 × 1.12 km · HiRISE terrain and imagery · THEMIS · Perseverance"
        if is_neretva else "REAL Hawksbill Gap package · HiRISE DTM + USGS geology + THEMIS context"
    )
elif selected_sample.exists():
    # Real-data mode: do not create the synthetic mission fixture here.
    # 真实数据模式：这里不再创建合成任务 fixture。
    research_package = None
    terrain = load_mars_trek_mola_sample(selected_sample, bbox=selected_bbox)
    slope = slope_degrees(terrain)
    has_official_environment_layers = False
    research_thermal = None
    if study_area == "Jezero (primary)" and geology_path.exists():
        geology = load_geojson_layer(geology_path, name="USGS Jezero geologic units", source="USGS SIM 3464")
        targets = science_targets_from_vector(geology, selected_bbox, terrain.shape)
    else:
        geology = None
        targets = [ScienceTarget(
            "mars-trek-waypoint",
            "Mars Trek bookmarked waypoint",
            (40, 40),
            0.0,
            "User-provided Mars Trek bookmark; no official science target layer selected.",
            "user-provided Mars Trek bookmark",
        )]
    # No official weather or radiation layer has been selected for these views.
    # 当前视图没有选定官方天气/辐射层，因此使用中性数组，绝不虚构观测。
    weather = np.zeros(terrain.shape, dtype=float)
    radiation = np.zeros(terrain.shape, dtype=float)
    start = (10, 10)
    data_caption = f"REAL NASA/USGS data · {study_area} · weather/radiation unavailable"
else:
    # Synthetic mode exists only as a development fallback and is labeled below.
    # 合成模式只作为开发 fallback，并在界面中明确标记。
    research_package = None
    terrain, layers, targets = load_synthetic_mission()
    geology = None
    slope = slope_degrees(terrain)
    weather = layers["weather_demo"].values
    radiation = layers["radiation_demo"].values
    has_official_environment_layers = False
    research_thermal = None
    start = (2, 2)
    data_caption = "SYNTHETIC DEVELOPMENT FIXTURE — no official DEM available"

if not targets:
    st.error("No science targets are available for this study area.")
    st.stop()

with st.sidebar:
    target_name = st.selectbox("Science target", [target.name for target in targets])
    selected_target = next(target for target in targets if target.name == target_name)
    scope_options = ["Selected target round trip"]
    if len(targets) > 1:
        scope_options.insert(0, "All science targets")
    mission_scope = st.selectbox("Mission scope", scope_options)
    mission_targets = targets if mission_scope == "All science targets" else [selected_target]
    max_slope = st.slider("Maximum slope (degrees)", 5, 30, 18)
    if research_package is not None:
        budget_minutes = st.slider("Simulated EVA budget (min)", 35, 120, 100 if is_neretva else 80, 5)
        reserve_minutes = st.number_input("Return reserve (min)", min_value=0, max_value=20, value=8)
        eva_hours, reserve = budget_minutes / 60, reserve_minutes / budget_minutes
        speed = 900.0
        st.caption("Simulation · 15 m/min walking speed · 12 min per stop")
        display_options = ["HiRISE local orthophoto", "Elevation", "Slope", "3D terrain", "THEMIS thermal context"]
    else:
        eva_hours = st.slider("EVA duration (hours)", 4.0, 24.0, 12.0, 1.0)
        reserve = st.slider("Return reserve", 0.10, 0.50, 0.25, 0.05)
        speed = 3000.0
        display_options = ["Elevation", "Slope", "Weather risk", "Radiation risk"]
        if study_area == "Jezero (primary)" and optical_path.exists():
            display_options.append("Viking optical context")
    display_layer = st.selectbox("Map layer", display_options)

st.title("Mars Pathfinder AI")
st.caption(f"Local Martian EVA mission planner — {data_caption}")

with st.expander("Mission brief / 任务简报", expanded=True):
    if is_neretva:
        st.markdown(
            "Two astronauts set out from a simulated base to compare ancient rock textures at Bright Angel "
            "on the north side and Serpentine Rapids on the south side of Neretva Vallis. They return to the base.\n\n"
            "两名宇航员从模拟基地出发，对照北岸 Bright Angel 和南岸 Serpentine Rapids 的岩石纹理，完成观察后返回基地。"
        )
    elif study_area == LOCAL_VIEW:
        st.markdown(
            "Two astronauts leave a simulated base, investigate Swift Run and Hazeltop, then return to base.\n\n"
            "两名宇航员从模拟基地出发，调查 Swift Run 与 Hazeltop，随后返航。"
        )
    else:
        st.markdown("Two astronauts visit the selected stops and return to the simulated base.")
    brief_cols = st.columns(4)
    brief_cols[0].metric("Crew / 人员", "2 astronauts")
    area = "Neretva Vallis" if is_neretva else "Hawksbill Gap" if study_area == LOCAL_VIEW else study_area
    brief_cols[1].metric("Study area / 区域", area)
    brief_cols[2].metric("Requested stops / 计划站点", str(len(mission_targets)))
    brief_cols[3].metric("Route type / 路线", "Closed loop")
    if is_neretva:
        st.caption("Route computed on 2 m HiRISE terrain. See Science evidence for the rover reference positions and images.")
        st.caption("The 2 m slope grid can miss individual rocks, sand hazards and abrupt steps.")
    elif study_area == LOCAL_VIEW:
        st.caption("Observed HiRISE, USGS, Perseverance and THEMIS · Derived slope, route and profile")

# The base point is a mission-planning input, not an observed rover location.
# 基地位置是任务规划输入，不应被描述成真实火星车观测位置。
goal = selected_target.location
science = np.zeros(terrain.shape, dtype=float)
for target in mission_targets:
    science[target.location] = target.science_value
# Hard slope limits are encoded as impassable cells before route search.
# 先把硬性坡度阈值编码为不可通行，再进行路线搜索。
cost_grid = build_eva_cost(
    slope,
    weather_risk=weather,
    radiation_risk=radiation,
    science_value=science,
    # Real terrain and USGS target evidence drive the current planner.
    # 当前规划器由真实地形和 USGS 科学目标证据驱动。
    terrain_weight=1.0,
    science_weight=0.5,
    # No official weather/radiation layers are loaded yet, so their weights are zero.
    # 尚未加载官方天气/辐射层，因此权重明确为 0。
    weather_weight=0.0 if not has_official_environment_layers else 1.0,
    radiation_weight=0.0 if not has_official_environment_layers else 1.0,
    max_slope_deg=float(max_slope),
)

try:
    # Generate forward, reverse, and single-stop candidates before choosing one.
    # 先生成正序、反序和单站候选，再选择路线。
    eva = EVAState(remaining_time_h=eva_hours, reserve_fraction=reserve)
    constraints = MissionConstraints(max_slope_deg=float(max_slope), speed_m_per_h=speed)
    gentle_cost_grid = None
    if research_package is not None:
        passable = np.isfinite(cost_grid)
        gentle_cost_grid = np.where(passable, 1.0 + 4.0 * (slope / max_slope) ** 2, np.inf)
        cost_grid = np.where(passable, 1.0, np.inf)
    candidates = generate_candidates(cost_grid, start, mission_targets, terrain, slope, eva, constraints,
                                     gentle_cost_grid=gentle_cost_grid)
    pareto_candidates = pareto_filter(candidates)
    recommended = select_recommended(pareto_candidates if is_neretva else candidates)
    route_ids = [candidate.route_id for candidate in candidates]
    target_names = {target.target_id: target.name for target in targets}
    labels = {
        candidate.route_id: candidate.profile + " · " + " → ".join(target_names[stop] for stop in candidate.stop_ids)
        for candidate in candidates
    }
    selected_route_id = st.sidebar.selectbox(
        "Route candidate", ["Recommended", *route_ids], format_func=lambda route_id: labels.get(route_id, route_id),
    )
    selected_candidate = recommended if selected_route_id == "Recommended" else next(
        candidate for candidate in candidates if candidate.route_id == selected_route_id
    )
    route_targets = [next(target for target in targets if target.target_id == stop) for stop in selected_candidate.stop_ids]
    path = selected_candidate.path
    planning_cost = selected_candidate.planning_cost
    segments = selected_candidate.segments
    report = selected_candidate.report
except ValueError as exc:
    st.error(str(exc))
    if research_package is not None:
        st.plotly_chart(render_map(research_package, "HiRISE local orthophoto", [], mission_targets),
                        use_container_width=True)
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
    if research_package is not None and display_layer == "3D terrain":
        figure = render_terrain(research_package, path, route_targets)
    elif display_layer == "THEMIS thermal context" and research_thermal is not None and not is_neretva:
        # THEMIS is regional context at 100 m/pixel; do not pretend it is route-resolution.
        # THEMIS 是 100 m 区域背景，不能伪装成米级路线图层。
        figure = go.Figure(go.Heatmap(z=research_thermal, colorbar_title="THEMIS DN"))
        figure.update_layout(title="Real THEMIS thermal context — regional scale", yaxis_autorange="reversed")
    elif research_package is not None:
        figure = render_map(research_package, display_layer, path, route_targets)
    elif display_layer == "Viking optical context" and optical_path.exists():
        # The optical export shares the Jezero bbox, so grid coordinates scale directly.
        # 光学图与 MOLA 使用同一 Jezero 范围，可直接按网格比例叠加路线。
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
    if is_neretva and display_layer == "THEMIS thermal context":
        st.caption("Mars Odyssey THEMIS · 100 m cells · relative infrared intensity for regional context.")
    if research_package is not None:
        st.plotly_chart(elevation_profile(research_package, path, segments), use_container_width=True)

with right:
    st.subheader("Mission report")
    st.metric("Route distance", f"{report['distance_m']:.0f} m")
    st.metric("Estimated EVA time", f"{report['estimated_time_h']:.2f} h")
    st.caption(f"Walk {report['walk_time_h']:.2f} h · science stops {report['science_stop_time_h']:.2f} h")
    st.metric("Time margin after reserve", f"{report['time_margin_h'] * 60:+.1f} min")
    st.metric("Maximum slope", f"{report['max_slope_deg']:.1f}°")
    st.metric(f"Distance on slopes ≥ {STEEP_TERRAIN_DEG:g}°", f"{report['steep_distance_m']:.0f} m")
    st.caption(f"Closed-loop legs: {len(segments)} · {mission_scope}")
    st.caption(f"Pareto candidates: {len(pareto_candidates)} / all candidates: {len(candidates)}")
    if not report["time_budget_ok"]:
        st.warning("This route exceeds the time budget after the return reserve.")
    elif report["safety_ok"]:
        st.success("Time and configured resource checks passed")
    elif report["resource_status"] == "unconfigured":
        st.warning("Route geometry and time are available, but the EVA resource model is not configured")
    else:
        st.warning("Route exceeds the configured EVA resource reserve")
    st.caption("Stops on this route · " + ", ".join(target.name for target in route_targets))
    skipped = [target.name for target in mission_targets if target.target_id not in selected_candidate.stop_ids]
    if skipped:
        st.info("Deferred science stops · " + ", ".join(skipped))
    if report["alignment_review_required"]:
        st.warning(f"Target alignment requires review; recorded uncertainty up to {report['max_position_uncertainty_m']:.1f} m")
    st.caption("Sources · " + ", ".join(sorted({target.source for target in route_targets})))
    if not has_official_environment_layers:
        st.info("Weather and radiation are unavailable in this view. Route scoring assigns both a weight of 0.")

with st.expander("Offline mission assistant (MockProvider)"):
    # This provider is deterministic and does not call DeepSeek yet.
    # 当前 provider 是确定性的离线模拟器，尚未调用 DeepSeek。
    ai_context = build_mission_context(
        mission_id=study_area,
        data_mode="real" if research_package is not None or selected_sample.exists() else "synthetic",
        constraints={"eva_hours": eva_hours, "reserve_fraction": reserve, "max_slope_deg": max_slope},
        targets=[{"id": target.target_id, "name": target.name, "source": target.source} for target in route_targets],
        route_candidates=[{
            "route_id": selected_candidate.route_id,
            "planning_cost": float(planning_cost),
            "distance_m": report["distance_m"],
            "estimated_time_h": report["estimated_time_h"],
            "safety_ok": report["safety_ok"],
        }],
        data_sources=sorted({target.source for target in route_targets}),
        missing_data=["official spatial weather layer", "official spatial radiation layer"],
    )
    recommendation = MockProvider().recommend(ai_context)
    st.json(recommendation.to_dict())

with st.expander("Route candidate comparison / 候选路线对比"):
    candidate_rows = []
    pareto_ids = {candidate.route_id for candidate in pareto_candidates}
    for candidate in candidates:
        candidate_rows.append({
            "profile": candidate.profile,
            "targets": " → ".join(target_names[stop] for stop in candidate.stop_ids),
            "distance_m": round(candidate.report["distance_m"], 1),
            "time_h": round(candidate.report["estimated_time_h"], 3),
            "time_margin_min": round(candidate.report["time_margin_h"] * 60, 1),
            "max_slope_deg": round(candidate.report["max_slope_deg"], 2),
            "steep_distance_m": round(candidate.report["steep_distance_m"], 1),
            "ascent_m": round(candidate.report["ascent_m"], 1),
            "resource_status": candidate.report["resource_status"],
            "alignment_review": candidate.report["alignment_review_required"],
            "pareto": candidate.route_id in pareto_ids,
        })
    st.dataframe(candidate_rows, use_container_width=True, hide_index=True)
    st.caption("Routes are deterministic candidates. AI does not choose or alter hard constraints.")

if is_neretva:
    st.caption("[USGS HiRISE terrain](https://doi.org/10.5066/P9REJ9JN) · "
               "[NASA Mars Trek imagery](https://trek.nasa.gov/mars/) · "
               "[Mars Odyssey THEMIS](https://stac.astrogeology.usgs.gov/docs/data/mars/themis_controlled_mosaics/)")
    with st.expander("Science evidence · Bright Angel and Serpentine Rapids"):
        st.caption("Rover references locate the observations approximately. The route markers are simulated stops.")
        for target, reference, column in zip(targets, research_package.observation_references, st.columns(2)):
            with column:
                st.markdown(f"**{target.name}**")
                st.write(target.rationale)
                image = reference.photograph
                st.image(image.local_path, caption=f"Sol {image.sol} · {image.instrument} · {image.attribution}")
                st.caption(f"{reference.rover_reference} · Modeled stop offset {reference.modeled_stop_offset_m:.1f} m")
                st.markdown(f"[NASA observation]({image.page_url}) · [Rover reference data]({reference.rover_source_url})")
elif study_area == LOCAL_VIEW:
    with st.expander("Science evidence · Swift Run and Hazeltop"):
        first, second = st.columns(2)
        with first:
            st.markdown("**Swift Run · Skinner Ridge**")
            st.write("Compare the sandstone grain size and bedding at the delta front.")
        with second:
            st.markdown("**Hazeltop · Wildcat Ridge**")
            st.write("Inspect fine-grained sedimentary rock and the sulfate-bearing alteration evidence.")
        st.image(str(science_mosaic), caption="Mastcam-Z annotated outcrops · NASA/JPL-Caltech/ASU/MSSS")
        st.markdown(
            "[NASA annotated sites](https://science.nasa.gov/resource/two-perseverance-sampling-locations-in-jezeros-delta/) · "
            "[NASA Mars rock samples](https://science.nasa.gov/mission/mars-2020-perseverance/mars-rock-samples/)"
        )
    with st.expander("Hawksbill Gap research validation"):
        route_names = [feature.get("properties", {}).get("name", "Unnamed") for feature in research_package.route_preview.get("features", [])]
        st.metric("Archived route candidates", len(route_names))
        st.caption("Sources: HiRISE DTM/orthophoto · THEMIS · USGS SIM 3464 · Perseverance/PDS")
        st.write(", ".join(route_names) if route_names else "No archived route preview")
        st.json(research_package.meda_summary)
        st.caption("MEDA values are real Sol 518 time-series probes; they are context only, not a spatial risk raster.")

# Evidence assets are shown with provenance and are never treated as DEM layers.
# 证据素材始终显示溯源信息，不会被误当作 DEM 图层。
if not is_neretva and research_photo_path.exists():
    with st.expander("Research-package surface evidence — Perseverance Sol 518"):
        st.image(str(research_photo_path), caption="Real Perseverance Mastcam-Z image · Sol 518")
        st.caption("Source and provenance: docs/jezero-research/raw/perseverance-sol518.html")

image_metadata_path = PROJECT_ROOT / "data" / "raw" / "perseverance" / "sol1934_sample.json"
image_evidence = load_surface_image_evidence(image_metadata_path) if image_metadata_path.exists() else None
if not is_neretva and image_evidence is not None:
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
