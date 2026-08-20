"""Fun subject catalog - playground visualizers outside the calculus sequence."""

SUBJECT = {
    "id": "fun",
    "title": "Fun",
    "subtitle": "playground",
    "symbol": "∮",
    "order": 2,
    "unitChips": {
        "1": "Other",
    },
    "visualizers": [
        {
            "id": "fourier",
            "unit": 1,
            "unitTitle": "Other",
            "title": "Epicycles",
            "subtitle": "Draw a closed curve; rotating phasors rebuild $z(θ) ≈ Σ cₖ e^{ikθ}$",
            "symbol": "Σcₖ",
            "path": "ui/fourier/index.html",
            "beta": True,
        },
        {
            "id": "monte_carlo",
            "unit": 1,
            "unitTitle": "Other",
            "title": "Monte Carlo",
            "subtitle": "Estimate $∫ₐᵇ f(x) dx$ by random samples in a bounding box",
            "symbol": "Nᵢₙ/N",
            "path": "ui/monte_carlo/index.html",
            "beta": True,
        },
    ],
}
