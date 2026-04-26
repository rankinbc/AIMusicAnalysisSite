import os
from celery import Celery

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery(
    "worker",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=["app.tasks", "app.tasks_cleanup"],
)

celery_app.conf.update(
    task_track_started=True,
    result_expires=86400,
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    worker_prefetch_multiplier=1,
    timezone="UTC",
    enable_utc=True,
    beat_schedule={
        "expire-stale-stem-mappings": {
            "task": "app.tasks_cleanup.expire_stale_stem_mappings_task",
            "schedule": 3600.0,  # hourly
        },
    },
)
