"""Coach helper package — context bundling, payload schema, streaming."""

from .cancel import (
    CANCEL_KEY_PREFIX,
    CANCEL_TTL_S,
    cancel_check_for,
    cancel_key,
)
from .context import build_context_bundle, resolve_evidence
from .payload import (
    CoachEvidence,
    CoachReplyPayload,
    answer_makes_numeric_claim_without_evidence,
)
from .stream_parser import SENTINEL, ParsedStream, StreamSplitter
from .stream_publisher import CoachStreamPublisher

__all__ = [
    "CANCEL_KEY_PREFIX",
    "CANCEL_TTL_S",
    "CoachEvidence",
    "CoachReplyPayload",
    "CoachStreamPublisher",
    "ParsedStream",
    "SENTINEL",
    "StreamSplitter",
    "answer_makes_numeric_claim_without_evidence",
    "build_context_bundle",
    "cancel_check_for",
    "cancel_key",
    "resolve_evidence",
]
