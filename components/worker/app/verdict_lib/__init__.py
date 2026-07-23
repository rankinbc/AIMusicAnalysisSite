"""Worker-owned verdict pipeline.

Relocated from the frozen v1 api (story 1.1): rule engine, triage,
specialists, validator, dedupe, ranker, orchestrator, and the prompt registry
now live here, alongside the worker-native pieces (sync claude-CLI client,
``final_json`` flatten adapter). The async stages take an
injected :class:`~.llm_protocol.LLMCaller`; nothing here imports from the
frozen v1 api.
"""
from .dedupe import dedupe_verdicts
from .json_extraction import extract_json_object
from .llm_protocol import LLMCaller
from .orchestrator import EventKind, PipelineEvent, run_pipeline
from .prompt_loader import (
    SLUG_TO_FILENAME,
    SPECIALIST_SLUGS,
    load_prompt,
    load_triage,
)
from .ranker import rank_verdicts
from .rule_engine import evaluate_problems
from .triage import run_triage
from .validator import validate_verdict

__all__ = [
    "EventKind",
    "LLMCaller",
    "PipelineEvent",
    "SLUG_TO_FILENAME",
    "SPECIALIST_SLUGS",
    "dedupe_verdicts",
    "evaluate_problems",
    "extract_json_object",
    "load_prompt",
    "load_triage",
    "rank_verdicts",
    "run_pipeline",
    "run_triage",
    "validate_verdict",
]
