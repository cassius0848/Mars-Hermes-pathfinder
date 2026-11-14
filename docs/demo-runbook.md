# Judge demo runbook

This runbook defines one repeatable path for local judging, Docker, and Streamlit Community Cloud.

## What is included

The repository contains the real, versioned demo assets required by the UI:

- CTX regional elevation and optical grid for the 40 km Jezero atlas;
- Mars Odyssey THEMIS regional infrared context;
- USGS SIM 3464 geology grid;
- HiRISE Hawksbill Gap DTM, slope, and orthophoto;
- Perseverance image evidence, waypoints, and MEDA probe summaries;
- Curiosity route reference material.

Run python scripts/verify_demo_assets.py before a judging session. It checks required files, the regional manifest SHA-256 values, raster dimensions, CRS compatibility, and the Hawksbill research package.

## Local Windows launch

From the repository root:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run_demo.ps1 -OpenBrowser
~~~

The script creates .venv when needed, installs requirements.txt, verifies the assets, and starts the app at http://localhost:8501.

To use an existing environment without reinstalling:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run_demo.ps1 -SkipInstall -OpenBrowser
~~~

## Local Linux or macOS launch

~~~bash
bash scripts/run_demo.sh
~~~

The same flow is available with SKIP_INSTALL=1 and PORT=8502.

## Docker launch

~~~bash
docker build -t mars-pathfinder-ai .
docker run --rm -p 8501:8501 mars-pathfinder-ai
~~~

Open http://localhost:8501.

## Streamlit Community Cloud

Create an app from the repository with:

- Repository: cassius0848/mars-pathfinder-ai
- Branch: main
- Main file: app/streamlit_app.py

Keep requirements.txt at the repository root and .streamlit/config.toml at the repository root. After deployment, open the generated streamlit.app URL in an incognito window and run the smoke checklist below.

## 3–5 minute judging flow

1. Start on Jezero 区域 · 40 km.
2. Switch between CTX imagery, CTX elevation, Terrain slope, THEMIS infrared, and USGS geology.
3. Toggle the Perseverance traverse and identify the Hawksbill Gap landmark.
4. Click 打开 Hawksbill Gap EVA 规划器.
5. In the local planner, keep the default 80-minute budget and compare the standard and slope-weighted routes.
6. Change the budget to 55 minutes and show the recommended Hazeltop single-stop route.
7. Switch to the orthophoto, elevation profile, and 3D terrain views.
8. Open the science evidence and data-source panels.
9. State clearly that spatial weather, radiation, and life-support capacity are not configured; the demo is a research prototype, not flight-qualified navigation.

## Smoke checklist

- The first page loads without a missing-file error.
- The regional map shows a circular 40 km study boundary.
- The four regional raster layers switch without a rerun error.
- The local planner computes a closed-loop route.
- The route profile and 3D view render.
- The 80-minute and 55-minute scenarios change the recommendation.
- The evidence panels show provenance.
- python scripts/verify_demo_assets.py exits with code 0.
