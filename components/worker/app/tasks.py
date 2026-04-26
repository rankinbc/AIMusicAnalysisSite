import json
import logging
import os
from datetime import datetime
from pathlib import Path

from .celery_app import celery_app
from .db import CustomTask, JobStatus, update_job_phase, finalize_job
from .progress import make_progress_cb

logger = logging.getLogger(__name__)

RESULTS_DIR = Path(os.environ.get("RESULTS_DIR", "../../output/analysis_results"))

try:
    from audio_analysis import run_pipeline
except ImportError:  # audio_analysis not installed in test environment
    run_pipeline = None  # type: ignore[assignment]


@celery_app.task(
    bind=True,
    base=CustomTask,
    soft_time_limit=3600,
    time_limit=3900,
    name="app.tasks.run_analysis_pipeline",
)
def run_analysis_pipeline(
    self,
    job_id: str,
    file_path: str,
    reference_path: str | None,
    user_id: str,
    als_file_path: str | None = None,
    genre_hint: str | None = None,
    stem_paths: dict | None = None,
    reference_stem_paths: dict | None = None,
) -> dict:
    import os
    logger.info(
        "task start: job=%s file=%s ref=%s als=%s genre=%s cwd=%s",
        job_id, file_path, reference_path, als_file_path, genre_hint, os.getcwd(),
    )
    logger.info("task: file exists=%s", os.path.exists(file_path))

    session = self._session
    if session is None:
        logger.error("task: DB session is None — before_start may not have fired (job=%s)", job_id)

    update_job_phase(session, job_id, 0, "Starting", 0.0, status=JobStatus.PROCESSING)
    logger.info("task: job=%s marked PROCESSING", job_id)
    progress_cb = make_progress_cb(self, job_id, session)

    try:
        pipeline_result = run_pipeline(
            file_path=file_path,
            reference_path=reference_path,
            als_file_path=als_file_path,
            genre_hint=genre_hint,
            progress_cb=progress_cb,
            stem_paths=stem_paths,
            reference_stem_paths=reference_stem_paths,
        )

        # Convert TypedDict to plain dict for JSON serialization
        result_dict = dict(pipeline_result)
        result_dict["phases"] = [dict(p) for p in result_dict.get("phases", [])]

        logger.info("task: pipeline complete for job=%s, finalizing", job_id)
        finalize_job(session, job_id, result_dict)
        _write_json_artifact(job_id, result_dict)
        logger.info("task: job=%s complete", job_id)

        return result_dict

    except Exception as exc:
        logger.exception("task: pipeline FAILED for job=%s: %s", job_id, exc)
        try:
            session.rollback()
        except Exception as rb_exc:
            logger.warning("task: rollback failed for job=%s: %s", job_id, rb_exc)
        try:
            update_job_phase(session, job_id, 0, "Failed", 0.0, status=JobStatus.FAILED)
        except Exception as upd_exc:
            logger.error("task: could not mark job=%s FAILED: %s", job_id, upd_exc)
        raise


def _write_json_artifact(job_id: str, pipeline_result: dict) -> None:
    try:
        RESULTS_DIR.mkdir(parents=True, exist_ok=True)
        date_str = datetime.now().strftime("%Y-%m-%d")
        output_path = RESULTS_DIR / f"{date_str}_{job_id}.json"
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(pipeline_result, f, indent=2, default=str)
        logger.info(f"Results written to {output_path}")
    except Exception as exc:
        logger.warning(f"Failed to write JSON artifact: {exc}")
