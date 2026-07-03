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

import logging
import os

import dramatiq

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"


def _mask(email: str) -> str:
    at = email.find("@")
    return f"{email[:2]}***{email[at:]}" if at > 1 else "***"


def deliver(to: str, subject: str, html: str, template: str, from_address: str) -> str:
    """One delivery attempt. Returns 'stubbed' | 'sent' | 'rejected'.
    Raises on retryable failures (5xx/429/network)."""
    api_key = os.environ.get("RESEND_API_KEY", "").strip()
    if not api_key:
        logger.info(
            "send_email: STUB (no RESEND_API_KEY) template=%s to=%s subject=%r",
            template, _mask(to), subject,
        )
        return "stubbed"

    import httpx  # declared dep; imported lazily so stub mode needs nothing

    resp = httpx.post(
        RESEND_API_URL,
        headers={"Authorization": f"Bearer {api_key}"},
        json={"from": from_address, "to": [to], "subject": subject, "html": html},
        timeout=30.0,
    )
    if resp.status_code >= 500 or resp.status_code == 429:
        # Transient — raise so dramatiq retries with backoff.
        raise RuntimeError(f"resend transient failure: HTTP {resp.status_code}")
    if resp.status_code >= 400:
        # Permanent (bad address, validation) — never spin the queue on it.
        logger.warning(
            "send_email: REJECTED template=%s to=%s status=%d body=%s",
            template, _mask(to), resp.status_code, resp.text[:500],
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
