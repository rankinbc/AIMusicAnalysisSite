import uuid
from unittest.mock import MagicMock, patch, ANY
import pytest


class TestProgressCallback:
    def test_progress_cb_calls_update_state(self):
        from app.progress import make_progress_cb
        mock_task = MagicMock()
        mock_session = MagicMock()

        with patch("app.progress.update_job_phase") as mock_update:
            cb = make_progress_cb(mock_task, "test-job-id", mock_session)
            cb(1, "Universal Mix Analysis", 0.5)

        mock_task.update_state.assert_called_once_with(
            state="PROGRESS",
            meta={"phase": 1, "phase_name": "Universal Mix Analysis", "total_phases": 7, "pct": 0.5},
        )
        mock_update.assert_called_once_with(mock_session, "test-job-id", 1, "Universal Mix Analysis", 0.5)

    def test_progress_cb_passes_correct_phase_data(self):
        from app.progress import make_progress_cb
        mock_task = MagicMock()
        mock_session = MagicMock()

        with patch("app.progress.update_job_phase"):
            cb = make_progress_cb(mock_task, "abc-123", mock_session)
            cb(3, "Genre Scoring", 1.0)

        call_args = mock_task.update_state.call_args
        assert call_args.kwargs["meta"]["phase"] == 3
        assert call_args.kwargs["meta"]["total_phases"] == 7


class TestDBHelpers:
    def test_update_job_phase_updates_fields(self):
        from app.db import update_job_phase, JobStatus, UploadJob

        mock_job = MagicMock(spec=UploadJob)
        mock_job.started_at = None
        mock_session = MagicMock()
        mock_session.get.return_value = mock_job

        update_job_phase(mock_session, str(uuid.uuid4()), 2, "Genre Detection", 0.75, status=JobStatus.PROCESSING)

        assert mock_job.current_phase == 2
        assert mock_job.phase_name == "Genre Detection"
        assert mock_job.phase_pct == 0.75
        assert mock_job.status == JobStatus.PROCESSING
        mock_session.commit.assert_called_once()

    def test_update_job_phase_no_op_if_job_missing(self):
        from app.db import update_job_phase

        mock_session = MagicMock()
        mock_session.get.return_value = None

        # Should not raise
        update_job_phase(mock_session, str(uuid.uuid4()), 1, "Test", 0.0)
        mock_session.commit.assert_not_called()


class TestTasks:
    def test_task_is_registered(self):
        from app.celery_app import celery_app
        # Import tasks to register them
        import app.tasks  # noqa
        assert "app.tasks.run_analysis_pipeline" in celery_app.tasks

    def test_task_calls_run_pipeline(self):
        """Task should call audio_analysis.run_pipeline with correct args."""
        from app.tasks import run_analysis_pipeline

        mock_result = {
            "file_path": "/tmp/test.wav",
            "phases": [{"phase": i, "name": f"Phase {i}", "status": "ok", "data": {}, "error": None} for i in range(1, 8)],
            "overall_score": 75.0,
            "grade": "C",
            "top_fixes": ["fix1", "fix2", "fix3"],
        }

        mock_session = MagicMock()
        mock_job = MagicMock()
        mock_job.started_at = None
        mock_session.get.return_value = mock_job

        with patch("app.tasks.run_pipeline", return_value=mock_result) as mock_pipeline, \
             patch("app.tasks.finalize_job") as mock_finalize, \
             patch("app.tasks._write_json_artifact"), \
             patch("app.tasks.update_job_phase"), \
             patch("app.tasks.make_progress_cb", return_value=lambda *a: None):

            # Simulate CustomTask._session being set
            run_analysis_pipeline._session = mock_session
            result = run_analysis_pipeline.run(
                job_id="test-job-123",
                file_path="/uploads/test.mp3",
                reference_path=None,
                user_id="user-456",
            )

        mock_pipeline.assert_called_once_with(
            file_path="/uploads/test.mp3",
            reference_path=None,
            progress_cb=ANY,
        )
        mock_finalize.assert_called_once()
        assert result["grade"] == "C"

    def test_task_continues_after_pipeline_exception(self):
        """If run_pipeline raises, task should mark job as FAILED (not silently pass)."""
        from app.tasks import run_analysis_pipeline
        from app.db import JobStatus

        mock_session = MagicMock()
        mock_session.get.return_value = MagicMock(started_at=None)

        with patch("app.tasks.run_pipeline", side_effect=RuntimeError("Model crash")), \
             patch("app.tasks.update_job_phase") as mock_update, \
             patch("app.tasks.make_progress_cb", return_value=lambda *a: None):

            run_analysis_pipeline._session = mock_session
            with pytest.raises(RuntimeError):
                run_analysis_pipeline.run(
                    job_id="job-xyz",
                    file_path="/uploads/test.mp3",
                    reference_path=None,
                    user_id="user-abc",
                )

        # Verify FAILED status was set
        failed_calls = [c for c in mock_update.call_args_list if c.args[-1] == JobStatus.FAILED or (len(c.kwargs) > 0 and c.kwargs.get("status") == JobStatus.FAILED)]
        assert len(failed_calls) > 0, "Expected FAILED status update after exception"
