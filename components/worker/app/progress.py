from typing import Callable
from .db import update_job_phase


def make_progress_cb(task, job_id: str, session) -> Callable:
    def progress_cb(phase: int, phase_name: str, pct: float) -> None:
        task.update_state(
            state="PROGRESS",
            meta={
                "phase": phase,
                "phase_name": phase_name,
                "total_phases": 7,
                "pct": pct,
            },
        )
        update_job_phase(session, job_id, phase, phase_name, pct)

    return progress_cb
