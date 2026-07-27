"""Dramatiq Redis wire format — the single owner of the queue contract.

Mirrors the BFF's IJobQueue.EnqueueCoreAsync and dramatiq's RedisBroker:
  dramatiq:<queue>       LIST of redis_message_ids (RPUSH enqueue, LPOP fetch)
  dramatiq:<queue>.msgs  HASH redis_message_id -> JSON envelope
options.redis_message_id must equal the LIST/HASH key or the worker
KeyErrors on ack.
"""
import json
import time
import uuid

NAMESPACE = "dramatiq"
QUEUES = ["analysis-paid", "analysis-free", "coach", "maintenance"]


def queue_key(queue: str) -> str:
    return f"{NAMESPACE}:{queue}"


def msgs_key(queue: str) -> str:
    return f"{NAMESPACE}:{queue}.msgs"


def build_envelope(actor_name: str, args: list, queue_name: str) -> tuple[str, str]:
    rid = str(uuid.uuid4())
    envelope = {
        "queue_name": queue_name,
        "actor_name": actor_name,
        "args": args,
        "kwargs": {},
        "options": {"redis_message_id": rid},
        "message_id": str(uuid.uuid4()),
        "message_timestamp": int(time.time() * 1000),
    }
    return rid, json.dumps(envelope)


def parse_envelope(raw) -> dict:
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", errors="replace")
    try:
        m = json.loads(raw)
        return {
            "actor_name": m.get("actor_name"),
            "args": m.get("args", []),
            "message_id": m.get("message_id"),
            "redis_message_id": m.get("options", {}).get("redis_message_id"),
            "queue_name": m.get("queue_name"),
            "message_timestamp": m.get("message_timestamp"),
        }
    except (json.JSONDecodeError, AttributeError) as e:
        return {"parse_error": str(e), "raw": raw[:500]}
