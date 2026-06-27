"""AbletonOSC connectivity probe — proves the 'state half' of the batch
stem-export loop.

Prerequisite (one-time, in Ableton Live 11):
    Preferences -> Link/Tempo/MIDI -> Control Surface -> select "AbletonOSC".
    (Having AbletonOSC in the Remote Scripts folder is NOT enough; it must be
    selected as a Control Surface so the script actually loads.)

Then: open any Set, and run this script. It pings AbletonOSC and reads back
the live session state we rely on for the export loop:
  - that the script is alive (/live/test)
  - the Live version
  - track count + names  (the track count is what the completion-poller later
    uses to know how many stem files to expect)

Usage:
    python osc_probe.py

AbletonOSC default ports: send -> 11000, replies arrive on 11001.
"""
from __future__ import annotations

import threading
import time

from pythonosc.dispatcher import Dispatcher
from pythonosc.osc_server import ThreadingOSCUDPServer
from pythonosc.udp_client import SimpleUDPClient

SEND_HOST, SEND_PORT = "127.0.0.1", 11000   # AbletonOSC listens here
RECV_HOST, RECV_PORT = "127.0.0.1", 11001   # AbletonOSC replies here

_replies: dict[str, list] = {}


def _on_reply(address: str, *args) -> None:
    _replies[address] = list(args)
    print(f"  <-- {address}  {list(args)}")


def main() -> int:
    dispatcher = Dispatcher()
    dispatcher.set_default_handler(_on_reply)

    server = ThreadingOSCUDPServer((RECV_HOST, RECV_PORT), dispatcher)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()

    client = SimpleUDPClient(SEND_HOST, SEND_PORT)

    queries = [
        ("/live/test", []),
        ("/live/application/get/version", []),
        ("/live/song/get/num_tracks", []),
        ("/live/song/get/track_names", []),
        ("/live/song/get/tempo", []),
    ]

    print(f"Sending {len(queries)} queries to {SEND_HOST}:{SEND_PORT}, "
          f"listening on {RECV_HOST}:{RECV_PORT} ...\n")
    for addr, args in queries:
        print(f"  --> {addr}  {args}")
        client.send_message(addr, args)
        time.sleep(0.25)

    # give late replies a moment
    time.sleep(1.5)
    server.shutdown()

    print()
    if "/live/test" in _replies:
        print("RESULT: AbletonOSC is ALIVE and responding. State-half is GO.")
        if "/live/song/get/num_tracks" in _replies:
            n = _replies["/live/song/get/num_tracks"]
            print(f"        Track count seen: {n}")
        return 0

    print("RESULT: No reply from AbletonOSC.")
    print("  Checklist:")
    print("   1. Is Live 11 running with a Set open?")
    print("   2. Preferences -> Link/Tempo/MIDI -> Control Surface = AbletonOSC?")
    print("   3. Any firewall blocking UDP 11000/11001 on localhost?")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
