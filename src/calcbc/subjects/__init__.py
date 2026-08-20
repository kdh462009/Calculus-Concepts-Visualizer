"""Subject registry.

To add a subject:
1. Create `src/calcbc/subjects/<name>.py` exporting `SUBJECT`
2. Import it in `all_subjects()` below
3. Add visualizer backends under `src/calcbc/visualizers/` and UI under `src/ui/`
"""

from calcbc.subjects.calculus import SUBJECT as CALCULUS
from calcbc.subjects.fun import SUBJECT as FUN

# Import new subjects here, then append them to this list.
SUBJECTS = [
    CALCULUS,
    FUN,
]


def all_subjects():
    return sorted(SUBJECTS, key=lambda item: (item.get("order", 0), item["title"]))
