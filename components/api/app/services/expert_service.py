from pathlib import Path
import json
import re
from anthropic import AsyncAnthropic
from ..config import settings

PROMPTS_DIR = Path(__file__).parents[2] / "prompts" / "experts"
CLAUDE_MODEL = "claude-sonnet-4-6"

VALID_SPECIALISTS = frozenset({
    "LowEnd", "FrequencyBalance", "Dynamics", "StereoPhase",
    "Loudness", "Sections", "TranceArrangement", "StemReference",
    "HarmonicAnalysis", "ClarityAnalysis", "SpatialAnalysis",
    "SurroundCompatibility", "PlaybackOptimization", "OverallScore",
    "GainStagingAudit", "StereoFieldAudit", "FrequencyCollisionDetection",
    "DynamicsHumanizationReport", "SectionContrastAnalysis",
    "DensityBusynessReport", "ChordHarmonyAnalysis",
    "DeviceChainAnalysis", "PriorityProblemSummary",
})

_SPECIALIST_PATTERN = re.compile(
    r'\b(' + '|'.join(re.escape(s) for s in VALID_SPECIALISTS) + r')\.md\b'
)


def load_prompt(specialist: str) -> str:
    path = PROMPTS_DIR / f"{specialist}.md"
    if not path.exists():
        raise FileNotFoundError(f"Prompt not found: {specialist}.md")
    return path.read_text(encoding="utf-8")


def extract_recommended_specialists(triage_text: str) -> list[str]:
    found = _SPECIALIST_PATTERN.findall(triage_text)
    seen: set[str] = set()
    return [s for s in found if not (s in seen or seen.add(s))]  # type: ignore[func-returns-value]


async def run_triage(analysis_json: dict) -> dict:
    prompt = load_prompt("Triage")
    client = AsyncAnthropic(api_key=settings.anthropic_api_key)

    message = await client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=4096,
        system=[{
            "type": "text",
            "text": prompt,
            "cache_control": {"type": "ephemeral"},
        }],
        messages=[{
            "role": "user",
            "content": (
                "Here is the analysis JSON:\n\n"
                f"```json\n{json.dumps(analysis_json, indent=2)}\n```\n\n"
                "Please triage this mix."
            ),
        }],
    )

    text: str = message.content[0].text
    return {
        "text": text,
        "recommended_specialists": extract_recommended_specialists(text),
    }


async def stream_specialist(specialist: str, analysis_json: dict):
    """Async generator yielding SSE-compatible dicts."""
    prompt = load_prompt(specialist)
    client = AsyncAnthropic(api_key=settings.anthropic_api_key)

    async with client.messages.stream(
        model=CLAUDE_MODEL,
        max_tokens=4096,
        system=[{
            "type": "text",
            "text": prompt,
            "cache_control": {"type": "ephemeral"},
        }],
        messages=[{
            "role": "user",
            "content": (
                "Here is the analysis JSON:\n\n"
                f"```json\n{json.dumps(analysis_json, indent=2)}\n```\n\n"
                "Please analyze this mix."
            ),
        }],
    ) as stream:
        async for chunk in stream.text_stream:
            yield {"event": "chunk", "data": json.dumps({"text": chunk})}

    yield {"event": "done", "data": "{}"}
