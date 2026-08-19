"""Public catalog of subjects and visualizers."""

from __future__ import annotations

from calcbc.subjects import all_subjects


def _public_visualizer(item: dict) -> dict:
    return {k: v for k, v in item.items() if k != "path"}


def _public_subject(subject: dict) -> dict:
    visualizers = sorted(
        subject.get("visualizers") or [],
        key=lambda item: (item.get("unit", 0), item.get("title", "")),
    )
    return {
        "id": subject["id"],
        "title": subject["title"],
        "subtitle": subject.get("subtitle", ""),
        "symbol": subject.get("symbol", ""),
        "unitChips": subject.get("unitChips") or {},
        "visualizers": [_public_visualizer(item) for item in visualizers],
    }


def get_catalog() -> dict:
    return {"subjects": [_public_subject(subject) for subject in all_subjects()]}


def iter_visualizers():
    for subject in all_subjects():
        for item in subject.get("visualizers") or []:
            yield item


def find_visualizer(visualizer_id: str) -> dict | None:
    for item in iter_visualizers():
        if item.get("id") == visualizer_id:
            return item
    return None
