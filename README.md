# Calculus Concepts Visualizer

AP Calculus BC visualizer suite built with Python + PyWebView.  
The app opens a launcher with a Calculus subject tab. Units and visualizers sit beside it, so more subjects can be added the same way.

THIS CODE IS CLAIMED BY THE KNIVIER SSP/TOS. Email legal@knivier.com for questions.

## Run Locally

1. Install dependencies:
   - `pip install -r requirements-webapp.txt`
2. Start the app:
   - `python app.py`

## Current Visualizers

- **Unit 1** — Limits (Epsilon-Delta)
- **Unit 2** — Derivatives
- **Unit 3** — Inverse Visualizer
- **Unit 6** — Riemann Sums
- **Unit 8** — Volume Rotation
- **Unit 9** — Parametric Curves, Polar Area
- **Unit 10** — Taylor Series

## Highlights

- **Taylor Series**
  - Animated partial sums with rendered polynomial steps
  - Lagrange error bound + observed error readout on a fixed user window
- **Riemann Sums**
  - Left, right, midpoint, and trapezoidal approximations
  - Error percent uses stable scaling when the true integral is near zero
- **Polar Area**
  - Single-curve and two-curve area shading
  - Angle bounds accept expressions in terms of pi (for example `pi`, `2*pi`, `-pi/2`)
- **Parametric Curves**
  - Velocity vectors, tangent slope, speed, and arc length
- **Inverse Visualizer**
  - Staged animation for `f(x)`, `f^{-1}(x)`, and `(f^{-1})'(x)`
- **Volume Rotation**
  - x-axis and y-axis rotation with area/volume formulas and 3D view controls

## Project Structure

- `app.py` — thin launcher (`python app.py`)
- `src/calcbc/` — Python package (window, routing, graph engine)
- `src/calcbc/subjects/` — one module per subject (Calculus today; add more here)
- `src/calcbc/catalog.py` — subject/visualizer registry used by the home hub
- `src/calcbc/visualizers/` — per-concept backends
- `src/ui/core/` — shared frontend (graph, transitions, nav)
- `src/ui/<visualizer>/` — per-visualizer HTML/JS
- `scripts/build_macos_app.sh` — macOS packaging

## Build

- macOS packaging script: `scripts/build_macos_app.sh`
- PyInstaller spec: `CalcBCVisualizers.spec`

## License

This project is licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.en) (Attribution-NonCommercial-ShareAlike 4.0 International).

Source: [github.com/kdh462009/Calculus-Concepts-Visualizer](https://github.com/kdh462009/Calculus-Concepts-Visualizer)

This software is also covered under the [Knivier SSP/ToS (Open Source Restricted)](https://knivier.com/tos-ssp.html).

## Notes

If a Windows zip from GitHub (or email) will not start, right-click the zip → Properties → check **Unblock** → Apply, then unzip again. Windows marks internet downloads as untrusted, which can block the .NET library pywebview needs.

AI assistance was used for UI acceleration and desktop packaging workflow; calculus logic and feature decisions were authored and validated in-project.
