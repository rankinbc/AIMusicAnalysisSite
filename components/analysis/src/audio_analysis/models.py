"""Singleton model loader — heavy ML models loaded once per process."""

import threading
from typing import Any, Literal
import logging

logger = logging.getLogger(__name__)

_MODELS: dict[str, Any] = {}
_LOCK = threading.Lock()


def get_model(name: Literal["demucs", "openl3"]) -> Any:
    """Return a cached model by name, loading it on first access.

    Uses a double-checked locking pattern so that concurrent callers never
    load the same model twice.  Returns ``None`` when the optional ML
    dependency is not installed.
    """
    if name in _MODELS:
        return _MODELS[name]
    with _LOCK:
        if name in _MODELS:
            return _MODELS[name]
        if name == "demucs":
            try:
                from demucs.api import Separator

                model = Separator(model="htdemucs_ft", segment=7)
                _MODELS[name] = model
                logger.info("Demucs model loaded")
            except ImportError:
                logger.warning("demucs not installed; stem separation unavailable")
                _MODELS[name] = None
        elif name == "openl3":
            try:
                import torchopenl3

                model = torchopenl3.load_audio_embedding_model(
                    input_repr="mel256", content_type="music", embedding_size=512
                )
                _MODELS[name] = model
                logger.info("torchopenl3 model loaded")
            except ImportError:
                logger.warning("torchopenl3 not installed; genre embedding unavailable")
                _MODELS[name] = None
        else:
            raise ValueError(f"Unknown model: {name}")
    return _MODELS[name]
