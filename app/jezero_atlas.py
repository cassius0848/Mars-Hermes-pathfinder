"""Streamlit views for the Jezero regional map."""

import json
from pathlib import Path

import numpy as np
import plotly.graph_objects as go
import streamlit as st
from pyproj import Transformer

from mars_pathfinder.data.jezero_region import (
    JezeroRegion,
    REGIONAL_SLOPE_LIMIT_DEG,
    REGION_CENTER,
    REGION_CRS,
    REGION_RADIUS_M,
    grid_axes,
    load_jezero_region,
)
from mars_pathfinder.data.research import NERETVA_CENTER, NERETVA_CRS, NERETVA_WIDTH_M


REGIONAL_VIEW = "Jezero region · 40 km"
LOCAL_VIEW = "Hawksbill Gap research package"
NERETVA_VIEW = "Neretva Vallis · Bright Angel"
LANDING = "Perseverance landing area"
PLACES = {
    LANDING: (77.45088572, 18.44462715),  # First drive localization in the bundled NASA archive
    "Hawksbill Gap": (77.406, 18.4588),
    NERETVA_VIEW: NERETVA_CENTER,
    "Lookout Hill · Sol 1354": (77.26852677, 18.45752781),
    "Western traverse · Sol 2022": (77.23322287, 18.43559434),
}
LAYERS = {
    "CTX imagery": ("optical", "gray", "Image DN"),
    "CTX elevation": ("elevation", "Earth", "Elevation (m)"),
    "Terrain slope": ("slope", "YlOrRd", "Slope (°)"),
    "THEMIS infrared": ("thermal", "Inferno", "Infrared DN"),
    "USGS geology": ("geology", "Turbo", "Geologic unit"),
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


def open_local_planner(view):
    st.session_state["study_area"] = view


def render_jezero_atlas(project_root: Path):
    region, rover_x, rover_y, rover_sols = load_atlas(project_root)
    st.title("Jezero Crater")
    st.caption(
        f"{REGION_RADIUS_M / 1000:.0f} km radius · {REGION_CENTER[0]:.2f}°E, {REGION_CENTER[1]:.2f}°N · Mars 2020"
    )
    controls, map_column = st.columns([1, 3], gap="large")

    with controls:
        layer = st.selectbox("Map layer", LAYERS)
        show_traverse = st.toggle("Perseverance traverse", value=True)
        if show_traverse:
            st.caption(f"Archived points · {np.count_nonzero(np.isfinite(rover_x)):,} · through Sol {rover_sols.max()}")
        st.button("Open Hawksbill Gap EVA planner", on_click=open_local_planner, args=(LOCAL_VIEW,), type="primary")
        st.button("Open Neretva Vallis EVA planner", on_click=open_local_planner, args=(NERETVA_VIEW,))

        st.subheader("Regional route screening")
        st.caption(
            f"100 m terrain cells · {REGIONAL_SLOPE_LIMIT_DEG:g}° screening limit. "
            "Use the local EVA planner to assess individual walking routes."
        )
        start_name = st.selectbox("Start", [*PLACES, "Custom coordinates"])
        goal_name = st.selectbox("Destination", [*PLACES, "Custom coordinates"], index=1)
        with st.form("regional_corridor"):
            endpoints = []
            for label, place, default in (("Start", start_name, LANDING), ("Destination", goal_name, "Hawksbill Gap")):
                if place in PLACES:
                    endpoints.append(PLACES[place])
                else:
                    lon, lat = PLACES[default]
                    endpoints.append((
                        st.number_input(f"{label} longitude °E", 0.0, 360.0, lon, format="%.5f"),
                        st.number_input(f"{label} latitude °N", -90.0, 90.0, lat, format="%.5f"),
                    ))
            if st.form_submit_button("Calculate corridor"):
                st.session_state["regional_endpoints"] = endpoints

        result = None
        if st.session_state.get("regional_endpoints") == endpoints:
            start, goal = (region.region_xy(*point) for point in st.session_state["regional_endpoints"])
            try:
                with st.spinner("Calculating across the CTX terrain…"):
                    result = find_corridor(region, start, goal)
            except ValueError as error:
                st.warning(str(error))
            if result is not None:
                _, _, distance, max_slope = result
                st.metric("Corridor length", f"{distance / 1000:.2f} km")
                st.caption(f"Maximum slope on the 100 m grid · {max_slope:.1f}°")

    with map_column:
        st.plotly_chart(regional_map(region, layer, rover_x, rover_y, rover_sols, show_traverse, result),
                         key="jezero_regional_map", use_container_width=True)
        key = LAYERS[layer][0]
        detail = {
            "optical": "NASA Mars Trek CTX WMTS level 9 · display grid 100 m",
            "elevation": "USGS/JPL CTX DEM source 20 m · mean elevation in 100 m cells",
            "slope": "Slope derived from 100 m CTX elevation",
            "thermal": "Mars Odyssey THEMIS, nominal 100 m · relative infrared intensity",
            "geology": "USGS SIM 3464, publication scale 1:75,000 · blank areas are outside mapped units",
        }
        st.caption(f"{detail[key]} · {region.coverage[key]:.2f}% valid inside the circle")
    with st.expander("Data sources"):
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
        hovertemplate=f"East %{{x:.1f}} km, North %{{y:.1f}} km<br>{value_hover}<extra></extra>",
        **(note or {}),
    ))
    angle = np.linspace(0, 2 * np.pi, 361)
    radius = REGION_RADIUS_M / 1000
    figure.add_trace(go.Scatter(x=radius * np.cos(angle), y=radius * np.sin(angle), mode="lines",
                                line={"color": "#e6c19e", "width": 1}, name="Study boundary", hoverinfo="skip"))
    if show_traverse:
        figure.add_trace(go.Scatter(
            x=rover_x / 1000, y=rover_y / 1000, customdata=rover_sols, mode="lines+markers",
            line={"color": "#ffb057", "width": 2}, marker={"size": 3}, name="Perseverance",
            hovertemplate="Perseverance · Sol %{customdata}<extra></extra>",
        ))
    place_x, place_y = region.region_xy(*zip(*PLACES.values()))
    figure.add_trace(go.Scatter(
        x=np.asarray(place_x) / 1000, y=np.asarray(place_y) / 1000, text=list(PLACES),
        mode="markers", marker={"color": "#fff2da", "line": {"color": "#281d18", "width": 1.5}, "size": 9},
        hovertemplate="%{text}<extra></extra>", name="Mission landmarks",
    ))
    extent = NERETVA_WIDTH_M / 2
    edge = [-extent, extent, extent, -extent, -extent]
    footprint_x, footprint_y = Transformer.from_crs(NERETVA_CRS, REGION_CRS, always_xy=True).transform(
        edge, [-extent, -extent, extent, extent, -extent],
    )
    figure.add_trace(go.Scatter(
        x=np.asarray(footprint_x) / 1000, y=np.asarray(footprint_y) / 1000, mode="lines",
        line={"color": "#62e3d0", "width": 2}, name="Neretva walking area", hoverinfo="skip",
    ))
    if result is not None:
        cx, cy, _, _ = result
        figure.add_trace(go.Scatter(
            x=np.asarray(cx) / 1000, y=np.asarray(cy) / 1000, mode="lines",
            line={"color": "#62e3d0", "width": 3}, name="Computed corridor", hoverinfo="skip",
        ))
        figure.add_trace(go.Scatter(
            x=np.asarray([cx[0], cx[-1]]) / 1000, y=np.asarray([cy[0], cy[-1]]) / 1000,
            text=["Corridor start", "Corridor destination"], mode="markers",
            marker={"color": "#62e3d0", "size": 10, "symbol": ["circle", "square"]},
            hovertemplate="%{text}<extra></extra>", showlegend=False,
        ))
    figure.update_layout(
        height=650, margin={"l": 48, "r": 22, "t": 8, "b": 60}, plot_bgcolor="#191719",
        legend={"orientation": "h", "yanchor": "top", "y": -0.16}, uirevision=REGIONAL_VIEW,
        xaxis={"title": "East · km", "range": [-42, 42], "showgrid": False, "zeroline": False, "constrain": "domain"},
        yaxis={"title": "North · km", "range": [-42, 42], "showgrid": False, "zeroline": False,
               "scaleanchor": "x", "scaleratio": 1, "constrain": "domain"},
    )
    return figure
