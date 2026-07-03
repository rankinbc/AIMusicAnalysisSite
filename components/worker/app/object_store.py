"""Story 3.1 — minimal S3/R2/MinIO object fetch for the worker.

The BFF's presigned multipart path (AR17/AR18) lands uploads in object
storage instead of the shared local-disk root, so the worker must be able
to pull a source object down before running the pipeline. This is the
3.2-forward shim: full worker-side validation, attachments, and the
own-credentials hardening (AR19/AR21) land in story 3.2.

Enabled only when ``S3_ENDPOINT`` is set; otherwise the worker keeps its
existing LOCAL_ROOT resolution untouched.

Env:
    S3_ENDPOINT     e.g. http://minio:9000 (MinIO) / https://<acct>.r2.cloudflarestorage.com
    S3_ACCESS_KEY / S3_SECRET_KEY
    S3_BUCKET       default "spectr"
    S3_REGION       default "auto" (R2) — MinIO ignores it
"""
from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)


def s3_enabled() -> bool:
    return bool(os.environ.get("S3_ENDPOINT"))


def _client():
    import boto3  # lazy: keeps the module importable when boto3 isn't installed

    return boto3.client(
        "s3",
        endpoint_url=os.environ["S3_ENDPOINT"],
        aws_access_key_id=os.environ.get("S3_ACCESS_KEY"),
        aws_secret_access_key=os.environ.get("S3_SECRET_KEY"),
        region_name=os.environ.get("S3_REGION", "auto"),
    )


def fetch_to_local(key: str) -> Path:
    """Download ``key`` from the bucket to a temp file and return its path.

    Caller owns cleanup (delete the parent temp dir when done). The file
    keeps the object's extension so downstream format sniffing works.
    """
    bucket = os.environ.get("S3_BUCKET", "spectr")
    suffix = Path(key).suffix or ".bin"
    tmp_dir = Path(tempfile.mkdtemp(prefix="spectr_s3_"))
    target = tmp_dir / f"source{suffix}"
    logger.info("object_store: fetching s3://%s/%s -> %s", bucket, key, target)
    _client().download_file(bucket, key, str(target))
    return target


def cleanup_local(path: Path | None) -> None:
    """Best-effort removal of a fetch_to_local() result and its temp dir."""
    if path is None:
        return
    try:
        path.unlink(missing_ok=True)
        path.parent.rmdir()
    except OSError:
        logger.warning("object_store: temp cleanup failed for %s", path, exc_info=True)


def resolve_local(path_or_key: str, local_root: str) -> tuple[str, Path | None]:
    """Story 3.2 — resolve a stored path/key to a local filesystem path.

    Local-first (preserves every pre-S3 deployment's behavior exactly):
      1. ``local_root / path_or_key`` exists → use it, nothing fetched.
      2. absolute path that exists → use it.
      3. S3 enabled → fetch the key to a temp file (caller must
         ``cleanup_local`` the returned Path).
      4. otherwise → return the local_root join unchanged (the pipeline's
         own missing-file error surfaces downstream, same as today).

    Returns ``(local_path, fetched_temp_or_None)``.
    """
    # Defense-in-depth vs key traversal: a stored path/key must never contain
    # dot-segments (the BFF rejects them at registration too) — `.resolve()`
    # below would otherwise normalize `..` right out of the storage root.
    if ".." in Path(path_or_key).parts:
        raise ValueError(f"path traversal in stored path: {path_or_key!r}")
    candidate = (Path(local_root) / path_or_key).resolve()
    if candidate.exists():
        return str(candidate), None
    p = Path(path_or_key)
    if p.is_absolute() and p.exists():
        return str(p), None
    if s3_enabled():
        fetched = fetch_to_local(path_or_key)
        return str(fetched), fetched
    return str(candidate), None


def cleanup_all(fetched: list[Path]) -> None:
    """cleanup_local over a batch of resolve_local fetches."""
    for f in fetched:
        cleanup_local(f)


def delete_object(key: str, local_root: str) -> bool:
    """Story 3.4 — remove a stored object EVERYWHERE it may live.

    Deletes the local file under ``local_root`` (missing-ok) AND, when S3 is
    enabled, the bucket object. Exact RELATIVE keys only — absolute paths are
    rejected (``Path(root) / abs_path`` silently DISCARDS the root, which
    would let a poisoned row delete files anywhere), as are dot-segments and
    anything that resolves outside ``local_root``. Idempotent: deleting an
    absent object is success (the sweep re-runs nightly).

    Returns True when something was actually removed (local file existed
    and/or an S3 delete was issued) — the sweep uses this to detect a
    misconfigured root silently no-opping retention.
    """
    p = Path(key)
    if p.is_absolute() or p.drive or ".." in p.parts:
        raise ValueError(f"unsafe stored path (absolute/traversal): {key!r}")
    removed = False
    try:
        root = Path(local_root).resolve()
        local = (root / key).resolve()
        if not local.is_relative_to(root):
            raise ValueError(f"stored path escapes local root: {key!r}")
        if local.exists():
            local.unlink()
            removed = True
    except ValueError:
        raise
    except OSError:
        logger.warning("object_store: local delete failed for %s", key, exc_info=True)
    if s3_enabled():
        bucket = os.environ.get("S3_BUCKET", "spectr")
        # S3 DeleteObject on a missing key is a success (204) — idempotent.
        _client().delete_object(Bucket=bucket, Key=key)
        logger.info("object_store: deleted s3://%s/%s", bucket, key)
        removed = True
    return removed
