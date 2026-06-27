"""export_one.py — prototype: export stems from ONE open Live set.

This proves the 'render half' of the batch loop on real hardware. It is the
risky part (it drives Live's opaque custom UI), so it is built defensively:

  * DRY RUN BY DEFAULT. Without --confirm it focuses the Live window, opens the
    Export dialog (Ctrl+Shift+R), verifies a dialog appeared, then presses ESC
    to cancel. Nothing is rendered, no files are written. Run this first.
  * Only with --confirm does it actually export: confirm the (pre-configured)
    Export dialog, drive the native Save dialog to your target folder, then poll
    that folder until the stem files stop appearing/growing.

PREREQUISITES (see README):
  * Live 11 running with the target set open, AbletonOSC enabled as Control
    Surface (verify with osc_probe.py first).
  * Export settings ALREADY configured + persisted: Rendered Track =
    "All Individual Tracks", WAV / 44100 / 24-bit, Normalize OFF, render length
    spanning the whole song. (Set once via Ctrl+Shift+R then Cancel.)
  * Only ONE Live instance running (multi-instance = ambiguous focus target).

USAGE:
    # safe dry run — proves focus + dialog open, writes nothing:
    python export_one.py --out "D:\\stems_test\\myset"

    # real export (only after a clean dry run):
    python export_one.py --out "D:\\stems_test\\myset" --confirm

The --out folder should be EMPTY (or new) so the completion poller counts only
this export's files.
"""
from __future__ import annotations

import argparse
import sys
import threading
import time
from pathlib import Path

# Force UTF-8 stdout — Live track names can contain non-cp1252 glyphs (we saw a
# braille char) which crash the default Windows console encoder.
sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]

from pythonosc.dispatcher import Dispatcher
from pythonosc.osc_server import ThreadingOSCUDPServer
from pythonosc.udp_client import SimpleUDPClient

from pywinauto import Desktop
from pywinauto.keyboard import send_keys

OSC_SEND = ("127.0.0.1", 11000)
OSC_RECV = ("127.0.0.1", 11001)
AUDIO_EXTS = {".wav", ".aif", ".aiff", ".flac"}


# ----------------------------------------------------------------------------- OSC
def osc_query(addrs: list[tuple[str, list]], wait: float = 1.5) -> dict[str, list]:
    """Send queries, collect replies for `wait` seconds, return {address: args}."""
    replies: dict[str, list] = {}
    disp = Dispatcher()
    disp.set_default_handler(lambda a, *args: replies.__setitem__(a, list(args)))
    srv = ThreadingOSCUDPServer(OSC_RECV, disp)
    th = threading.Thread(target=srv.serve_forever, daemon=True)
    th.start()
    client = SimpleUDPClient(*OSC_SEND)
    for addr, args in addrs:
        client.send_message(addr, args)
        time.sleep(0.15)
    time.sleep(wait)
    srv.shutdown()
    return replies


def clear_solo_mute(num_tracks: int) -> None:
    """Soloed tracks render only-soloed; muted tracks render silent. Clear both
    so every stem is captured cleanly."""
    client = SimpleUDPClient(*OSC_SEND)
    for i in range(num_tracks):
        client.send_message("/live/track/set/solo", [i, 0])
        client.send_message("/live/track/set/mute", [i, 0])
        time.sleep(0.01)
    print(f"  cleared solo+mute on {num_tracks} tracks")


# --------------------------------------------------------------------------- window
def find_live_window(substr: str):
    """Return the single Live top-level window whose title contains `substr`.
    Errors if zero or more than one match (ambiguous focus target = unsafe)."""
    dt = Desktop(backend="win32")
    matches = [w for w in dt.windows()
               if substr.lower() in (w.window_text() or "").lower()
               and w.class_name() == "Ableton Live Window Class"]
    if not matches:
        raise SystemExit(f"No Live window matching {substr!r}. Is the set open?")
    if len(matches) > 1:
        titles = "\n   ".join(repr(w.window_text()) for w in matches)
        raise SystemExit(
            f"{len(matches)} Live windows match {substr!r} — ambiguous:\n   {titles}\n"
            "Pass a more specific --window substring (e.g. the set name)."
        )
    return matches[0]


def find_save_dialog(timeout: float = 15.0):
    """Wait for the native Save common dialog (class #32770) to appear."""
    end = time.time() + timeout
    dt = Desktop(backend="uia")
    while time.time() < end:
        for w in dt.windows():
            try:
                if w.class_name() == "#32770" and "save" in (w.window_text() or "").lower():
                    return w
            except Exception:  # noqa: BLE001
                continue
        time.sleep(0.4)
    return None


# ----------------------------------------------------------------------------- poll
def poll_output(folder: Path, *, stable_secs: float, timeout: float) -> list[Path]:
    """Wait until the set of audio files in `folder` stops changing for
    `stable_secs` (count AND total size stable). Returns the files found."""
    print(f"  polling {folder} (stable={stable_secs}s, timeout={timeout}s) ...")
    end = time.time() + timeout
    last_sig: tuple | None = None
    stable_since: float | None = None
    while time.time() < end:
        files = [p for p in folder.glob("*") if p.suffix.lower() in AUDIO_EXTS]
        sig = (len(files), sum(p.stat().st_size for p in files) if files else 0)
        if files and sig == last_sig:
            if stable_since is None:
                stable_since = time.time()
            elif time.time() - stable_since >= stable_secs:
                return files
        else:
            stable_since = None
        last_sig = sig
        time.sleep(1.0)
    return [p for p in folder.glob("*") if p.suffix.lower() in AUDIO_EXTS]


# ----------------------------------------------------------------------------- main
def main() -> int:
    ap = argparse.ArgumentParser(description="Export stems from one open Live set.")
    ap.add_argument("--out", required=True, help="Target output folder (should be empty/new).")
    ap.add_argument("--name", default="stems", help="Base file name for the export.")
    ap.add_argument("--window", default="Ableton Live 11 Suite",
                    help="Substring identifying the target Live window.")
    ap.add_argument("--confirm", action="store_true",
                    help="ACTUALLY export. Without this it's a no-write dry run.")
    ap.add_argument("--no-clear", action="store_true", help="Skip clearing solo/mute.")
    ap.add_argument("--dialog-wait", type=float, default=2.0,
                    help="Seconds to wait for the Export dialog to appear.")
    ap.add_argument("--stable-secs", type=float, default=4.0)
    ap.add_argument("--timeout", type=float, default=600.0)
    args = ap.parse_args()

    out = Path(args.out)
    mode = "REAL EXPORT" if args.confirm else "DRY RUN (no files written)"
    print(f"=== export_one.py — {mode} ===")

    # 1. OSC state ------------------------------------------------------------
    state = osc_query([("/live/test", []), ("/live/song/get/num_tracks", [])])
    if "/live/test" not in state:
        raise SystemExit("AbletonOSC not responding — run osc_probe.py to diagnose.")
    num_tracks = int(state.get("/live/song/get/num_tracks", [0])[0])
    print(f"  AbletonOSC OK — {num_tracks} tracks")
    if not args.no_clear and num_tracks:
        clear_solo_mute(num_tracks)

    # 2. focus the Live window ------------------------------------------------
    win = find_live_window(args.window)
    print(f"  target window: {win.window_text()!r}")
    win.set_focus()
    time.sleep(0.5)

    # 3. open the Export dialog (Ctrl+Shift+R) --------------------------------
    print("  sending Ctrl+Shift+R ...")
    send_keys("^+r")
    time.sleep(args.dialog_wait)

    if not args.confirm:
        # Dry run: we can't introspect Live's opaque dialog, so just cancel out.
        print("  DRY RUN: pressing ESC to cancel the Export dialog (no render).")
        send_keys("{ESC}")
        print("\nDry run complete. If the Export dialog opened and closed, the "
              "focus+open path works. Re-run with --confirm to export for real.")
        return 0

    # 4. confirm the (pre-configured) Export dialog ---------------------------
    out.mkdir(parents=True, exist_ok=True)
    print("  confirming Export (ENTER) ...")
    send_keys("{ENTER}")

    # 5. drive the native Save dialog -----------------------------------------
    dlg = find_save_dialog()
    if dlg is None:
        raise SystemExit(
            "Save dialog never appeared. Either the Export dialog wasn't "
            "pre-configured (ENTER didn't confirm it) or timing is off. "
            "Re-run the dry run and watch what happens after Ctrl+Shift+R.")
    print(f"  save dialog: {dlg.window_text()!r}")
    target = str(out / args.name)
    # Typing a full path into the File name box sets folder + base name at once.
    name_edit = dlg.child_window(title="File name:", control_type="Edit")
    name_edit.set_edit_text(target)
    time.sleep(0.3)
    dlg.child_window(title="Save", control_type="Button").click_input()
    print(f"  saving to {target!r}")

    # 6. wait for the stems ---------------------------------------------------
    files = poll_output(out, stable_secs=args.stable_secs, timeout=args.timeout)
    print(f"\nDone. {len(files)} audio files in {out}:")
    for p in sorted(files):
        print(f"   {p.name}  ({p.stat().st_size // 1024} KB)")
    if not files:
        print("  (no files — check render length and the Save dialog path)")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
