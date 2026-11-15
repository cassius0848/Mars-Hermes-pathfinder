# Integrated science mission workflow

The default homepage remains the online atlas. Existing planning modes, ordered
waypoints, constraints, exports, real terrain, 3D extents, first-person view and
the compact mission layout remain available.

## Implemented checklist

1. **Linked data visualization.** TES thermal inertia, OpenMARS surface temperature
   and pressure, modeled solar irradiance and historical MEDA references have
   interactive profiles. The cursor follows simulation time and can seek the map
   and playback. Atlas route colors also carry into 3D. Missing values stay gaps;
   model/interpolated/reference intervals are marked. Original source links and
   CSV links remain in the data panel.
2. **Objective and science-stop selection.** Local mission settings accept a
   research question, optional/required/ignored real science points, user priorities
   and dwell times. All subsets and orders of at most four selected targets are
   compared, using the existing route profiles. Required points are never silently
   dropped. Feasible candidates rank by user priority sum, then time and slope;
   omitted targets have explanations. User scores are not NASA science ratings,
   and this bounded candidate search is not a global continuous-terrain optimum.
3. **Field cards.** Each real target includes evidence imagery, a research task,
   coordinate-offset caveat, execution status and notes. Notes persist locally and
   are included in task JSON/ZIP exports; observing or sampling is recorded by the
   user, never inferred merely from animation arrival.
4. **Status updates.** During mission playback, extra stop time, revised speed,
   current resource quantities and simulated local solar time can trigger a replan
   from the current point. Finished stops stay finished. A sunlight override exits
   the fixed historical environmental scenario instead of pretending it is live
   weather. Events are exported. Existing closure and return actions are retained.
5. **Data quality.** Along-route availability, source spacing, interpolation and
   historical/model labels accompany the graphs. Grid spacing does not imply
   equivalent astronaut localization accuracy. Radiation remains unevaluated;
   modeled sunlight and UV are not ionizing-radiation dose.
6. **Resources and offline operation.** Optional oxygen (g), battery (Wh) and water
   (mL) budgets use user-supplied capacity, moving/working rates and reserves.
   Consumption includes return travel and scientific work. Replanning keeps the
   original absolute reserve. Unconfigured resources are unevaluated. The demo
   preset is an arbitrary team assumption, not a suit specification. A configurable
   load/speed penalty is also an assumption, with zero penalty by default.

## Operation

On a local mission page, expand **科学目标、环境与资源**. Manual waypoint mode is the
default. Automatic science mode preserves the start/return point and generates
science stops instead of retaining manually selected waypoint order. Set priorities
and any mandatory stations, choose an optional historical environment scenario,
then calculate. Open the environmental curves to inspect or seek a route position.

The resource/quality summary expands for detailed estimates and opens when a
resource exceeds its configured allowance. Reference estimation can animate a
noncompliant route, preserving its violation flags. Strict planning does not label
such a route executable.

## Offline package

Expand **离线任务与记录** and save the current mission. Files are downloaded from the
same release and SHA-256 checked against build-info.json before activation. Each
package includes common application files, the selected terrain/imagery/evidence,
environment archives and task.json. Other local terrain areas are omitted.
Packages have a 64 MiB limit. A failed save cannot activate a partial cache.

The saved browser can reload its selected mission without a network connection.
The ZIP is portable: unzip, run `python -m http.server 8000`, and open the URL in
OFFLINE-README.txt. Task import revalidates points and recomputes paths; it never
trusts a saved reference path as fresh navigation or resumes assumed live location.
New online tiles, external source pages and new remote elevation queries require
network access. Local notes and event records are not transmitted to a server.

## Validation scope

Tests cover scientific subset/order selection, mandatory points, resource-induced
selection changes, work/travel accounting, preserved resource reserves, sampled
coverage, ZIP integrity primitives and the existing navigation regressions.
Historical/reference physical units, gaps, interpolation flags and 3D color reset
behavior have dedicated regression cases.
