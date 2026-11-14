# Real-data integration policy

The primary planning path must be driven by documented NASA or USGS products.
Synthetic values are allowed only for isolated algorithm tests and UI fallback.
They must carry a `synthetic-demo` source label and must never be described as
observations or used to train a science model.

## Current inventory

### Real data already used by the application

- NASA Mars Trek MOLA DEM for Jezero and the supplied alternate bookmark;
- NASA Mars Trek Viking MDIM21 optical export for the Jezero window;
- USGS SIM 3464 Jezero geologic-unit GeoJSON;
- Perseverance Sol 1934 SHERLOC_WATSON browse image;
- Curiosity Mount Sharp proposed-route animation.

The MOLA DEM drives elevation, slope, and route costs. The optical mosaic is a
real visual context layer. USGS polygons generate science-target candidates. The
Perseverance image and Curiosity animation are evidence and mission-context
assets, not georeferenced route-cost layers.

### Data not yet selected

No official weather or radiation product has been selected for the current
study area. The real-data app therefore uses neutral zero-risk arrays and labels
the layers as unavailable. It does not generate fake weather or radiation
observations. A future official product must include acquisition time / Sol,
spatial coverage, units, uncertainty, and a reproducible adapter before it can
change route costs.

## Training and modeling rule

The current planner is deterministic and does not train an AI model. If a future
model is added, training and calibration datasets must be real, cited products
or real mission telemetry. Synthetic fixtures may test code paths but cannot be
mixed into the training set without an explicit experiment label and separate
metrics.

Every derived layer must retain its source, transformation, CRS, resolution,
units, nodata behavior, and limitations. Large source archives stay outside Git;
small reproducible samples and their download scripts may be committed.

## Current route-weight audit

For the real-data Streamlit path, the cost configuration is explicit:

- MOLA terrain / slope: weight `1.0`;
- USGS-derived science target: weight `0.5` at the selected target cell;
- weather: weight `0.0` until an official weather layer is selected;
- radiation: weight `0.0` until an official radiation layer is selected.

This prevents unavailable environment layers from silently influencing the route
while ensuring the real terrain and geology-derived target drive the planner.


## Hawksbill Gap research package

The teammate archive under `docs/jezero-research/` is now an optional real-data
mode in Streamlit. It consumes the local 2 m HiRISE DTM, derived slope, aligned
orth-up orthophoto, THEMIS regional context, USGS local geology, and the PDS /
Perseverance evidence points. The archived route preview remains a validation
reference; the live route is recomputed by the current planner.

MEDA samples are summarized in the research mode as time-series evidence and are
not broadcast to every pixel or used as a fake spatial weather grid. Weather and radiation weights stay neutral
until an appropriate spatial-temporal model is implemented.


## EVA resource model status

The planner no longer converts route time into an unlabeled resource fraction. It
reports the route and science-stop time, then marks resource safety as
`unconfigured` unless both a metabolic rate and a mission resource budget with
units and source are supplied. NASA EVA references are recorded in
`docs/eva-resource-sources.md`; heritage values are not treated as Mars suit
requirements.


## On-demand official services

The Streamlit demo reads selected official services on demand:

- NASA Perseverance Raw Images RSS JSON returns a small page of current image metadata and remote thumbnail URLs;
- NASA Mars Trek MOLA ImageServer provides bounded export URLs for the selected view;
- USGS SIM 3464 FeatureServer returns a bounded GeoJSON query for live geology context;
- NASA Science provides the Curiosity Mount Sharp route page and original GIF as a remote reference.

These requests are cached briefly in memory by Streamlit and are not copied into the repository. The local regional package remains the reproducible route-planning substrate so the A* corridor and EVA calculations run offline. Remote services enrich current evidence and provenance; they do not silently replace the validated local route grid.
