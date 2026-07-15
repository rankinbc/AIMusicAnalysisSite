from dataclasses import dataclass, field
from typing import Any, TypedDict
from aimusic_shared.verdicts.models import Verdict


class JudgmentCall(TypedDict):
    kind: str                 # "eq_conflict" | "glue_offer" | "loudness_conflict" | "heavy_clamp"
    where: str                # human label, e.g. "eq slot @300Hz"
    competing_fix_ids: list[str]   # problem_ids involved
    context: dict[str, Any]   # measured numbers the LLM needs
    question: str             # the specific decision asked of the LLM


@dataclass
class ArbiterResult:
    verdicts: list[Verdict]                  # reconciled fixes, ready for compile_preset
    judgment_calls: list[JudgmentCall] = field(default_factory=list)
    change_log: list[dict[str, Any]] = field(default_factory=list)
