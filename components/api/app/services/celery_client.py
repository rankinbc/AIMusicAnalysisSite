from ..worker import celery_app


def dispatch_analysis_job(
    job_id: str,
    file_path: str,
    reference_path: str | None,
    user_id: str,
    als_file_path: str | None = None,
    genre_hint: str | None = None,
    stem_paths: dict | None = None,
    reference_stem_paths: dict | None = None,
) -> str:
    """Enqueue analysis task and return Celery task ID."""
    result = celery_app.send_task(
        "app.tasks.run_analysis_pipeline",
        args=[job_id, file_path, reference_path, user_id],
        kwargs={
            "als_file_path": als_file_path,
            "genre_hint": genre_hint,
            "stem_paths": stem_paths,
            "reference_stem_paths": reference_stem_paths,
        },
    )
    return result.id
