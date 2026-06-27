"""Load + validate teaching units from ``units/*.md`` (story: teach-mode-coach).

Each unit file is markdown-with-frontmatter, the same authoring shape as the
specialist/identifier prompts::

    ---
    slug: low_mid_mud
    category: frequency_balance
    aliases: [mud, muddy, boxy, congested]
    reference_paths: [phase1.bands.low_mid, phase1.bands.mid]
    title: Low-mid mud (200-500 Hz)
    ---
    ## Explain
    ...

Validation is a HARD error at load time (authoring-time failure, not a silent
runtime drop): well-formed frontmatter, known ``category``, and every
``reference_path`` syntactically valid per the bundle path grammar
(mirrors ``coach_lib.context._PATH_SEGMENT_RE``). Catching a bad path here is
the schema-drift guard — the research docs cite fictional paths, so units must
be authored against the real flattened-analysis layout.

Frontmatter uses a tiny dependency-free parser: scalar ``key: value`` lines and
inline lists ``key: [a, b, c]``. The unit files are fully under our control, so
the parser doesn't need general YAML.
"""
from __future__ import annotations

import re
import threading
from pathlib import Path

from .models import TeachingUnit

_DEFAULT_UNITS_DIR = Path(__file__).resolve().parent / "units"

# Known rule-engine category vocabulary. A unit whose category isn't here is an
# authoring error (the selector boosts on these, and they must line up with the
# findings the pipeline emits). Union of solver/rule categories + specialist
# slugs that double as categories.
KNOWN_CATEGORIES: frozenset[str] = frozenset({
    "clipping", "loudness", "frequency_balance", "low_end", "clarity",
    "dynamics", "stereo_field", "stereo_phase", "mono_compatibility",
    "spatial", "surround", "sections", "section_contrast", "harmonic",
    "chord_harmony", "gain_staging", "density", "frequency_collision",
    "humanization", "device_chain", "playback", "overall",
    "trance_arrangement", "stem_balance", "stem_stereo_width",
    "stem_reference_delta", "stem_reference",
})

# One dotted segment of a bundle path: an identifier with an optional [N]
# array subscript. Mirrors coach_lib.context._PATH_SEGMENT_RE (kept local to
# avoid importing the context module — which pulls in the payload/grounding
# graph — into the loader).
_PATH_SEGMENT_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*(?:\[\d+\])?\Z")
_FRONTMATTER_RE = re.compile(r"\A---\s*\n(?P<fm>.*?)\n---\s*\n(?P<body>.*)\Z", re.DOTALL)


class TeachingUnitError(ValueError):
    """A unit file is malformed or fails validation (authoring-time error)."""


def _valid_path(path: str) -> bool:
    return bool(path) and all(_PATH_SEGMENT_RE.match(seg) for seg in path.split("."))


def _parse_scalar_or_list(value: str) -> str | tuple[str, ...]:
    value = value.strip()
    if value.startswith("[") and value.endswith("]"):
        inner = value[1:-1].strip()
        if not inner:
            return ()
        return tuple(item.strip() for item in inner.split(",") if item.strip())
    return value


def _parse_frontmatter(text: str) -> tuple[dict[str, object], str]:
    m = _FRONTMATTER_RE.match(text)
    if not m:
        raise TeachingUnitError("missing or malformed frontmatter block")
    fm: dict[str, object] = {}
    for raw in m.group("fm").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            raise TeachingUnitError(f"frontmatter line missing ':' -> {raw!r}")
        key, value = line.split(":", 1)
        fm[key.strip()] = _parse_scalar_or_list(value)
    return fm, m.group("body").strip()


def parse_unit(text: str, *, source: str = "<string>") -> TeachingUnit:
    """Parse + validate ONE unit file's text. Raises TeachingUnitError."""
    fm, body = _parse_frontmatter(text)

    def _str(key: str) -> str:
        v = fm.get(key)
        if not isinstance(v, str) or not v.strip():
            raise TeachingUnitError(f"{source}: '{key}' must be a non-empty scalar")
        return v.strip()

    def _list(key: str) -> tuple[str, ...]:
        v = fm.get(key)
        if not isinstance(v, tuple) or not v:
            raise TeachingUnitError(f"{source}: '{key}' must be a non-empty list")
        return v

    slug = _str("slug")
    category = _str("category")
    if category not in KNOWN_CATEGORIES:
        raise TeachingUnitError(
            f"{source}: unknown category {category!r} "
            f"(expected one of the rule-engine categories)"
        )
    aliases = tuple(a.lower() for a in _list("aliases"))
    reference_paths = _list("reference_paths")
    bad = [p for p in reference_paths if not _valid_path(p)]
    if bad:
        raise TeachingUnitError(f"{source}: invalid reference_path(s): {bad}")
    if not body:
        raise TeachingUnitError(f"{source}: empty lesson body")

    title = fm.get("title")
    title_str = title if isinstance(title, str) and title.strip() else slug.replace("_", " ")

    return TeachingUnit(
        slug=slug,
        category=category,
        aliases=aliases,
        reference_paths=reference_paths,
        title=title_str.strip(),
        body=body,
    )


# ── module cache (load once) ────────────────────────────────────────────────

_cache_lock = threading.Lock()
_units_cache: list[TeachingUnit] | None = None


def load_units(units_dir: Path | None = None, *, force: bool = False) -> list[TeachingUnit]:
    """Load + validate every ``*.md`` under ``units_dir`` (default: the package
    ``units/`` dir). Cached after the first call. ``force=True`` reloads.

    Raises :class:`TeachingUnitError` on the first malformed unit — a bad unit
    is an authoring bug to fix now, not to skip silently.
    """
    global _units_cache
    if units_dir is None and not force and _units_cache is not None:
        return _units_cache

    target = units_dir or _DEFAULT_UNITS_DIR
    units: list[TeachingUnit] = []
    for path in sorted(target.glob("*.md")):
        units.append(parse_unit(path.read_text(encoding="utf-8"), source=path.name))

    slugs = [u.slug for u in units]
    dupes = {s for s in slugs if slugs.count(s) > 1}
    if dupes:
        raise TeachingUnitError(f"duplicate unit slug(s): {sorted(dupes)}")

    if units_dir is None:
        with _cache_lock:
            _units_cache = units
    return units


def clear_units_cache() -> None:
    """Test hook: drop the module cache so the next load re-reads from disk."""
    global _units_cache
    with _cache_lock:
        _units_cache = None
