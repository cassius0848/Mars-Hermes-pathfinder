# One source and one published build

The canonical application source is the `main` branch of https://github.com/cassius0848/mars-pathfinder-ai . The public demonstration is https://mars-pathfinder-jezero.fengboyuan030509.chatgpt.site/atlas?area=jezero . The Sites repository is a deployment wrapper for checked build output, not a separate application-development branch.

## Build and verify

Run `python scripts/build_web.py`, followed by `node --test tests/*.test.mjs` and the Python test suite. The exporter verifies the real terrain packages and the compressed TES/OpenMARS archive. It writes `dist/build-info.json` with the source commit, a platform-independent source fingerprint, and checksums for every published file.

GitHub Actions runs these checks and uploads the `mars-pathfinder-web` artifact. Only deploy an artifact whose `build-info.json.source_commit` matches the selected main-branch commit. Verify the per-file checksums after extraction. For local source ZIPs without Git metadata, the commit is explicitly null; those builds are not authoritative releases.

## Publish

1. Merge the reviewed and passing application change into `main`.
2. Download the successful main-branch workflow's `mars-pathfinder-web` artifact.
3. Verify the archive and its `build-info.json` manifest.
4. Open the existing Sites source using its source workflow and preserve `.openai/hosting.json` and the current public audience.
5. Replace the deployment wrapper's `dist` with that exact checked artifact, then package and publish it through Sites.
6. Confirm successful deployment and the live `/build-info.json` source commit. Do not independently edit built files without returning their changes to the canonical source.

The hosting repository and GitHub repository have different Git identities. The application version is identified by the GitHub `source_commit` embedded in the published build, together with its artifact checksum.

## Data provenance

`web/atlas-regional.json` records TES, OpenMARS and solar-model provenance and the SHA-256 of `web/atlas-regional.bin.gz`. This compressed, processed bundle is checked in so normal builds do not download full raw planetary rasters. Regenerating it with `scripts/build_atlas_environment.py` additionally requires the original documented inputs, `numcodecs` and `zstandard`. The ordinary terrain/web build does not require those regeneration dependencies.

The interface keeps its actual resolutions explicit: 1 m local packages for Hawksbill Gap/Neretva Vallis, 100 m Jezero cached terrain, online CTX 20 m terrain and coarse MOLA corridors. Pixel or grid spacing is not a positioning-accuracy claim.
