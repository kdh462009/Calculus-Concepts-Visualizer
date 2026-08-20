"""Fun subject catalog - playground visualizers outside the calculus sequence."""

SUBJECT = {
    "id": "fun",
    "title": "Fun",
    "subtitle": "playground",
    "symbol": "∮",
    "order": 2,
    "unitChips": {
        "1": "Fourier",
    },
    "visualizers": [
        {
            "id": "fourier",
            "unit": 1,
            "unitTitle": "Fourier Playground",
            "title": "Epicycles",
            "subtitle": "Draw a closed curve; rotating phasors reconstruct it",
            "symbol": "Σcₖ",
            "path": "ui/fourier/index.html",
            "beta": True,
        },
    ],
}
