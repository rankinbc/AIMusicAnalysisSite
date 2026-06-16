"""Public API for the stems module. Phases import from here, never from submodules."""
from .analyzer import analyze, analyze_grouped, analyze_per_stem
from .classify import classify_stems
from .matcher import propose_mapping, validate_confirmed_mapping
from .reference_comparator import compare
from .role_detector import detect_role
from .types import (
    BalanceFlag, ConfirmedMapping, FreqBand, RoleProposal,
    StemAnalysisResult, StemClash, StemMappingProposal, StemMetrics,
    StemProposal, StemReferenceDelta, StemRole,
)

__all__ = [
    "analyze", "analyze_grouped", "analyze_per_stem", "classify_stems",
    "compare", "detect_role", "propose_mapping", "validate_confirmed_mapping",
    "BalanceFlag", "ConfirmedMapping", "FreqBand", "RoleProposal",
    "StemAnalysisResult", "StemClash", "StemMappingProposal", "StemMetrics",
    "StemProposal", "StemReferenceDelta", "StemRole",
]
