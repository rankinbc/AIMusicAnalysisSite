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


HEARTBEATS_KEY = f"{NAMESPACE}:__heartbeats__"


def enqueue(r, actor_name: str, args: list, queue: str) -> str:
    rid, payload = build_envelope(actor_name, args, queue)
    pipe = r.pipeline(transaction=True)
    pipe.hset(msgs_key(queue), rid, payload)
    pipe.rpush(queue_key(queue), rid)
    pipe.execute()
    return rid


def list_queue(r, queue: str) -> list[dict]:
    ids = [i.decode() if isinstance(i, bytes) else i
           for i in r.lrange(queue_key(queue), 0, -1)]
    if not ids:
        return []
    raws = r.hmget(msgs_key(queue), ids)
    rows = []
    for pos, (rid, raw) in enumerate(zip(ids, raws)):
        row = parse_envelope(raw) if raw is not None else {"parse_error": "payload missing from .msgs hash", "raw": ""}
        row["redis_message_id"] = row.get("redis_message_id") or rid
        row["position"] = pos
        rows.append(row)
    return rows


def cancel_message(r, queue: str, rid: str) -> bool:
    pipe = r.pipeline(transaction=True)
    pipe.lrem(queue_key(queue), 0, rid)
    pipe.hdel(msgs_key(queue), rid)
    removed, _ = pipe.execute()
    return removed > 0


_FRONT_LUA = """
local removed = redis.call('LREM', KEYS[1], 0, ARGV[1])
if removed > 0 then
  redis.call('LPUSH', KEYS[1], ARGV[1])
  return 1
end
return 0
"""


def bring_to_front(r, queue: str, rid: str) -> bool:
    # Lua = atomic check-then-move; a plain MULTI cannot conditionally LPUSH,
    # and LPUSH-then-undo briefly exposes a phantom id to the worker.
    return bool(r.eval(_FRONT_LUA, 1, queue_key(queue), rid))


def heartbeat_age_seconds(r):
    top = r.zrange(HEARTBEATS_KEY, -1, -1, withscores=True)
    if not top:
        return None
    now_ms = time.time() * 1000
    return max(0.0, (now_ms - top[0][1]) / 1000)
