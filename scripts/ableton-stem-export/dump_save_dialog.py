"""Dump the control tree of the currently-open native Save dialog.

Run this WHILE Ableton's Save dialog (from an export) is open on screen. It
prints every control's title / control_type / class / auto_id so we can target
the filename field and Save button exactly, instead of guessing.

    python dump_save_dialog.py
"""
from __future__ import annotations

import sys
import time

sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]

from pywinauto import Desktop


def find_dialog():
    dt = Desktop(backend="uia")
    for w in dt.windows():
        try:
            if w.class_name() == "#32770":
                txt = (w.window_text() or "").lower()
                if "save" in txt or "export" in txt or txt == "":
                    return w
        except Exception:  # noqa: BLE001
            continue
    return None


def main() -> int:
    dlg = find_dialog()
    if dlg is None:
        print("No #32770 dialog found. Make sure the Save dialog is open, then re-run.")
        return 1
    print(f"DIALOG: title={dlg.window_text()!r} class={dlg.class_name()!r}\n")
    print("---- descendants (title | control_type | class | auto_id) ----")
    for c in dlg.descendants():
        try:
            print(f"  {c.window_text()!r:40} | {c.element_info.control_type:14} "
                  f"| {c.class_name():22} | {getattr(c.element_info, 'automation_id', '')}")
        except Exception as e:  # noqa: BLE001
            print(f"  <inspect failed: {e}>")
    time.sleep(0.1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
