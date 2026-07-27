"""Local/S3 file resolution for the Operations tab's served-file links.

Reimplements components/worker/app/object_store.py's local-first-then-S3
algorithm standalone (workerdash must not import the worker package — see
plan Global Constraints) so served files behave identically whether the
dev data lives on local disk or a real bucket.
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path


def _default_local_root() -> str:
    if os.name == "nt":
        # components/workerdash/workerdash/files.py -> repo root is 3 levels up,
        # same depth as components/worker/app/tasks_dramatiq.py.
        return str(Path(__file__).resolve().parents[3] / "data")
    return "/data"


def local_root() -> str:
    return os.environ.get("STORAGE_LOCAL_ROOT") or _default_local_root()


def s3_enabled() -> bool:
    return bool(os.environ.get("S3_ENDPOINT"))


def _s3_client():
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=os.environ["S3_ENDPOINT"],
        aws_access_key_id=os.environ.get("S3_ACCESS_KEY"),
        aws_secret_access_key=os.environ.get("S3_SECRET_KEY"),
        region_name=os.environ.get("S3_REGION", "auto"),
        config=Config(connect_timeout=5, read_timeout=60, retries={"max_attempts": 2}),
    )


def resolve(path_or_key: str) -> tuple[Path | None, Path | None]:
    """Returns (path_to_serve, temp_path_to_cleanup); both None if unresolvable."""
    if ".." in Path(path_or_key).parts:
        return None, None

    candidate = (Path(local_root()) / path_or_key).resolve()
    if candidate.exists():
        return candidate, None

    p = Path(path_or_key)
    if p.is_absolute() and p.exists():
        return p, None

    if s3_enabled():
        bucket = os.environ.get("S3_BUCKET", "spectr")
        suffix = Path(path_or_key).suffix or ".bin"
        tmp_dir = Path(tempfile.mkdtemp(prefix="workerdash_s3_"))
        target = tmp_dir / f"file{suffix}"
        try:
            _s3_client().download_file(bucket, path_or_key, str(target))
        except Exception:
            return None, None
        return target, target

    return None, None


def cleanup(temp_path: Path | None) -> None:
    if temp_path is None:
        return
    try:
        temp_path.unlink(missing_ok=True)
        temp_path.parent.rmdir()
    except OSError:
        pass


CONTENT_TYPES = {
    ".wav": "audio/wav", ".mp3": "audio/mpeg", ".flac": "audio/flac",
    ".webp": "image/webp", ".png": "image/png", ".json": "application/json",
    ".als": "application/octet-stream",
}


def content_type_for(path: Path) -> str:
    return CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream")
