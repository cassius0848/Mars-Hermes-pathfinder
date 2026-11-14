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
from jezero_atlas import LOCAL_VIEW, REGIONAL_VIEW, render_jezero_atlas  # noqa: E402

STUDY_AREA_LABELS = {
    REGIONAL_VIEW: "Jezero 区域 · 40 km",
    LOCAL_VIEW: "Hawksbill Gap 局部 EVA",
    "Jezero (primary)": "Jezero 主研究区",
    "Mars Trek bookmarked view": "Mars Trek 书签视图",
}
SCOPE_LABELS = {
    "Selected target round trip": "选定目标往返",
    "All science targets": "全部科学目标",
}
LAYER_LABELS = {
    "HiRISE local orthophoto": "HiRISE 局部正射图",
    "Elevation": "高程",
    "Slope": "坡度",
    "3D terrain": "三维地形",
    "THEMIS thermal context": "THEMIS 热红外背景",
    "Weather risk": "天气风险",
    "Radiation risk": "辐射风险",
    "Viking optical context": "Viking 光学背景",
}
PROFILE_LABELS = {
    "Standard": "标准路线",
    "Shortest": "最短路线",
    "Slope-weighted": "坡度加权路线",
}
from mars_pathfinder.analysis.mission import STEEP_TERRAIN_DEG  # noqa: E402
from mars_pathfinder.data.loaders import (  # noqa: E402
    load_geojson_layer,
    load_mars_trek_mola_sample,
    load_route_reference,
    load_surface_image_evidence,
    load_synthetic_mission,
    science_targets_from_vector,
)
from mars_pathfinder.data.research import load_hawksbill_gap_package  # noqa: E402
from mars_pathfinder.ai.context_builder import build_mission_context  # noqa: E402
from mars_pathfinder.ai.provider import MockProvider  # noqa: E402
from mars_pathfinder.models import EVAState, MissionConstraints, ScienceTarget  # noqa: E402
from mars_pathfinder.routing.candidates import generate_candidates, pareto_filter, select_recommended  # noqa: E402
from mars_pathfinder.terrain.costs import build_eva_cost  # noqa: E402
from mars_pathfinder.terrain.derivatives import slope_degrees  # noqa: E402


st.set_page_config(page_title="火星探路者 AI — EVA 规划器", layout="wide")
load_hawksbill_gap_package = st.cache_data(show_spinner=False)(load_hawksbill_gap_package)

catalog = json.loads((PROJECT_ROOT / "data" / "source_catalog.json").read_text())
with st.sidebar.expander("NASA / 任务数据来源", expanded=False):
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
research_photo_path = research_root / "raw" / "perseverance-sol518-mastcam-z.png"
science_mosaic = research_root / "raw" / "perseverance-pia24924-fig-a.png"

with st.sidebar:
    st.header("任务设置")
    study_area = st.selectbox(
        "研究区域", [REGIONAL_VIEW, LOCAL_VIEW, "Jezero (primary)", "Mars Trek bookmarked view"],
        format_func=lambda value: STUDY_AREA_LABELS.get(value, value), key="study_area",
    )

if study_area == REGIONAL_VIEW:
    render_jezero_atlas(PROJECT_ROOT)
    st.stop()

selected_sample = bookmarked_sample if study_area == "Mars Trek bookmarked view" else jezero_sample
selected_bbox = (-93.0, -16.8, -92.0, -15.8) if study_area == "Mars Trek bookmarked view" else (77.0, 18.0, 78.0, 19.0)

if study_area == LOCAL_VIEW:
    # Research mode consumes the teammate's measured local package directly.
    # 研究包模式直接读取队友取得的真实局部数据。
    research_package = load_hawksbill_gap_package(research_root)
    terrain = research_package.terrain
    slope = research_package.slope
    geology = research_package.geology
    targets = research_package.science_targets
    research_thermal = research_package.thermal
    start = research_package.base_point
    selected_sample = research_root / "derived" / "jezero-elevation-local-2m.tif"
    has_official_environment_layers = False
    weather = np.zeros(terrain.shape, dtype=float)
    radiation = np.zeros(terrain.shape, dtype=float)
    data_caption = "真实 Hawksbill Gap 数据包 · HiRISE DTM + USGS 地质 + THEMIS 背景"
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
            "用户提供的 Mars Trek 书签；尚未选择官方科学目标图层。",
            "user-provided Mars Trek bookmark",
        )]
    # No official weather or radiation layer has been selected for these views.
    # 当前视图没有选定官方天气/辐射层，因此使用中性数组，绝不虚构观测。
    weather = np.zeros(terrain.shape, dtype=float)
    radiation = np.zeros(terrain.shape, dtype=float)
    start = (10, 10)
    data_caption = f"真实 NASA/USGS 数据 · {STUDY_AREA_LABELS.get(study_area, study_area)} · 天气/辐射不可用"
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
    data_caption = "合成开发数据 — 没有可用的官方 DEM"

if not targets:
    st.error("当前研究区域没有可用的科学目标。")
    st.stop()

with st.sidebar:
    target_name = st.selectbox("科学目标", [target.name for target in targets])
    selected_target = next(target for target in targets if target.name == target_name)
    scope_options = ["Selected target round trip"]
    if len(targets) > 1:
        scope_options.insert(0, "All science targets")
    mission_scope = st.selectbox("任务范围", scope_options, format_func=lambda value: SCOPE_LABELS.get(value, value))
    mission_targets = targets if mission_scope == "All science targets" else [selected_target]
    max_slope = st.slider("最大坡度（度）", 5, 30, 18)
    if research_package is not None:
        budget_minutes = st.slider("模拟 EVA 预算（分钟）", 35, 120, 80, 5)
        reserve_minutes = st.number_input("返航预留（分钟）", min_value=0, max_value=20, value=8)
        eva_hours, reserve = budget_minutes / 60, reserve_minutes / budget_minutes
        speed = 900.0
        st.caption("模拟参数：15 米/分钟步速 · 每个站点停留 12 分钟")
        display_options = ["HiRISE local orthophoto", "Elevation", "Slope", "3D terrain", "THEMIS thermal context"]
    else:
        eva_hours = st.slider("EVA 时长（小时）", 4.0, 24.0, 12.0, 1.0)
        reserve = st.slider("返航预留比例", 0.10, 0.50, 0.25, 0.05)
        speed = 3000.0
        display_options = ["Elevation", "Slope", "Weather risk", "Radiation risk"]
        if study_area == "Jezero (primary)" and optical_path.exists():
            display_options.append("Viking optical context")
    display_layer = st.selectbox("地图图层", display_options, format_func=lambda value: LAYER_LABELS.get(value, value))

st.title("火星探路者 AI")
st.caption(f"局部火星 EVA 任务规划器 — {data_caption}")

with st.expander("任务简报", expanded=True):
    st.markdown(
        "**任务场景：** 两名宇航员从模拟基地出发，调查 Swift Run 与 Hazeltop，随后沿闭环路线返航。"
    )
    brief_cols = st.columns(4)
    brief_cols[0].metric("人员", "2 名宇航员")
    brief_cols[1].metric("区域", "Hawksbill Gap")
    brief_cols[2].metric("计划站点", str(len(mission_targets)))
    brief_cols[3].metric("路线类型", "闭环路线")
    st.caption(
        "观测：HiRISE、USGS、Perseverance、THEMIS · 派生：坡度、路线、剖面 "
        "· 未配置：空间天气/辐射和生命支持容量"
    )

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
    recommended = select_recommended(candidates)
    route_ids = [candidate.route_id for candidate in candidates]
    target_names = {target.target_id: target.name for target in targets}
    labels = {
        candidate.route_id: PROFILE_LABELS.get(candidate.profile, candidate.profile) + " · " + " → ".join(target_names[stop] for stop in candidate.stop_ids)
        for candidate in candidates
    }
    selected_route_id = st.sidebar.selectbox(
        "路线候选", ["Recommended", *route_ids], format_func=lambda route_id: ("推荐路线" if route_id == "Recommended" else PROFILE_LABELS.get(labels.get(route_id, ""), labels.get(route_id, route_id))),
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
    st.error(f"路线规划失败：{exc}")
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
    elif display_layer == "THEMIS thermal context" and research_thermal is not None:
        # THEMIS is regional context at 100 m/pixel; do not pretend it is route-resolution.
        # THEMIS 是 100 m 区域背景，不能伪装成米级路线图层。
        figure = go.Figure(go.Heatmap(z=research_thermal, colorbar_title="THEMIS DN（相对值）"))
        figure.update_layout(title="真实 THEMIS 热红外背景 — 区域尺度", yaxis_autorange="reversed")
    elif research_package is not None:
        figure = render_map(research_package, display_layer, path, route_targets)
    elif display_layer == "Viking optical context" and optical_path.exists():
        # The optical export shares the Jezero bbox, so grid coordinates scale directly.
        # 光学图与 MOLA 使用同一 Jezero 范围，可直接按网格比例叠加路线。
        optical = np.asarray(Image.open(optical_path).convert("RGB"))
        figure = go.Figure(go.Image(z=optical))
        scale = optical.shape[0] / terrain.shape[0]
        figure.add_trace(go.Scatter(x=[col * scale for col in route_cols], y=[row * scale for row in route_rows], mode="lines", name="EVA 路线", line={"color": "red", "width": 3}))
        figure.add_trace(go.Scatter(x=[start[1] * scale], y=[start[0] * scale], mode="markers", name="基地", marker={"color": "white", "size": 10}))
        figure.add_trace(go.Scatter(x=[goal[1] * scale], y=[goal[0] * scale], mode="markers", name="科学目标", marker={"color": "yellow", "size": 12}))
        figure.update_layout(title="NASA Mars Trek Viking MDIM21 光学背景", yaxis_autorange="reversed")
    else:
        figure = go.Figure(go.Heatmap(z=layer_values[display_layer], colorbar_title=LAYER_LABELS.get(display_layer, display_layer)))
        figure.add_trace(go.Scatter(x=route_cols, y=route_rows, mode="lines", name="EVA 路线", line={"color": "red", "width": 3}))
        figure.add_trace(go.Scatter(x=[start[1]], y=[start[0]], mode="markers", name="基地", marker={"color": "white", "size": 10}))
        figure.add_trace(go.Scatter(x=[goal[1]], y=[goal[0]], mode="markers", name="科学目标", marker={"color": "yellow", "size": 12}))
        figure.update_layout(title=f"{display_layer} — {terrain.source}", yaxis_autorange="reversed")
    st.plotly_chart(figure, use_container_width=True)
    if research_package is not None:
        st.plotly_chart(elevation_profile(research_package, path, segments), use_container_width=True)

with right:
    st.subheader("任务报告")
    st.metric("路线距离", f"{report['distance_m']:.0f} m")
    st.metric("预计 EVA 用时", f"{report['estimated_time_h']:.2f} h")
    st.caption(f"行走 {report['walk_time_h']:.2f} 小时 · 科学站停留 {report['science_stop_time_h']:.2f} 小时")
    st.metric("扣除返航预留后的时间余量", f"{report['time_margin_h'] * 60:+.1f} min")
    st.metric("最大坡度", f"{report['max_slope_deg']:.1f}°")
    st.metric(f"坡度 ≥ {STEEP_TERRAIN_DEG:g}° 的路段距离", f"{report['steep_distance_m']:.0f} m")
    st.caption(f"闭环路段：{len(segments)} · {SCOPE_LABELS.get(mission_scope, mission_scope)}")
    st.caption(f"Pareto 候选：{len(pareto_candidates)} / 全部候选：{len(candidates)}")
    if not report["time_budget_ok"]:
        st.warning("这条路线在扣除返航预留后超出时间预算。")
    elif report["safety_ok"]:
        st.success("时间和已配置资源检查通过。")
    elif report["resource_status"] == "unconfigured":
        st.warning("路线几何和时间可用，但 EVA 资源模型尚未配置。")
    else:
        st.warning("路线超出已配置的 EVA 资源预留。")
    st.caption("本路线站点 · " + ", ".join(target.name for target in route_targets))
    skipped = [target.name for target in mission_targets if target.target_id not in selected_candidate.stop_ids]
    if skipped:
        st.info("暂缓的科学站点 · " + ", ".join(skipped))
    if report["alignment_review_required"]:
        st.warning(f"目标配准需要复核；记录的不确定性最高为 {report['max_position_uncertainty_m']:.1f} 米")
    st.caption("数据来源 · " + ", ".join(sorted({target.source for target in route_targets})))
    if not has_official_environment_layers:
        st.info("尚未选择官方天气或辐射图层；它们的权重为 0，也不会被展示为观测值。")

with st.expander("离线任务助手（MockProvider）"):
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
        missing_data=["官方空间天气图层", "官方空间辐射图层"],
    )
    recommendation = MockProvider().recommend(ai_context)
    st.json(recommendation.to_dict())

with st.expander("路线候选对比"):
    candidate_rows = []
    pareto_ids = {candidate.route_id for candidate in pareto_candidates}
    for candidate in candidates:
        candidate_rows.append({
            "路线类型": PROFILE_LABELS.get(candidate.profile, candidate.profile),
            "目标顺序": " → ".join(target_names[stop] for stop in candidate.stop_ids),
            "距离（米）": round(candidate.report["distance_m"], 1),
            "用时（小时）": round(candidate.report["estimated_time_h"], 3),
            "预留后余量（分钟）": round(candidate.report["time_margin_h"] * 60, 1),
            "最大坡度（度）": round(candidate.report["max_slope_deg"], 2),
            "陡坡段距离（米）": round(candidate.report["steep_distance_m"], 1),
            "爬升（米）": round(candidate.report["ascent_m"], 1),
            "资源状态": candidate.report["resource_status"],
            "需复核配准": candidate.report["alignment_review_required"],
            "Pareto 前沿": candidate.route_id in pareto_ids,
        })
    st.dataframe(candidate_rows, use_container_width=True, hide_index=True)
    st.caption("路线候选由确定性算法生成；AI 不会选择或修改硬约束。")

if research_package is not None:
    with st.expander("科学证据 · Swift Run 与 Hazeltop"):
        first, second = st.columns(2)
        with first:
            st.markdown("**Swift Run · Skinner Ridge**")
            st.write("比较三角洲前缘砂岩的颗粒大小与层理。")
        with second:
            st.markdown("**Hazeltop · Wildcat Ridge**")
            st.write("观察细粒沉积岩和含硫酸盐蚀变证据。")
        st.image(str(science_mosaic), caption="Mastcam-Z 标注露头 · NASA/JPL-Caltech/ASU/MSSS")
        st.markdown(
            "[NASA annotated sites](https://science.nasa.gov/resource/two-perseverance-sampling-locations-in-jezeros-delta/) · "
            "[NASA Mars rock samples](https://science.nasa.gov/mission/mars-2020-perseverance/mars-rock-samples/)"
        )
    with st.expander("Hawksbill Gap 研究包验证"):
        route_names = [feature.get("properties", {}).get("name", "Unnamed") for feature in research_package.route_preview.get("features", [])]
        st.metric("归档路线候选数", len(route_names))
        st.caption("来源：HiRISE DTM/正射图 · THEMIS · USGS SIM 3464 · Perseverance/PDS")
        st.write(", ".join(route_names) if route_names else "没有归档路线预览")
        st.json(research_package.meda_summary)
        st.caption("MEDA 数值来自真实 Sol 518 时间序列探测；仅作为背景信息，不是空间风险栅格。")

# Evidence assets are shown with provenance and are never treated as DEM layers.
# 证据素材始终显示溯源信息，不会被误当作 DEM 图层。
if research_photo_path.exists():
    with st.expander("研究包表面证据 — Perseverance Sol 518"):
        st.image(str(research_photo_path), caption="真实 Perseverance Mastcam-Z 图像 · Sol 518")
        st.caption("来源与溯源：docs/jezero-research/raw/perseverance-sol518.html")

image_metadata_path = PROJECT_ROOT / "data" / "raw" / "perseverance" / "sol1934_sample.json"
image_evidence = load_surface_image_evidence(image_metadata_path) if image_metadata_path.exists() else None
if image_evidence is not None:
    with st.expander("表面图像证据 — Perseverance"):
        st.image(str(PROJECT_ROOT / image_evidence.local_path), caption=f"Sol {image_evidence.sol} · {image_evidence.instrument} · {image_evidence.attribution}")
        st.caption(f"图像 ID：{image_evidence.image_id}")
        st.markdown(f"[打开 NASA 原图]({image_evidence.url}) · [打开图像页面]({image_evidence.page_url})")

route_reference_path = PROJECT_ROOT / "data" / "raw" / "references" / "curiosity_mount_sharp_path.json"
route_reference = load_route_reference(route_reference_path) if route_reference_path.exists() else None
if route_reference is not None:
    with st.expander("历史路线参考 — Curiosity Mount Sharp"):
        st.image(str(PROJECT_ROOT / route_reference.local_path), caption=route_reference.title)
        st.caption(route_reference.description)
        st.caption(f"数据来源：{', '.join(route_reference.data_sources)}")
        st.caption(f"署名：{route_reference.attribution}")
        st.markdown(f"[打开 NASA 参考页面]({route_reference.url}) · [打开原始素材]({route_reference.asset_url})")

if geology is not None:
    with st.expander("USGS Jezero 地质背景"):
        unit_names = sorted({feature.get("properties", {}).get("name", "Unknown") for feature in geology.features})
        st.metric("已映射地质单元", len(unit_names))
        st.caption(f"{len(geology.features)} 个简化多边形要素 · {geology.crs}")
        st.write(", ".join(unit_names[:12]) + (" …" if len(unit_names) > 12 else ""))
        st.markdown("[打开 USGS SIM 3464](https://doi.org/10.3133/sim3464)")
