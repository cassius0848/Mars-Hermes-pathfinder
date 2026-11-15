# Atlas coordinates and terrain playback

The atlas preserves selected longitude/latitude as exact projected anchors. Its A* search still uses measured terrain cells, but the first and last segments reach the actual anchors rather than moving the pins to cell centres. Ordered waypoints and return legs use the same geometry. Distances, ascent/descent, interpolated elevations, time estimates and playback all include these segments. Missing elevation at an anchor is diagnosed; points are not silently moved into another cell.

The reported western/southern Jezero examples (76.80408 E / 18.12523 N to 76.87676 E / 18.12152 N, and the other screenshot pairs in the regression suite) are outside the existing local CTX/HiRISE packages. Previously they fell back to a 1 km MOLA planning grid, causing visible endpoint quantisation and sparse meshes.

Automatic routing now uses the NASA-hosted USGS HRSC/MOLA blended DEM outside fine-terrain coverage. Its native sampling is about 200 m; portions originate from coarser MOLA data. This is a regional terrain product, not metre-scale obstacle mapping. Explicit MOLA mode remains available. The application requests only the required numerical TIFF window, validates its layout/georeferencing, and retains missing-data holes.

Source service:
https://trek.nasa.gov/mars/trekarcgis/rest/services/Mars_MOLA_blend200ppx_HRSC_DEM_clon0dd_200mpp_lzw/ImageServer

Product background:
https://fdp.astrogeology.usgs.gov/fdp/mars/

The surroundings view renders route terrain immediately, then requests a wider context extending 8, 16 or 32 km beyond the route bounds. CTX context is used where coverage is sufficient; the cache and global HRSC/MOLA/MOLA sources provide fallbacks. A failed context request keeps a usable route mesh and displays its reason. Display sampling adapts to the requested extent and has a bounded mesh budget; its actual spacing is shown independently of the planning grid. Orbit-camera clipping planes account for camera distance, including short routes on coarse terrain. Destination markers use screen-sized sprites independent of grid spacing and camera distance.

The first-person camera follows the same continuous route at 1.7 m above the rendered measured surface, faces the direction of travel, and allows dragging to look around. It forces a true vertical scale of 1 and restores the previous scale on exit. Playback supports real walking time, 10x, 60x, and the original 36-second overview demo. Entering first person changes the compressed overview demo to 10x; the selected speed remains explicit. This is an orbital-DEM-based terrain simulation; it cannot reproduce rocks, slopes or textures finer than the underlying observations.

Validation: `node --test tests/*.test.mjs`. The regression suite covers screenshot coordinates at 200 m and 1 km, exact waypoint/return playback, missing anchor data, metric continuity, context bounds, constant marker sizing, overview camera clipping and first-person camera height/headings. Browser QA uses the coordinate-entry controls to exercise the supplied locations against the live NASA numerical elevation service.
