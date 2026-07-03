"""Story 4.2 (AR27/NFR25) — the send_email actor: the retry arm of the ONE
email pathway.

The BFF's QueueEmailSender renders (template registry lives THERE) and
enqueues finished ``(to, subject, html, template, from)`` here on the
``maintenance`` queue. This actor is deliberately dumb:

* no ``RESEND_API_KEY`` → log the send (masked) and succeed — the dev stack
  needs no Resend account;
* provider 5xx / 429 / network error → raise, so dramatiq's ``max_retries``
  backoff retries the send;
* provider 4xx (bad address, validation) → log + swallow — a permanently
  bad request must never spin the maintenance queue.

Env: RESEND_API_KEY (secret). The From address rides in the message (the
BFF's ResendOptions.FromAddress is the single source of truth).
"""
from __future__ import annotations

import hashlib
import logging
import os

import dramatiq

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"


def _mask(email: str) -> str:
    at = email.find("@")
    return f"{email[:2]}***{email[at:]}" if at > 1 else "***"


def _is_suppressed(to: str) -> bool:
    """Send-time recheck of the suppression list — closes the race where a
    bounce lands between enqueue (BFF check) and delivery/retries. FAIL-OPEN:
    the BFF's primary check already passed, so a DB blip must not eat a
    password reset; a suppressed-in-the-last-minutes send is the lesser harm.
    """
    try:
        from sqlalchemy import text

        from .db_sync import SessionFactory

        with SessionFactory() as s:
            row = s.execute(
                text("SELECT 1 FROM email_suppressions WHERE email = :e LIMIT 1"),
                {"e": to.strip().lower()},
            ).first()
            return row is not None
    except Exception:
        logger.warning("send_email: suppression recheck failed — sending anyway", exc_info=True)
        return False


def deliver(to: str, subject: str, html: str, template: str, from_address: str) -> str:
    """One delivery attempt. Returns 'stubbed' | 'sent' | 'rejected' |
    'suppressed'. Raises on retryable failures (5xx/429/network)."""
    api_key = os.environ.get("RESEND_API_KEY", "").strip()
    if not api_key:
        logger.info(
            "send_email: STUB (no RESEND_API_KEY) template=%s to=%s subject=%r",
            template, _mask(to), subject,
        )
        return "stubbed"

    if _is_suppressed(to):
        logger.info("send_email: suppressed at send time template=%s to=%s", template, _mask(to))
        return "suppressed"

    import httpx  # declared dep; imported lazily so stub mode needs nothing

    # Content-derived idempotency key: stable across dramatiq retries AND
    # same-day duplicate enqueues, so a timeout-after-accept never
    # double-sends (Resend dedupes for 24 h).
    idempotency_key = hashlib.sha256(
        f"{to}|{template}|{subject}|{html}".encode()
    ).hexdigest()[:32]

    resp = httpx.post(
        RESEND_API_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Idempotency-Key": f"spectr/{idempotency_key}",
        },
        json={"from": from_address, "to": [to], "subject": subject, "html": html},
        timeout=30.0,
    )
    if resp.status_code >= 500 or resp.status_code == 429:
        # Transient — raise so dramatiq retries with backoff. Status only:
        # never echo the response body (it can contain the address) and the
        # exception text ends up in dramatiq's failure logs.
        raise RuntimeError(f"resend transient failure: HTTP {resp.status_code}")
    if resp.status_code >= 400:
        # Permanent (bad address, validation) — never spin the queue on it.
        # Status only — Resend validation bodies echo the recipient address.
        logger.warning(
            "send_email: REJECTED template=%s to=%s status=%d",
            template, _mask(to), resp.status_code,
        )
        return "rejected"
    logger.info("send_email: sent template=%s to=%s", template, _mask(to))
    return "sent"


@dramatiq.actor(
    actor_name="send_email",
    queue_name="maintenance",  # AR27 — retry semantics, never analysis lanes
    max_retries=3,             # exponential backoff on transient failures
    time_limit=60_000,
)
def send_email(to: str, subject: str, html: str, template: str, from_address: str) -> None:
    deliver(to, subject, html, template, from_address)
