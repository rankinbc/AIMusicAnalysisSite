"""Read-only inspection of Ableton's top-level window(s).

Sends NO input to Live. Just enumerates what the Windows UI Automation tree
exposes, so we know whether the Export dialog can be driven by named controls
(robust) or only by screen coordinates (brittle). Confirms on THIS machine the
research finding that Live's UI is custom-drawn with no usable control tree.

Usage:
    python inspect_window.py
"""
from __future__ import annotations

from pywinauto import Desktop


def main() -> int:
    for backend in ("uia", "win32"):
        print(f"\n========== backend = {backend} ==========")
        try:
            dt = Desktop(backend=backend)
            wins = [w for w in dt.windows()
                    if "ableton" in (w.window_text() or "").lower()
                    or "live" in (w.window_text() or "").lower()]
            if not wins:
                print("  (no Ableton/Live top-level window found)")
                continue
            for w in wins:
                try:
                    title = w.window_text()
                    cls = w.class_name()
                    rect = w.rectangle()
                    print(f"  WINDOW  title={title!r}  class={cls!r}  rect={rect}")
                    try:
                        kids = w.children()
                        print(f"          immediate children exposed: {len(kids)}")
                        for c in kids[:15]:
                            print(f"            - text={c.window_text()!r} "
                                  f"class={c.class_name()!r}")
                    except Exception as e:  # noqa: BLE001
                        print(f"          children enumeration failed: {e}")
                except Exception as e:  # noqa: BLE001
                    print(f"  window inspect failed: {e}")
        except Exception as e:  # noqa: BLE001
            print(f"  backend {backend} failed: {e}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
