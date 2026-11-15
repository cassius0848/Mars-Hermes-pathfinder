# Navigation audit — 2026-11-15

Baseline: `994a059d41bca4a810a76bc462de56aac950d039`.

## Reproduced and fixed

- Importing a task reported success but reset automatic science selection to manual and changed excluded targets back to optional. The importer now restores the selection mode, required and excluded targets, dwell times and priorities, matching registered cells before display names. Regional maps still disable automatic local science selection.
- Task packages omitted manual solar time and season. These settings are now included in the exported configuration and restored only when they match supported controls. Older packages retain the existing defaults because they never recorded this information.
- The elevation profile sampled cell centers while navigation used the exact selected route coordinates. Both now use the same bilinear elevation sampler. Missing elevation renders as a gap or a no-data message, without fabricated zero values or NaN axis labels.

## Validation

The original 52 JavaScript tests passed before changes. Focused regressions reproduced the profile and restore failures before the fixes. All 55 JavaScript checks pass after the changes, along with three local Python release-manifest tests. Baseline GitHub CI also passed its full 31-test Python suite. The local system lacks the scientific Python dependencies, so that full suite was verified in CI instead of being represented as a local run.

Browser checks covered Jezero calculation with three candidates, elevation and environmental panels, 3D and first-person views, and scrubbing to arrival. An exported Hawksbill task reproduced lost automatic/excluded settings. After the fix, the same restore path retained automatic mode, a required and an excluded station, 06:45 solar time and 90-degree season; its route calculated and the 3D round trip reached base. Scrubbing backward re-enabled playback.

Remote terrain/imagery availability, certified EVA safety and real astronaut positioning remain outside this regression result. A passing audit does not establish that every possible input is bug-free.
