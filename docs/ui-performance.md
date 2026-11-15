# Interface and runtime changes

The online atlas remains the default homepage. The mission planner remains at
`mission.html`, including legacy entry links and saved mission state.

## Workflow

- Select an area from one region selector, then select the start and destination
  directly on their coordinate cards. Waypoints, reverse planning and clear are
  adjacent actions. Reverse planning also reverses waypoint order and requires a
  fresh calculation.
- Walking limits, environment scenarios and weights remain available in native
  expandable sections. Summaries show the active limits and environment. Invalid
  form inputs expand their containing section before correction.
- Playback, perspective, speed and progress remain immediately accessible.
  Terrain extent, surrounding radius, imagery style, mesh lines and vertical scale
  are in the three-dimensional display settings. Follow mode is available from the
  perspective selector alongside overview and astronaut view.
- Mission planning keeps both calculation modes, ordered stops and dwell times,
  constraints, diagnostics, science points, localization, reference playback and
  exports. Detailed metrics and data sources expand on demand.

## Runtime

Canvas updates are coalesced to one animation-frame callback using the latest
state. Three-dimensional projection matrices update only when their inputs change.
Scale and perspective changes update existing route vertices and station heights;
station objects and label textures are retained.

Completed planning grids, surrounding grids and imagery canvases use separate
bounded LRU caches (24 MiB/3 entries, 16 MiB/2 entries and 20 MiB/2 entries).
Keys preserve exact coordinates, source mode, extent and grid geometry. Aborted
requests still reject; failed or aborted operations are not cached. Reloading the
page clears these in-memory caches. First loads still require upstream services.

HiRISE tiles load automatically when the map span reaches 0.25 degrees or less.
Broader views use the existing CTX/global imagery. Numerical elevation resolution,
terrain mesh sampling and route algorithms are unchanged.

## Validation

All 40 Node regression tests pass, covering route constraints, exact anchors,
waypoints and return legs, terrain gaps, source recovery, environment metrics,
camera behavior, cancellation, cache limits and in-place scene updates.

Browser checks covered the Jezero example, surrounding terrain, route-only terrain,
vertical scale, astronaut playback, reverse planning, Gale source recovery and the
Hawksbill 1 m mission with a science waypoint and return leg. No console errors
were observed.

A local warm-cache measurement repeated identical elevation queries 12 times using
fixed real HRSC TIFF bytes: the previous loader performed 12 export requests; the
updated loader performed zero after warm-up. Elevation arrays matched exactly.
This isolates repeated grid loading; it is not an end-to-end website speed claim.
