import logging
from celery.signals import worker_ready

logger = logging.getLogger(__name__)


@worker_ready.connect
def preload_models(sender, **kwargs):
    try:
        from audio_analysis.models import get_model
        get_model("demucs")
        logger.info("Demucs model loaded — worker ready")
    except Exception as exc:
        logger.warning(f"Model preload failed (non-fatal): {exc}")
