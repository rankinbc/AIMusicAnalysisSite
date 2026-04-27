from pathlib import Path
import asyncio
import json
import queue
import re
import subprocess
import threading
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


def _user_message(analysis_json: dict, action: str) -> str:
    return (
        "Here is the analysis JSON:\n\n"
        f"```json\n{json.dumps(analysis_json, indent=2)}\n```\n\n"
        f"Please {action}."
    )


# ── CLI path (dev) ────────────────────────────────────────────────────────────
# asyncio.create_subprocess_exec is not supported on Windows SelectorEventLoop,
# so we run the claude CLI via subprocess in a thread instead.

async def _cli_run(prompt_path: Path, user_message: str) -> str:
    """Blocking Claude CLI call — offloaded to a thread for Windows compat."""
    result = await asyncio.to_thread(
        subprocess.run,
        ["claude", "-p", user_message,
         "--system-prompt-file", str(prompt_path),
         "--output-format", "text"],
        capture_output=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"claude CLI exited {result.returncode}: {result.stderr.decode().strip()}")
    return result.stdout.decode()


async def _cli_stream(prompt_path: Path, user_message: str):
    """Async generator — streams claude CLI output via a producer thread + queue."""
    line_queue: queue.Queue = queue.Queue()

    def _producer() -> None:
        try:
            with subprocess.Popen(
                ["claude", "-p", user_message,
                 "--system-prompt-file", str(prompt_path),
                 "--output-format", "stream-json",
                 "--include-partial-messages"],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
            ) as proc:
                assert proc.stdout is not None
                for raw in proc.stdout:
                    line_queue.put(raw)
        finally:
            line_queue.put(None)  # sentinel

    t = threading.Thread(target=_producer, daemon=True)
    t.start()

    while True:
        raw = await asyncio.to_thread(line_queue.get)
        if raw is None:
            break
        line = raw.decode().strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if (
            event.get("type") == "stream_event"
            and event.get("event", {}).get("delta", {}).get("type") == "text_delta"
        ):
            text = event["event"]["delta"]["text"]
            yield {"event": "chunk", "data": json.dumps({"text": text})}

    t.join()


# ── Anthropic API path (production) ──────────────────────────────────────────

async def _api_run(prompt: str, user_message: str) -> str:
    """Blocking Anthropic API call — returns full response text."""
    client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    message = await client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=4096,
        system=[{"type": "text", "text": prompt, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": user_message}],
    )
    return message.content[0].text


async def _api_stream(prompt: str, user_message: str):
    """Async generator — yields SSE dicts via Anthropic streaming API."""
    client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    async with client.messages.stream(
        model=CLAUDE_MODEL,
        max_tokens=4096,
        system=[{"type": "text", "text": prompt, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": user_message}],
    ) as stream:
        async for chunk in stream.text_stream:
            yield {"event": "chunk", "data": json.dumps({"text": chunk})}


# ── Public API ────────────────────────────────────────────────────────────────

async def run_triage(analysis_json: dict) -> dict:
    msg = _user_message(analysis_json, "triage this mix")

    if settings.use_claude_cli:
        text = await _cli_run(PROMPTS_DIR / "Triage.md", msg)
    else:
        text = await _api_run(load_prompt("Triage"), msg)

    return {
        "text": text,
        "recommended_specialists": extract_recommended_specialists(text),
    }


async def stream_specialist(specialist: str, analysis_json: dict):
    """Async generator yielding SSE-compatible dicts."""
    msg = _user_message(analysis_json, "analyze this mix")

    if settings.use_claude_cli:
        async for event in _cli_stream(PROMPTS_DIR / f"{specialist}.md", msg):
            yield event
    else:
        async for event in _api_stream(load_prompt(specialist), msg):
            yield event

    yield {"event": "done", "data": "{}"}
