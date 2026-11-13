# Data layout

- `raw/`: original downloads; do not commit large files.
- `processed/`: normalized, cropped outputs used by the application.

For every dataset, record source URL, version/date, coverage, resolution, CRS,
units, nodata definition, preprocessing steps, and known limitations.

## Included development sample

`raw/jezero_mola_256.tif` is a bounded 256×256 elevation sample exported from
the NASA Mars Trek MOLA ImageServer for a Jezero-area window. It is small enough
for development and is accompanied by `raw/jezero_mola_256.json` metadata.
Regenerate it with:

```bash
python scripts/fetch_resources.py
```

The Streamlit demo uses this real DEM when the file is present. Weather and
radiation layers remain explicitly synthetic until matching official products
are selected and documented.

## Perseverance surface evidence

`raw/perseverance/sol1934_sample.jpg` is a 480×480 browse image linked from the
NASA Mars 2020 raw-image page. Its Sol, instrument, image ID, source URL, and
attribution are stored in the adjacent JSON metadata. It is used as visual
evidence in the Streamlit route report, not as a georeferenced raster layer.

## Curiosity route reference

`raw/references/curiosity_mount_sharp_path.gif` is NASA's 12-frame proposed-route
animation for Curiosity's climb up lower Mount Sharp. Its metadata records the
HiRISE, CRISM, CTX, and HRSC sources and attribution. The app shows it as
historical mission context, not as a live astronaut navigation path.

## USGS Jezero geology

`raw/usgs/jezero_geologic_units_100m.geojson` is a simplified GeoJSON export
of the 1:75,000 USGS SIM 3464 Jezero and Nili Planum geologic map. It contains
1,308 polygon features and selected unit attributes. The simplified layer is
used for science-target context and is not yet rasterized into the route cost
surface.
