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
) -> dict:
    session = self._session
    update_job_phase(session, job_id, 0, "Starting", 0.0, status=JobStatus.PROCESSING)
    progress_cb = make_progress_cb(self, job_id, session)

    try:
        pipeline_result = run_pipeline(
            file_path=file_path,
            reference_path=reference_path,
            als_file_path=als_file_path,
            genre_hint=genre_hint,
            progress_cb=progress_cb,
        )

        # Convert TypedDict to plain dict for JSON serialization
        result_dict = dict(pipeline_result)
        result_dict["phases"] = [dict(p) for p in result_dict.get("phases", [])]

        finalize_job(session, job_id, result_dict)
        _write_json_artifact(job_id, result_dict)

        return result_dict

    except Exception as exc:
        logger.exception(f"Pipeline failed for job {job_id}: {exc}")
        try:
            session.rollback()  # Clear any failed transaction so the FAILED update can execute
        except Exception:
            pass
        update_job_phase(session, job_id, 0, "Failed", 0.0, status=JobStatus.FAILED)
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
