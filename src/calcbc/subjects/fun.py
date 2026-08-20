"""Fun subject catalog - playground visualizers outside the calculus sequence."""

SUBJECT = {
    "id": "fun",
    "title": "Fun",
    "subtitle": "playground",
    "symbol": "∮",
    "order": 2,
    "unitChips": {
        "1": "Fourier",
        "2": "Monte Carlo",
    },
    "visualizers": [
        {
            "id": "fourier",
            "unit": 1,
            "unitTitle": "Fourier Playground",
            "title": "Epicycles",
            "subtitle": "Draw a closed curve; rotating phasors rebuild $z(θ) ≈ Σ cₖ e^{ikθ}$",
            "symbol": "Σcₖ",
            "path": "ui/fourier/index.html",
            "beta": True,
        },
        {
            "id": "monte_carlo",
            "unit": 2,
            "unitTitle": "Monte Carlo Integration",
            "title": "Monte Carlo",
            "subtitle": "Estimate $∫ₐᵇ f(x) dx$ by random samples in a bounding box",
            "symbol": "Nᵢₙ/N",
            "path": "ui/monte_carlo/index.html",
            "beta": True,
        },
    ],
}
