# Official resource integration plan

The project now records the released resource links in `data/source_catalog.json`.
They are not all the same kind of input: some are data portals, some are map
products, and some are mission-story references. The application must preserve
that distinction.

## Priority order

1. **NASA Mars Trek** — use to identify the local study area, coordinate context,
   and candidate planetary layers. The project now uses the public MOLA
   `ImageServer/exportImage` endpoint to fetch a bounded Jezero DEM sample.
   Prefer documented WMTS/WMS or downloadable products over scraping the
   interactive page.
2. **USGS Astrogeology Mars maps** — use for geologic units and cartographic
   context. Record product name, CRS, resolution, and attribution for every layer.
3. **Perseverance raw images** — use selected surface images as evidence cards at
   science targets and route waypoints. A gallery image is not automatically a
   georeferenced map raster; retain its sol, camera, image ID, and location when
   available.
4. **Curiosity Mount Sharp route** — use as a cited multi-mission route example
   and a design reference for showing science regions along a path. It is not a
   live navigation feed.

## Data adapter contract

Official products should be converted into the shared models in
`mars_pathfinder.models`:

- `TerrainGrid` for elevation DEMs;
- `MapLayer` for aligned optical, thermal, spectral, weather, radiation, or
  other 2D layers;
- `ScienceTarget` for a cited target location and scientific rationale.

Every adapter should return or write metadata containing:

- source URL and product identifier;
- acquisition time / Mars sol when available;
- spatial resolution and coverage;
- CRS and units;
- nodata handling and preprocessing;
- confidence and known limitations.

Large raw files belong in `data/raw/` and should not be committed to Git. The
Streamlit UI can link to the original NASA or USGS record while displaying a
small processed subset locally.

## Current real-data integration

The first real layer is a 256×256 MOLA elevation export covering a bounded
Jezero-area window (`77–78°E`, `18–19°N`, EPSG:104905). The loader converts the
Mars Trek geographic spacing to approximate meters for slope calculation. This
is a development sample, not a complete high-resolution mission map.

The current demo combines this real DEM with synthetic weather and radiation
fixtures so the route pipeline can run end-to-end without implying that those
fixtures are NASA measurements.
