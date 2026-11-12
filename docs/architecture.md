# Architecture notes

Mars Pathfinder AI is organized around a **local astronaut EVA mission**, not a
standalone rover navigation task. The system plans a short surface excursion
from a base to one or more science targets while accounting for terrain,
environmental risk, crew resources, and return safety.

## Layers

1. **Mission definition** — science objective, study area, crew state, EVA time,
   payload, resource reserve, and mobility limits.
2. **Data ingestion** — optical, thermal, spectral, terrain, weather, radiation,
   and chemical layers. Every layer carries source, units, confidence, and time.
3. **Terrain and hazard analysis** — slope, obstacles, traversability, weather
   and radiation masks, and uncertainty flags.
4. **Mission cost** — combines distance, terrain risk, weather, radiation,
   resources, and science value. Safety limits are encoded as impassable cells.
5. **Route planning** — A* or Dijkstra produces a local route to a science
   target; the same interface can later support multiple stops and contingencies.
6. **EVA evaluation** — reports distance, time, slope, resource reserve, science
   stops, and safety status.
7. **Human-facing UI** — shows the selected layer, route, target evidence,
   hazards, and a concise mission report.
8. **AI assistant (optional)** — parses natural-language mission goals and
   explains validated plans. It cannot bypass hard constraints.

## Data contract

`TerrainGrid` is the normalized DEM interface. `MapLayer` stores a 2D layer and
its provenance. `ScienceTarget` stores a location, scientific value, rationale,
and evidence source. `EVAState` and `MissionConstraints` keep crew resources
separate from terrain calculations.

Official resources can be integrated by adding loaders that return these models.
The current synthetic mission is explicitly labeled and exists only to exercise
the interfaces before the official data release.
