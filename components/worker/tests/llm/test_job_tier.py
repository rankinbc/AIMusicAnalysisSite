from types import SimpleNamespace

from app.llm.job_tier import tier_for_analysis


class _Session:
    def __init__(self, job):
        self._job = job

    def get(self, _model, _id):
        return self._job


def test_tier_comes_from_the_analysis_job():
    analysis = SimpleNamespace(job_id="j1")
    assert tier_for_analysis(_Session(SimpleNamespace(tier="credits")), analysis) == "credits"


def test_missing_job_or_tier_is_none():
    assert tier_for_analysis(_Session(None), SimpleNamespace(job_id="j1")) is None
    assert tier_for_analysis(_Session(SimpleNamespace(tier=None)), SimpleNamespace(job_id="j1")) is None
    assert tier_for_analysis(_Session(None), SimpleNamespace(job_id=None)) is None
