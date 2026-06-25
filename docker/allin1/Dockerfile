# allin1 structure-detection image (CPU-only)
#
# Runs the `allin1` music structure analyzer in a Python 3.11 Linux container
# so the worker (which may run on Windows / Python 3.13) can call it via
# `docker run` without fighting madmom/natten native-build issues on the host.
#
# CPU variant of AbletonAIAnalysis/shared/allin1/Dockerfile: torch CPU wheels,
# no CUDA. natten 0.14.6 is the version whose old API (natten1dav/natten2dav)
# allin1 imports — NOT the 0.21.x line on PyPI, which renamed everything.
#
# Build:
#   docker build -t allin1:latest docker/allin1
# Test:
#   docker run --rm allin1:latest --help
#   docker run --rm -v /path/to/audio:/input:ro allin1:latest --json /input/song.wav

FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    ffmpeg \
    libsndfile1 \
    git \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU-only PyTorch 2.1.0 (natten 0.14.6 was built against the torch 2.1 ABI).
RUN pip install --no-cache-dir torch==2.1.0 torchaudio==2.1.0 \
    --index-url https://download.pytorch.org/whl/cpu

# allin1 deps. numpy 1.23.x: madmom's compiled Cython uses np.float, removed in
# 1.24+. Pin before madmom builds against it.
RUN pip install --no-cache-dir \
    "numpy>=1.23,<1.24" \
    scipy \
    librosa \
    soundfile \
    cython

RUN pip install --no-cache-dir madmom

# Patch madmom for Python 3.10+ (MutableSequence moved to collections.abc).
RUN sed -i 's/from collections import MutableSequence/from collections.abc import MutableSequence/g' \
    /usr/local/lib/python3.11/site-packages/madmom/processors.py

# natten 0.14.6 — the old API allin1 expects. Prefer a wheel; fall back to a
# source build (build-essential is present) if no wheel matches.
RUN pip install --no-cache-dir natten==0.14.6 || \
    (git clone --depth 1 --branch v0.14.6 https://github.com/SHI-Labs/NATTEN.git /tmp/natten && \
     cd /tmp/natten && pip install -e . && rm -rf /tmp/natten)

RUN pip install --no-cache-dir allin1

# allin1 drags in numpy 2.x (breaks madmom's Cython binaries) AND a modern
# matplotlib that requires numpy>=1.25 (allin1 imports matplotlib at package
# load, via its visualize module). Pin numpy back to 1.23.x, pin matplotlib to
# a 1.23-compatible line (<3.8), and rebuild madmom against the older numpy.
RUN pip install --no-cache-dir "numpy>=1.23,<1.24" "matplotlib>=3.5,<3.8" && \
    pip uninstall -y madmom && \
    pip install --no-cache-dir madmom
RUN sed -i 's/from collections import MutableSequence/from collections.abc import MutableSequence/g' \
    /usr/local/lib/python3.11/site-packages/madmom/processors.py

RUN mkdir -p /input /output

# `--json <file>` emits machine-readable JSON; anything else passes through to
# the allin1 CLI. The Python wrapper overrides the entrypoint, so this matters
# only for manual `docker run ... --json` invocations.
RUN printf '#!/bin/bash\n\
if [ "$1" = "--json" ]; then\n\
    shift\n\
    python -c "import sys, json, allin1; r = allin1.analyze(sys.argv[1]); print(json.dumps({\\"bpm\\": float(r.bpm), \\"beats\\": [float(b) for b in r.beats], \\"downbeats\\": [float(d) for d in r.downbeats], \\"segments\\": [{\\"label\\": s.label, \\"start\\": float(s.start), \\"end\\": float(s.end)} for s in r.segments]}))" "$@"\n\
else\n\
    allin1 "$@"\n\
fi\n' > /entrypoint.sh && chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["--help"]
