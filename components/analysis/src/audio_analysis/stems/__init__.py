"""Public API for the stems module. Phases import from here, never from submodules."""
from .analyzer import analyze
from .matcher import propose_mapping, validate_confirmed_mapping
from .reference_comparator import compare
from .role_detector import detect_role
from .types import (
    BalanceFlag, ConfirmedMapping, FreqBand, RoleProposal,
    StemAnalysisResult, StemClash, StemMappingProposal, StemMetrics,
    StemReferenceDelta, StemRole,
)

__all__ = [
    "analyze", "compare", "detect_role", "propose_mapping",
    "validate_confirmed_mapping",
    "BalanceFlag", "ConfirmedMapping", "FreqBand", "RoleProposal",
    "StemAnalysisResult", "StemClash", "StemMappingProposal",
    "StemMetrics", "StemReferenceDelta", "StemRole",
]
