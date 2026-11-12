# Architecture notes

The current scaffold uses a stable `TerrainGrid` model between ingestion and
analysis. Synthetic and raster DEM loaders produce the same model, so official
resources can be added without changing the routing API.

The first integration point for the official release is
`mars_pathfinder.data.loaders.load_raster`. Weather, rover state, and science
points should later be represented as separate validated models and combined in
the routing cost layer.
