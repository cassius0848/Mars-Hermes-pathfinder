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
