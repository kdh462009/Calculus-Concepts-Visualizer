# Calculus Concepts Visualizer

AP Calculus BC visualizer suite built with Python + PyWebView.  
The app opens a launcher home screen and lets you jump into interactive visualizers by unit.

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

- `app.py` — launcher + routing to all visualizers
- `graph.py` — shared graphing/parsing/sampling helpers
- `ui/core/` — shared frontend graph + transition utilities
- `ui/<visualizer>/` — per-visualizer frontend
- `<visualizer>.py` — per-visualizer backend API

## Build

- macOS packaging script: `build_macos_app.sh`
- PyInstaller spec: `CalcBCVisualizers.spec`

## Notes

AI assistance was used for UI acceleration and desktop packaging workflow; calculus logic and feature decisions were authored and validated in-project.
