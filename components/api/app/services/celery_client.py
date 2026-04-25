from ..worker import celery_app


def dispatch_analysis_job(
    job_id: str,
    file_path: str,
    reference_path: str | None,
    user_id: str,
    als_file_path: str | None = None,
) -> str:
    """Enqueue analysis task and return Celery task ID."""
    result = celery_app.send_task(
        "app.tasks.run_analysis_pipeline",
        args=[job_id, file_path, reference_path, user_id, als_file_path],
    )
    return result.id
