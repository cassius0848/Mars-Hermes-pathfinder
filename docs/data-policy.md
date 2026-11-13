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
