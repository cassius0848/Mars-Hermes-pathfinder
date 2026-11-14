"""Streamlit views for the Jezero regional map."""

import json
from pathlib import Path

import numpy as np
import plotly.graph_objects as go
import streamlit as st

from mars_pathfinder.data.jezero_region import (
    JezeroRegion,
    REGIONAL_SLOPE_LIMIT_DEG,
    REGION_CENTER,
    REGION_RADIUS_M,
    grid_axes,
    load_jezero_region,
)


REGIONAL_VIEW = "Jezero region · 40 km"
LOCAL_VIEW = "Hawksbill Gap research package"
LANDING = "Perseverance landing area"
PLACES = {
    LANDING: (77.45088572, 18.44462715),  # First drive localization in the bundled NASA archive
    "Hawksbill Gap": (77.406, 18.4588),
    "Western traverse · Sol 2022": (77.23322287, 18.43559434),
}
LAYERS = {
    "CTX imagery": ("optical", "gray", "图像 DN"),
    "CTX elevation": ("elevation", "Earth", "高程（米）"),
    "Terrain slope": ("slope", "YlOrRd", "坡度（°）"),
    "THEMIS infrared": ("thermal", "Inferno", "红外 DN"),
    "USGS geology": ("geology", "Turbo", "地质单元"),
}

LAYER_LABELS_ZH = {
    "CTX imagery": "CTX 光学影像",
    "CTX elevation": "CTX 高程",
    "Terrain slope": "地形坡度",
    "THEMIS infrared": "THEMIS 红外",
    "USGS geology": "USGS 地质",
}
PLACE_LABELS_ZH = {
    LANDING: "Perseverance 着陆区",
    "Hawksbill Gap": "Hawksbill Gap",
    "Western traverse · Sol 2022": "西部行驶轨迹 · Sol 2022",
    "Custom coordinates": "自定义坐标",
}


@st.cache_data(show_spinner=False)
def load_atlas(project_root: Path):
    region = load_jezero_region(project_root / "data" / "regional" / "jezero-40km")
    waypoint_path = project_root / "docs" / "jezero-research" / "raw" / "perseverance-waypoints.json"
    data = json.loads(waypoint_path.read_text(encoding="utf-8"))
    records = [feature for feature in data["features"] if feature["geometry"]]
    coordinates = [record["geometry"]["coordinates"][:2] for record in records]
    x, y = region.region_xy(*zip(*coordinates))
    inside = np.hypot(x, y) <= REGION_RADIUS_M
    sols = np.array([int(record["properties"]["sol"]) for record in records])
    # NaN breaks the trace if a future archive has a waypoint outside the circle.
    return region, np.where(inside, x, np.nan), np.where(inside, y, np.nan), sols


@st.cache_data(show_spinner=False, max_entries=16)
def find_corridor(_region: JezeroRegion, start, goal):
    return _region.plan_corridor(start, goal)


def open_local_planner():
    st.session_state["study_area"] = LOCAL_VIEW


def render_jezero_atlas(project_root: Path):
    region, rover_x, rover_y, rover_sols = load_atlas(project_root)
    st.title("Jezero 陨石坑")
    st.caption(
        f"半径 {REGION_RADIUS_M / 1000:.0f} km · {REGION_CENTER[0]:.2f}°E，{REGION_CENTER[1]:.2f}°N · Mars 2020"
    )
    controls, map_column = st.columns([1, 3], gap="large")

    with controls:
        layer = st.selectbox("地图图层", LAYERS, format_func=lambda value: LAYER_LABELS_ZH.get(value, value))
        show_traverse = st.toggle("显示 Perseverance 行驶轨迹", value=True)
        if show_traverse:
            st.caption(f"归档航点 · {np.count_nonzero(np.isfinite(rover_x)):,} · 截止 Sol {rover_sols.max()}")
        st.button("打开 Hawksbill Gap EVA 规划器", on_click=open_local_planner, type="primary")

        st.subheader("区域路线筛选")
        st.caption(
            f"100 米地形网格 · {REGIONAL_SLOPE_LIMIT_DEG:g}° 筛选上限。"
            "局部 EVA 规划器用于评估具体步行路线。"
        )
        start_name = st.selectbox("起点", [*PLACES, "Custom coordinates"], format_func=lambda value: PLACE_LABELS_ZH.get(value, value))
        goal_name = st.selectbox("终点", [*PLACES, "Custom coordinates"], index=1, format_func=lambda value: PLACE_LABELS_ZH.get(value, value))
        with st.form("regional_corridor"):
            endpoints = []
            for label, place, default in (("起点", start_name, LANDING), ("终点", goal_name, "Hawksbill Gap")):
                if place in PLACES:
                    endpoints.append(PLACES[place])
                else:
                    lon, lat = PLACES[default]
                    endpoints.append((
                        st.number_input(f"{label}经度 °E", 0.0, 360.0, lon, format="%.5f"),
                        st.number_input(f"{label}纬度 °N", -90.0, 90.0, lat, format="%.5f"),
                    ))
            if st.form_submit_button("计算区域走廊"):
                st.session_state["regional_endpoints"] = endpoints

        result = None
        if st.session_state.get("regional_endpoints") == endpoints:
            start, goal = (region.region_xy(*point) for point in st.session_state["regional_endpoints"])
            try:
                with st.spinner("正在 CTX 地形上计算…"):
                    result = find_corridor(region, start, goal)
            except ValueError as error:
                st.warning(f"无法计算路线：{error}")
            if result is not None:
                _, _, distance, max_slope = result
                st.metric("走廊长度", f"{distance / 1000:.2f} km")
                st.caption(f"100 米网格最大坡度 · {max_slope:.1f}°")

    with map_column:
        st.plotly_chart(regional_map(region, layer, rover_x, rover_y, rover_sols, show_traverse, result),
                         key="jezero_regional_map", use_container_width=True)
        key = LAYERS[layer][0]
        detail = {
            "optical": "NASA Mars Trek CTX WMTS 第 9 级 · 显示网格 100 米",
            "elevation": "USGS/JPL CTX DEM 源分辨率 20 米 · 100 米网格平均高程",
            "slope": "由 100 米 CTX 高程派生的坡度",
            "thermal": "Mars Odyssey THEMIS，标称 100 米 · 相对红外强度",
            "geology": "USGS SIM 3464，出版比例尺 1:75,000 · 空白区域不属于已映射单元",
        }
        st.caption(f"{detail[key]} · 圆形区域内有效覆盖率 {region.coverage[key]:.2f}%")
    with st.expander("数据来源"):
        st.markdown(
            "[NASA Mars Trek CTX](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars) · "
            "[USGS CTX terrain](https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic) · "
            "[USGS SIM 3464 geology](https://pubs.usgs.gov/publication/sim3464) · "
            "[Mars Odyssey THEMIS](https://stac.astrogeology.usgs.gov/docs/data/mars/themis_controlled_mosaics/) · "
            "[NASA Perseverance traverse](https://science.nasa.gov/mission/mars-2020-perseverance/location-map/)"
        )


def regional_map(region, layer, rover_x, rover_y, rover_sols, show_traverse, result):
    x, y = grid_axes(region.transform, region.elevation.shape)
    key, colorscale, unit = LAYERS[layer]
    values = getattr(region, key)
    bar = {"title": unit, "len": 0.84, "thickness": 12}
    note = None
    value_hover = f"{unit} %{{z:.1f}}"
    if key == "geology":
        codes = list(region.units)
        bar.update(tickvals=codes, ticktext=[f"{code} · {region.units[code]}" for code in codes])
        edges = np.linspace(0, 1, len(codes) + 1)
        palette = ["#a28a65", "#d19562", "#e7c98d", "#82936e", "#b56d5a", "#677e8d", "#846882",
                   "#727a79", "#c1ab7c", "#6b9aa1", "#80694e", "#a6aa70", "#ad8262", "#cf7b79", "#75a196"]
        colorscale = [(edge, palette[index % len(palette)]) for index in range(len(codes)) for edge in edges[index:index + 2]]
        note = {"zmin": min(codes) - 0.5, "zmax": max(codes) + 0.5}
        value_hover = "Unit %{z:.0f} · see legend"
    figure = go.Figure(go.Heatmap(
        x=x / 1000, y=y / 1000, z=values, colorscale=colorscale,
        showscale=key != "optical", colorbar=bar, hoverongaps=False,
        hovertemplate=f"东向 %{{x:.1f}} 千米，北向 %{{y:.1f}} 千米<br>{value_hover}<extra></extra>",
        **(note or {}),
    ))
    angle = np.linspace(0, 2 * np.pi, 361)
    radius = REGION_RADIUS_M / 1000
    figure.add_trace(go.Scatter(x=radius * np.cos(angle), y=radius * np.sin(angle), mode="lines",
                                line={"color": "#e6c19e", "width": 1}, name="研究边界", hoverinfo="skip"))
    if show_traverse:
        figure.add_trace(go.Scatter(
            x=rover_x / 1000, y=rover_y / 1000, customdata=rover_sols, mode="lines+markers",
            line={"color": "#ffb057", "width": 2}, marker={"size": 3}, name="毅力号轨迹",
            hovertemplate="毅力号 · Sol %{customdata}<extra></extra>",
        ))
    place_x, place_y = region.region_xy(*zip(*PLACES.values()))
    figure.add_trace(go.Scatter(
        x=np.asarray(place_x) / 1000, y=np.asarray(place_y) / 1000, text=list(PLACES),
        mode="markers", marker={"color": "#fff2da", "line": {"color": "#281d18", "width": 1.5}, "size": 9},
        hovertemplate="%{text}<extra></extra>", name="任务地标",
    ))
    if result is not None:
        cx, cy, _, _ = result
        figure.add_trace(go.Scatter(
            x=np.asarray(cx) / 1000, y=np.asarray(cy) / 1000, mode="lines",
            line={"color": "#62e3d0", "width": 3}, name="计算走廊", hoverinfo="skip",
        ))
        figure.add_trace(go.Scatter(
            x=np.asarray([cx[0], cx[-1]]) / 1000, y=np.asarray([cy[0], cy[-1]]) / 1000,
            text=["走廊起点", "走廊终点"], mode="markers",
            marker={"color": "#62e3d0", "size": 10, "symbol": ["circle", "square"]},
            hovertemplate="%{text}<extra></extra>", showlegend=False,
        ))
    figure.update_layout(
        height=650, margin={"l": 48, "r": 22, "t": 8, "b": 60}, plot_bgcolor="#191719",
        legend={"orientation": "h", "yanchor": "top", "y": -0.16}, uirevision=REGIONAL_VIEW,
        xaxis={"title": "东向 · 千米", "range": [-42, 42], "showgrid": False, "zeroline": False, "constrain": "domain"},
        yaxis={"title": "北向 · 千米", "range": [-42, 42], "showgrid": False, "zeroline": False,
               "scaleanchor": "x", "scaleratio": 1, "constrain": "domain"},
    )
    return figure
