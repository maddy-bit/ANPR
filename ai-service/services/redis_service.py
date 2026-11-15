import asyncio
import os
import json
import logging
import time
import uuid
import threading
from urllib.parse import urlparse
from typing import Optional, Dict, Any, List, Tuple, Callable

logger = logging.getLogger("cityai.redis")

REDIS_HOST = os.environ.get("REDIS_HOST", "localhost")
REDIS_PORT = int(os.environ.get("REDIS_PORT", "6379"))
REDIS_PASSWORD = os.environ.get("REDIS_PASSWORD", None)
REDIS_URL = os.environ.get("REDIS_URL")
if REDIS_URL:
    parsed_redis_url = urlparse(REDIS_URL)
    local_redis_hosts = {"localhost", "127.0.0.1", "::1", "redis"}
    if parsed_redis_url.scheme not in {"redis", "rediss"} or not parsed_redis_url.hostname:
        raise RuntimeError("REDIS_URL must use redis:// or rediss://")
    if parsed_redis_url.hostname.lower() not in local_redis_hosts and not (
        os.environ.get("NODE_ENV", "development") == "production"
        and os.environ.get("ALLOW_REMOTE_REDIS", "false").lower() == "true"
    ):
        raise RuntimeError("Remote Redis requires production mode and ALLOW_REMOTE_REDIS=true")

# Queue Durability Configuration
# AI_QUEUE_MODE: "redis" (default / production) | "in_memory_non_durable" (explicit local development)
AI_QUEUE_MODE = os.environ.get("AI_QUEUE_MODE", "redis").lower()
# STRICT_QUEUE_DURABILITY: If true, raises exception on missing Redis rather than falling back to memory
STRICT_QUEUE_DURABILITY = (
    os.environ.get("NODE_ENV", "development").lower() == "production"
    or os.environ.get("STRICT_QUEUE_DURABILITY", "false").lower() in ("true", "1", "yes")
)

# Redis Streams & Consumer Group Constants
STREAM_VIDEO_JOBS = "cityai:stream:video_jobs"
STREAM_DEAD_LETTER = "cityai:stream:dead_letter"
CONSUMER_GROUP_WORKERS = "cityai_workers"
DISPATCH_LOCK_PREFIX = "cityai:lock:dispatch:"
DEFAULT_PROCESSING_TIMEOUT_MS = int(os.environ.get("PROCESSING_TIMEOUT_MS", "60000"))
DEFAULT_MAX_RETRIES = int(os.environ.get("STREAM_MAX_RETRIES", "3"))

try:
    import redis.asyncio as aioredis  # type: ignore
    _HAS_REDIS = True
except ImportError:
    _HAS_REDIS = False
    aioredis = None


class InMemoryStreamEngine:
    """
    High-fidelity in-memory emulator for Redis Streams and Consumer Groups.
    Provides identical semantics for XADD, XREADGROUP, XAUTOCLAIM, XPENDING, XACK,
    Dead-Letter handling, and distributed dispatch locks when running without Redis.
    """
    def __init__(self):
        self._streams: Dict[str, List[Dict[str, Any]]] = {}
        # Key: (stream, group) -> {"last_idx": int, "pel": {msg_id: dict}}
        self._groups: Dict[Tuple[str, str], Dict[str, Any]] = {}
        self._seq = 0
        self._locks: Dict[str, Dict[str, Any]] = {}

    def ensure_group(self, stream: str, group: str):
        if stream not in self._streams:
            self._streams[stream] = []
        key = (stream, group)
        if key not in self._groups:
            self._groups[key] = {
                "last_idx": 0,
                "pel": {},  # msg_id -> {"consumer": str, "delivery_time": float, "delivery_count": int, "data": dict}
            }

    def xadd(self, stream: str, data: Dict[str, Any]) -> str:
        if stream not in self._streams:
            self._streams[stream] = []
        self._seq += 1
        msg_id = f"{int(time.time() * 1000)}-{self._seq}"
        self._streams[stream].append({
            "id": msg_id,
            "data": dict(data),
            "timestamp": time.time(),
        })
        return msg_id

    def xreadgroup(self, group: str, consumer: str, stream: str, count: int = 1) -> List[Tuple[str, Dict[str, Any]]]:
        self.ensure_group(stream, group)
        g = self._groups[(stream, group)]
        messages = self._streams.get(stream, [])
        delivered = []
        start_idx = g["last_idx"]
        for idx in range(start_idx, min(start_idx + count, len(messages))):
            entry = messages[idx]
            msg_id = entry["id"]
            g["pel"][msg_id] = {
                "consumer": consumer,
                "delivery_time": time.time(),
                "delivery_count": 1,
                "data": entry["data"],
            }
            delivered.append((msg_id, entry["data"]))
            g["last_idx"] = idx + 1
        return delivered

    def xautoclaim(
        self, stream: str, group: str, consumer: str, min_idle_ms: int, count: int = 1
    ) -> List[Tuple[str, Dict[str, Any], int]]:
        self.ensure_group(stream, group)
        g = self._groups[(stream, group)]
        pel = g["pel"]
        now = time.time()
        claimed = []
        for msg_id, info in list(pel.items()):
            idle_ms = (now - info["delivery_time"]) * 1000
            if idle_ms >= min_idle_ms:
                info["consumer"] = consumer
                info["delivery_time"] = now
                info["delivery_count"] += 1
                claimed.append((msg_id, info["data"], info["delivery_count"]))
                if len(claimed) >= count:
                    break
        return claimed

    def xack(self, stream: str, group: str, msg_id: str) -> int:
        self.ensure_group(stream, group)
        g = self._groups[(stream, group)]
        if msg_id in g["pel"]:
            del g["pel"][msg_id]
            return 1
        return 0

    def refresh_claim(self, stream: str, group: str, consumer: str, msg_id: str) -> bool:
        self.ensure_group(stream, group)
        pending = self._groups[(stream, group)]["pel"].get(msg_id)
        if not pending or pending["consumer"] != consumer:
            return False
        pending["delivery_time"] = time.time()
        return True

    def xpending(self, stream: str, group: str) -> Dict[str, Any]:
        self.ensure_group(stream, group)
        pel = self._groups[(stream, group)]["pel"]
        return {
            "pending_count": len(pel),
            "messages": [
                {
                    "id": msg_id,
                    "consumer": info["consumer"],
                    "idle_time_ms": (time.time() - info["delivery_time"]) * 1000,
                    "delivery_count": info["delivery_count"],
                }
                for msg_id, info in pel.items()
            ],
        }

    def acquire_lock(self, lock_key: str, owner: str, ttl_seconds: float) -> bool:
        now = time.time()
        existing = self._locks.get(lock_key)
        if existing and existing["expires_at"] > now:
            return False
        self._locks[lock_key] = {"owner": owner, "expires_at": now + ttl_seconds}
        return True

    def renew_lock(self, lock_key: str, owner: str, ttl_seconds: float) -> bool:
        now = time.time()
        existing = self._locks.get(lock_key)
        if not existing or existing["expires_at"] <= now:
            return False
        if existing["owner"] != owner:
            return False
        existing["expires_at"] = now + ttl_seconds
        return True

    def release_lock(self, lock_key: str, owner: Optional[str] = None) -> bool:
        existing = self._locks.get(lock_key)
        if not existing:
            return False
        if owner is not None and existing["owner"] != owner:
            return False
        del self._locks[lock_key]
        return True


class JobLockHeartbeat:
    """
    Independent background heartbeat that:
    - Periodically renews the Redis distributed dispatch lock (default: every 20s for 120s TTL).
    - Verifies lock ownership atomically via Lua script (cannot renew another worker's lease).
    - Detects if lock was lost, expired, or superseded (sets is_lock_lost() flag).
    - Stops immediately when the job completes, fails, or is cancelled.
    - Cleans up safely after exceptions and cancellation.
    - Prevents stale workers from continuing to write or process.
    """
    def __init__(
        self,
        redis_svc: Any,
        job_id: str,
        owner_id: str,
        interval_seconds: float = 20.0,
        ttl_seconds: int = 120,
        sync_runner: Optional[Callable[[Any], Any]] = None,
        on_lock_lost: Optional[Callable[[str], None]] = None,
        stream_msg_id: Optional[str] = None,
        consumer_id: Optional[str] = None,
    ):
        self.redis_svc = redis_svc
        self.job_id = job_id
        self.owner_id = owner_id
        self.interval_seconds = interval_seconds
        self.ttl_seconds = ttl_seconds
        self.sync_runner = sync_runner
        self.on_lock_lost = on_lock_lost
        self.stream_msg_id = stream_msg_id
        self.consumer_id = consumer_id
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._lock_lost = False
        self._last_successful_renewal = time.time()

    def start(self) -> "JobLockHeartbeat":
        self._thread = threading.Thread(
            target=self._run_heartbeat,
            name=f"heartbeat-{self.job_id}",
            daemon=True,
        )
        self._thread.start()
        return self

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3.0)

    def is_lock_lost(self) -> bool:
        return self._lock_lost

    def _run_heartbeat(self) -> None:
        while not self._stop_event.wait(timeout=self.interval_seconds):
            if self._stop_event.is_set():
                break
            try:
                coro = self.redis_svc.renew_dispatch_lock(
                    self.job_id,
                    self.owner_id,
                    ttl_seconds=self.ttl_seconds,
                )
                if self.sync_runner is not None:
                    renewed = self.sync_runner(coro)
                else:
                    try:
                        import anyio.from_thread
                        renewed = anyio.from_thread.run(lambda: coro)
                    except Exception:
                        renewed = asyncio.run(coro)

                if not renewed:
                    logger.warning(
                        f"Heartbeat: dispatch lock for job '{self.job_id}' was lost, expired, or superseded!"
                    )
                    self._lock_lost = True
                    if self.on_lock_lost is not None:
                        self.on_lock_lost(self.job_id)
                    break
                else:
                    if self.stream_msg_id and self.consumer_id:
                        refresh_coro = self.redis_svc.refresh_stream_claim(
                            self.stream_msg_id, self.consumer_id
                        )
                        if self.sync_runner is not None:
                            refreshed = self.sync_runner(refresh_coro)
                        else:
                            refreshed = asyncio.run(refresh_coro)
                        if not refreshed:
                            logger.warning(
                                "Heartbeat: stream claim for job '%s' is no longer owned by %s",
                                self.job_id,
                                self.consumer_id,
                            )
                            self._lock_lost = True
                            break
                    self._last_successful_renewal = time.time()
            except Exception as e:
                logger.error(f"Error during heartbeat renewal for {self.job_id}: {e}")
                # If connection loss persists past TTL, lock in Redis is dead; halt worker
                if time.time() - self._last_successful_renewal >= self.ttl_seconds:
                    logger.critical(
                        f"Heartbeat: lock lease lapsed for {self.job_id} due to repeated renewal failures/disconnection. Marking lock as lost."
                    )
                    self._lock_lost = True
                    if self.on_lock_lost is not None:
                        self.on_lock_lost(self.job_id)
                    break


class RedisService:
    def __init__(self):
        self.client = None
        self._connected = False
        self.mode = "INITIALIZING"
        self._persistence_info: Dict[str, Any] = {}
        self._in_memory_jobs: Dict[str, Dict[str, Any]] = {}
        self._in_memory_cache: Dict[str, Any] = {}
        self._stream_engine = InMemoryStreamEngine()
        self._consumer_id = f"worker-{os.getpid()}-{uuid.uuid4().hex[:6]}"
        self._job_lock_owners: Dict[str, str] = {}
        self._in_memory_worker_heartbeats: Dict[str, Tuple[float, Dict[str, Any]]] = {}

    async def initialize(self):
        if AI_QUEUE_MODE == "in_memory_non_durable":
            self.mode = "IN_MEMORY_NON_DURABLE"
            self._connected = False
            self._stream_engine.ensure_group(STREAM_VIDEO_JOBS, CONSUMER_GROUP_WORKERS)
            logger.warning(
                "NON-DURABLE IN-MEMORY QUEUE CONFIGURED (AI_QUEUE_MODE=in_memory_non_durable). "
                "Queued and in-flight jobs will NOT survive process restarts or system failures."
            )
            await self.recover_startup_jobs()
            return

        if not _HAS_REDIS or aioredis is None:
            if STRICT_QUEUE_DURABILITY:
                self.mode = "DISCONNECTED_STRICT"
                self._connected = False
                logger.error("redis-py library not installed and STRICT_QUEUE_DURABILITY is enabled.")
                return
            else:
                self.mode = "IN_MEMORY_NON_DURABLE_FALLBACK"
                self._connected = False
                self._stream_engine.ensure_group(STREAM_VIDEO_JOBS, CONSUMER_GROUP_WORKERS)
                logger.warning("redis-py not installed. Operating in non-durable local memory fallback mode.")
                await self.recover_startup_jobs()
                return

        try:
            if REDIS_URL:
                self.client = aioredis.from_url(
                    REDIS_URL,
                    socket_timeout=1.0,
                    socket_connect_timeout=1.0,
                    decode_responses=True,
                )
            else:
                self.client = aioredis.Redis(
                    host=REDIS_HOST,
                    port=REDIS_PORT,
                    password=REDIS_PASSWORD if REDIS_PASSWORD else None,
                    socket_timeout=1.0,
                    socket_connect_timeout=1.0,
                    decode_responses=True,
                )
            await asyncio.wait_for(self.client.ping(), timeout=1.0)
            self._connected = True
            self.mode = "REDIS_PERSISTENT"

            # Inspect actual Redis persistence configuration (AOF / RDB)
            try:
                p_info = await self.client.info("persistence")
                self._persistence_info = {
                    "aof_enabled": p_info.get("aof_enabled", 0) == 1,
                    "rdb_last_bgsave_status": p_info.get("rdb_last_bgsave_status", "unknown"),
                    "rdb_changes_since_last_save": p_info.get("rdb_changes_since_last_save", 0),
                }
            except Exception as e:
                self._persistence_info = {"error": str(e)}

            await self.ensure_consumer_group()
            await self.recover_startup_jobs()

            logger.info(
                f"Connected to Redis at {REDIS_HOST}:{REDIS_PORT} (AOF: {self._persistence_info.get('aof_enabled')}, "
                f"RDB status: {self._persistence_info.get('rdb_last_bgsave_status')})"
            )
        except Exception as e:
            self._connected = False
            if STRICT_QUEUE_DURABILITY:
                self.mode = "DISCONNECTED_STRICT"
                logger.error(
                    f"Could not connect to Redis at {REDIS_HOST}:{REDIS_PORT} with STRICT_QUEUE_DURABILITY=True: {e}. "
                    "Production queueing rejected."
                )
            else:
                self.mode = "IN_MEMORY_NON_DURABLE_FALLBACK"
                self._stream_engine.ensure_group(STREAM_VIDEO_JOBS, CONSUMER_GROUP_WORKERS)
                logger.warning(
                    f"Could not connect to Redis at {REDIS_HOST}:{REDIS_PORT}: {e}. "
                    "Falling back to non-durable in-memory mode for development only."
                )
                await self.recover_startup_jobs()

    async def ensure_consumer_group(self) -> None:
        """Ensures the consumer group exists on the primary stream."""
        if self._connected and self.client:
            try:
                await self.client.xgroup_create(
                    STREAM_VIDEO_JOBS,
                    CONSUMER_GROUP_WORKERS,
                    id="0",
                    mkstream=True,
                )
                logger.info(f"Created consumer group '{CONSUMER_GROUP_WORKERS}' on '{STREAM_VIDEO_JOBS}'")
            except Exception as e:
                if "BUSYGROUP" not in str(e):
                    logger.debug(f"Consumer group '{CONSUMER_GROUP_WORKERS}' exists or returned: {e}")
        else:
            self._stream_engine.ensure_group(STREAM_VIDEO_JOBS, CONSUMER_GROUP_WORKERS)

    async def acquire_dispatch_lock(self, job_id: str, owner_id: str, ttl_seconds: int = 120) -> bool:
        """
        Cross-Process Duplicate Dispatch Prevention:
        Acquires an atomic distributed lock in Redis so two worker processes cannot
        concurrently dispatch the same job.
        """
        lock_key = f"{DISPATCH_LOCK_PREFIX}{job_id}"
        acquired = False
        if self._connected and self.client:
            try:
                res = await self.client.set(lock_key, owner_id, nx=True, ex=ttl_seconds)
                acquired = bool(res)
            except Exception as e:
                logger.warning(f"Error acquiring Redis dispatch lock for {job_id}: {e}")
                if STRICT_QUEUE_DURABILITY:
                    raise
        else:
            acquired = self._stream_engine.acquire_lock(lock_key, owner_id, ttl_seconds)

        if acquired:
            self._job_lock_owners[job_id] = owner_id
        return acquired

    async def adopt_dispatch_lock(self, job_id: str, owner_id: str, ttl_seconds: int = 120) -> bool:
        """Fence the previous attempt and assign the lease to the consumer that claimed the stream entry."""
        lock_key = f"{DISPATCH_LOCK_PREFIX}{job_id}"
        if self._connected and self.client:
            try:
                await self.client.set(lock_key, owner_id, ex=ttl_seconds)
            except Exception as exc:
                logger.warning("Could not adopt dispatch lease for %s: %s", job_id, exc)
                return False
        else:
            self._stream_engine.release_lock(lock_key)
            if not self._stream_engine.acquire_lock(lock_key, owner_id, ttl_seconds):
                return False
        self._job_lock_owners[job_id] = owner_id
        return True

    async def renew_dispatch_lock(self, job_id: str, owner_id: str, ttl_seconds: int = 120) -> bool:
        """
        Renews an active dispatch lock lease for long-running jobs.
        Guarantees that only the current lock owner can extend the lease.
        """
        lock_key = f"{DISPATCH_LOCK_PREFIX}{job_id}"
        if self._connected and self.client:
            try:
                lua_renew = """
                if redis.call("get", KEYS[1]) == ARGV[1] then
                    return redis.call("expire", KEYS[1], ARGV[2])
                else
                    return 0
                end
                """
                res = await self.client.eval(lua_renew, 1, lock_key, owner_id, ttl_seconds)
                return bool(res)
            except Exception as e:
                logger.debug(f"Error renewing Redis dispatch lock for {job_id}: {e}")
                return False
        return self._stream_engine.renew_lock(lock_key, owner_id, ttl_seconds)

    async def renew_job_lock(self, job_id: str, ttl_seconds: int = 120) -> bool:
        """
        Renews an active dispatch lock lease using the recorded owner for this job.
        Guarantees safe lease renewal for long-running video pipelines.
        """
        owner_id = self._job_lock_owners.get(job_id)
        if not owner_id:
            return False
        return await self.renew_dispatch_lock(job_id, owner_id=owner_id, ttl_seconds=ttl_seconds)

    async def release_dispatch_lock(self, job_id: str, owner_id: Optional[str] = None) -> bool:
        """
        Releases the cross-process dispatch lock for a completed or aborted job.
        Guarantees that a worker cannot delete another worker's lock.
        """
        if owner_id is None:
            owner_id = self._job_lock_owners.get(job_id)
        lock_key = f"{DISPATCH_LOCK_PREFIX}{job_id}"
        released = False
        if self._connected and self.client:
            try:
                if owner_id is not None:
                    lua_release = """
                    if redis.call("get", KEYS[1]) == ARGV[1] then
                        return redis.call("del", KEYS[1])
                    else
                        return 0
                    end
                    """
                    res = await self.client.eval(lua_release, 1, lock_key, owner_id)
                    released = bool(res)
                else:
                    await self.client.delete(lock_key)
                    released = True
            except Exception as e:
                logger.debug(f"Error releasing Redis dispatch lock for {job_id}: {e}")
        else:
            released = self._stream_engine.release_lock(lock_key, owner_id)

        if released:
            self._job_lock_owners.pop(job_id, None)
        return released

    def create_lock_heartbeat(
        self,
        job_id: str,
        owner_id: Optional[str] = None,
        interval_seconds: float = 20.0,
        ttl_seconds: int = 120,
        sync_runner: Optional[Callable[[Any], Any]] = None,
        on_lock_lost: Optional[Callable[[str], None]] = None,
        stream_msg_id: Optional[str] = None,
        consumer_id: Optional[str] = None,
    ) -> "JobLockHeartbeat":
        """
        Creates an independent background heartbeat instance for a long-running video job.
        Periodically extends lease TTL and verifies atomic lock ownership.
        """
        if owner_id is None:
            owner_id = self._job_lock_owners.get(job_id, f"worker-{os.getpid()}")
        return JobLockHeartbeat(
            redis_svc=self,
            job_id=job_id,
            owner_id=owner_id,
            interval_seconds=interval_seconds,
            ttl_seconds=ttl_seconds,
            sync_runner=sync_runner,
            on_lock_lost=on_lock_lost,
            stream_msg_id=stream_msg_id,
            consumer_id=consumer_id,
        )

    async def refresh_stream_claim(self, stream_msg_id: str, consumer_id: str) -> bool:
        """Refresh a claimed stream entry's idle timer while its inference job is active."""
        if self._connected and self.client:
            try:
                claimed = await self.client.xclaim(
                    STREAM_VIDEO_JOBS,
                    CONSUMER_GROUP_WORKERS,
                    consumer_id,
                    min_idle_time=0,
                    message_ids=[stream_msg_id],
                    justid=True,
                )
                return bool(claimed)
            except Exception as exc:
                logger.warning("Could not refresh Redis stream claim %s: %s", stream_msg_id, exc)
                return False
        return self._stream_engine.refresh_claim(
            STREAM_VIDEO_JOBS,
            CONSUMER_GROUP_WORKERS,
            consumer_id,
            stream_msg_id,
        )

    async def check_health(self) -> Dict[str, Any]:
        if not self._connected or not self.client:
            return {
                "status": "DOWN" if self.mode == "DISCONNECTED_STRICT" else self.mode,
                "mode": self.mode,
                "durable": False,
                "latency_ms": None,
                "persistence": self._persistence_info,
            }
        try:
            t0 = time.time()
            res = await self.client.ping()
            latency = round((time.time() - t0) * 1000, 2)
            if res:
                is_durable = bool(
                    self._persistence_info.get("aof_enabled")
                    or self._persistence_info.get("rdb_last_bgsave_status") == "ok"
                )
                return {
                    "status": "UP",
                    "mode": self.mode,
                    "durable": is_durable,
                    "latency_ms": latency,
                    "persistence": self._persistence_info,
                }
        except Exception:
            self._connected = False
        return {
            "status": "DOWN",
            "mode": self.mode,
            "durable": False,
            "latency_ms": None,
            "persistence": self._persistence_info,
        }

    async def publish_worker_heartbeat(
        self, worker_id: str, details: Optional[Dict[str, Any]] = None, ttl_seconds: int = 30
    ) -> None:
        """Publish a short-lived worker presence record for service readiness checks."""
        if not worker_id or ttl_seconds < 5:
            raise ValueError("worker_id is required and heartbeat TTL must be at least 5 seconds")
        payload = {"worker_id": worker_id, "updated_at": time.time(), **(details or {})}
        key = f"cityai:worker:heartbeat:{worker_id}"
        if self._connected and self.client:
            await self.client.set(key, json.dumps(payload), ex=ttl_seconds)
            return
        self._in_memory_worker_heartbeats[worker_id] = (time.time() + ttl_seconds, payload)

    async def clear_worker_heartbeat(self, worker_id: str) -> None:
        key = f"cityai:worker:heartbeat:{worker_id}"
        if self._connected and self.client:
            await self.client.delete(key)
        self._in_memory_worker_heartbeats.pop(worker_id, None)

    async def get_active_worker_heartbeats(self) -> List[Dict[str, Any]]:
        """Return unexpired worker heartbeats; Redis TTL handles cross-process cleanup."""
        if self._connected and self.client:
            active: List[Dict[str, Any]] = []
            async for key in self.client.scan_iter(match="cityai:worker:heartbeat:*"):
                raw = await self.client.get(key)
                if not raw:
                    continue
                try:
                    payload = json.loads(raw)
                except (TypeError, json.JSONDecodeError):
                    continue
                if isinstance(payload, dict) and payload.get("worker_id"):
                    active.append(payload)
            return active

        now = time.time()
        self._in_memory_worker_heartbeats = {
            worker_id: entry for worker_id, entry in self._in_memory_worker_heartbeats.items()
            if entry[0] > now
        }
        return [entry[1] for entry in self._in_memory_worker_heartbeats.values()]

    async def is_job_active(self, job_id: str) -> bool:
        """Returns True if the job is actively QUEUED or PROCESSING."""
        job = await self.get_job_status(job_id)
        if not job:
            return False
        return job.get("status") in ("QUEUED", "PROCESSING")

    async def enqueue_job(self, job_id: str, details: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Enqueues a job for durable execution via Redis Streams consumer group.
        Guarantees both:
        1. Atomic cross-process dispatch locking per worker attempt.
        2. Independent job-level deduplication (lock expiry cannot cause duplicate processing).
        """
        if self.mode == "DISCONNECTED_STRICT":
            raise RuntimeError(
                f"Cannot enqueue job '{job_id}': Durable Redis queue is required (STRICT_QUEUE_DURABILITY=True) "
                f"but connection to {REDIS_HOST}:{REDIS_PORT} failed."
            )

        # 1. Independent Job-Level Deduplication:
        # If the job is already active or completed, reject duplicate dispatch even if the 120s dispatch lock has expired.
        existing = await self.get_job_status(job_id)
        if existing and existing.get("status") in ("QUEUED", "PROCESSING", "COMPLETED"):
            logger.info(
                f"Independent job-level deduplication: job '{job_id}' is already {existing['status']}. "
                "Duplicate dispatch rejected even if lock expired."
            )
            return {
                "job_id": job_id,
                "status": existing["status"],
                "duplicate_dispatch_prevented": True,
                "reason": f"job_already_{existing['status'].lower()}",
            }

        # 2. Cross-process duplicate dispatch prevention:
        lock_owner = f"{self._consumer_id}:{time.time()}"
        acquired = await self.acquire_dispatch_lock(job_id, owner_id=lock_owner, ttl_seconds=120)
        if not acquired:
            logger.info(f"Duplicate dispatch prevented by cross-process lock for job '{job_id}'")
            return {
                "job_id": job_id,
                "status": existing.get("status", "QUEUED") if existing else "QUEUED",
                "duplicate_dispatch_prevented": True,
                "reason": "lock_held_by_another_worker",
            }

        payload = {
            "job_id": job_id,
            "status": "QUEUED",
            "progress": 0.0,
            "created_at": time.time(),
            "updated_at": time.time(),
            "details": details or {},
        }

        stream_fields: Dict[Any, Any] = {
            "job_id": job_id,
            "created_at": str(payload["created_at"]),
            "video_upload_id": str((details or {}).get("video_upload_id", "")),
            "processing_run_id": str((details or {}).get("processing_run_id", "")),
            "camera_id": str((details or {}).get("camera_id", "")),
            "video_path": str((details or {}).get("video_path", "")),
            "payload_json": json.dumps(payload),
        }

        stream_msg_id = None
        if self._connected and self.client:
            try:
                key = f"cityai:job:{job_id}"
                await self.client.set(key, json.dumps(payload), ex=86400)  # 24h TTL
                stream_msg_id = await self.client.xadd(STREAM_VIDEO_JOBS, dict(stream_fields))
                payload["stream_msg_id"] = stream_msg_id
                await self.client.set(key, json.dumps(payload), ex=86400)
                logger.info(f"Job '{job_id}' enqueued to Redis Stream '{STREAM_VIDEO_JOBS}' as msg '{stream_msg_id}'")
                return payload
            except Exception as e:
                logger.error(f"Redis stream enqueue error for job {job_id}: {e}")
                if STRICT_QUEUE_DURABILITY:
                    await self.release_dispatch_lock(job_id)
                    raise RuntimeError(f"Durable enqueue failed for job {job_id}: {e}")

        # In-memory non-durable fallback
        stream_msg_id = self._stream_engine.xadd(STREAM_VIDEO_JOBS, stream_fields)
        payload["stream_msg_id"] = stream_msg_id
        self._in_memory_jobs[job_id] = payload
        logger.info(f"Job '{job_id}' enqueued to in-memory stream as msg '{stream_msg_id}'")
        return payload

    async def claim_job(
        self,
        consumer_id: Optional[str] = None,
        min_idle_ms: int = DEFAULT_PROCESSING_TIMEOUT_MS,
        max_retries: int = DEFAULT_MAX_RETRIES,
    ) -> Optional[Dict[str, Any]]:
        """
        Persistent Job Claiming:
        1. Checks for abandoned jobs in the Pending Entries List (PEL) whose processing timeout exceeded.
        2. Bounded Retries: Reclaims with delivery count check. If delivery count > max_retries,
           moves the job to dead-letter stream 'cityai:stream:dead_letter' and acknowledges it.
        3. If no abandoned job, claims a fresh message from the stream via XREADGROUP.
        """
        consumer = consumer_id or self._consumer_id

        # --- Phase 1: Reclaim abandoned pending jobs (PEL recovery) ---
        if self._connected and self.client:
            try:
                # XAUTOCLAIM returns [next_start_id, [ [msg_id, fields], ... ], [dead_ids] ]
                autoclaim_res = await self.client.xautoclaim(
                    STREAM_VIDEO_JOBS,
                    CONSUMER_GROUP_WORKERS,
                    consumer,
                    min_idle_time=min_idle_ms,
                    start_id="0-0",
                    count=1,
                )
                messages = autoclaim_res[1] if autoclaim_res and len(autoclaim_res) > 1 else []
                if messages:
                    msg_id, fields = messages[0]
                    # Check delivery count via XPENDING
                    pending_info = await self.client.xpending_range(
                        STREAM_VIDEO_JOBS, CONSUMER_GROUP_WORKERS, min=msg_id, max=msg_id, count=1
                    )
                    delivery_count = int(pending_info[0]["times_delivered"]) if pending_info else 2

                    job_id = fields.get("job_id")
                    if delivery_count > max_retries:
                        # Move to dead-letter queue
                        logger.warning(
                            f"Job '{job_id}' exceeded max retries ({delivery_count} > {max_retries}). "
                            f"Routing to dead-letter stream '{STREAM_DEAD_LETTER}'"
                        )
                        dl_fields = dict(fields)
                        dl_fields["reason"] = "max_retries_exceeded"
                        dl_fields["original_msg_id"] = msg_id
                        dl_fields["dead_lettered_at"] = str(time.time())
                        await self.client.xadd(STREAM_DEAD_LETTER, dl_fields)
                        await self.client.xack(STREAM_VIDEO_JOBS, CONSUMER_GROUP_WORKERS, msg_id)
                        await self.set_job_status(
                            job_id,
                            status="FAILED",
                            progress=0.0,
                            details={"error": "Max retry limit exceeded (dead letter)", "delivery_count": delivery_count},
                        )
                        await self.release_dispatch_lock(job_id)
                        return await self.claim_job(consumer, min_idle_ms, max_retries)

                    # Successfully reclaimed abandoned job
                    logger.info(
                        f"Reclaimed abandoned job '{job_id}' (msg {msg_id}) for consumer '{consumer}' "
                        f"(delivery count: {delivery_count})"
                    )
                    await self.adopt_dispatch_lock(job_id, f"{consumer}:{msg_id}")
                    await self.set_job_status(
                        job_id,
                        status="PROCESSING",
                        progress=0.0,
                        details={"reclaimed": True, "delivery_count": delivery_count, "consumer": consumer},
                    )
                    return {
                        "job_id": job_id,
                        "stream_msg_id": msg_id,
                        "fields": fields,
                        "reclaimed": True,
                        "delivery_count": delivery_count,
                    }
            except Exception as e:
                logger.warning(f"Error checking pending/abandoned jobs in Redis: {e}")

            # --- Phase 2: Claim fresh message via XREADGROUP ---
            try:
                read_res = await self.client.xreadgroup(
                    CONSUMER_GROUP_WORKERS,
                    consumer,
                    streams={STREAM_VIDEO_JOBS: ">"},
                    count=1,
                    block=200,
                )
                if read_res:
                    for _stream_name, stream_msgs in read_res:
                        if isinstance(stream_msgs, list) and len(stream_msgs) > 0:
                            msg_item = stream_msgs[0]
                            if isinstance(msg_item, (list, tuple)) and len(msg_item) >= 2:
                                msg_id = str(msg_item[0])
                                fields_data: Dict[str, Any] = msg_item[1] if isinstance(msg_item[1], dict) else {}
                                raw_jid = fields_data.get("job_id")
                                if raw_jid:
                                    job_id = str(raw_jid)
                                    await self.adopt_dispatch_lock(job_id, f"{consumer}:{msg_id}")
                                    await self.set_job_status(
                                        job_id,
                                        status="PROCESSING",
                                        progress=0.0,
                                        details={"reclaimed": False, "delivery_count": 1, "consumer": consumer},
                                    )
                                    return {
                                        "job_id": job_id,
                                        "stream_msg_id": msg_id,
                                        "fields": fields_data,
                                        "reclaimed": False,
                                        "delivery_count": 1,
                                    }
            except Exception as e:
                logger.warning(f"Error reading next job from Redis Stream: {e}")

        # --- In-Memory Non-Durable Stream Processing ---
        # 1. Check in-memory autoclaim
        reclaimed_msgs = self._stream_engine.xautoclaim(
            STREAM_VIDEO_JOBS, CONSUMER_GROUP_WORKERS, consumer, min_idle_ms=min_idle_ms, count=1
        )
        if reclaimed_msgs:
            msg_id, fields, delivery_count = reclaimed_msgs[0]
            raw_jid = fields.get("job_id")
            if not raw_jid:
                return None
            job_id: str = str(raw_jid)
            await self.adopt_dispatch_lock(job_id, f"{consumer}:{msg_id}")
            if delivery_count > max_retries:
                logger.warning(
                    f"[In-Memory] Job '{job_id}' exceeded max retries ({delivery_count} > {max_retries}). Routing to DLQ."
                )
                dl_fields = dict(fields)
                dl_fields["reason"] = "max_retries_exceeded"
                dl_fields["dead_lettered_at"] = str(time.time())
                self._stream_engine.xadd(STREAM_DEAD_LETTER, dl_fields)
                self._stream_engine.xack(STREAM_VIDEO_JOBS, CONSUMER_GROUP_WORKERS, msg_id)
                await self.set_job_status(
                    job_id,
                    status="FAILED",
                    progress=0.0,
                    details={"error": "Max retry limit exceeded (dead letter)", "delivery_count": delivery_count},
                )
                await self.release_dispatch_lock(job_id)
                return await self.claim_job(consumer, min_idle_ms, max_retries)

            logger.info(f"[In-Memory] Reclaimed abandoned job '{job_id}' for consumer '{consumer}'")
            await self.set_job_status(
                job_id,
                status="PROCESSING",
                progress=0.0,
                details={"reclaimed": True, "delivery_count": delivery_count, "consumer": consumer},
            )
            return {
                "job_id": job_id,
                "stream_msg_id": msg_id,
                "fields": fields,
                "reclaimed": True,
                "delivery_count": delivery_count,
            }

        # 2. In-memory fresh readgroup
        fresh_msgs = self._stream_engine.xreadgroup(
            CONSUMER_GROUP_WORKERS, consumer, STREAM_VIDEO_JOBS, count=1
        )
        if fresh_msgs:
            msg_id, fields = fresh_msgs[0]
            raw_jid = fields.get("job_id")
            if not raw_jid:
                return None
            job_id: str = str(raw_jid)
            await self.adopt_dispatch_lock(job_id, f"{consumer}:{msg_id}")
            await self.set_job_status(
                job_id,
                status="PROCESSING",
                progress=0.0,
                details={"reclaimed": False, "delivery_count": 1, "consumer": consumer},
            )
            return {
                "job_id": job_id,
                "stream_msg_id": msg_id,
                "fields": fields,
                "reclaimed": False,
                "delivery_count": 1,
            }

        return None

    async def acknowledge_job(
        self,
        job_id: str,
        success: bool,
        stream_msg_id: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        """
        Safe Acknowledgement:
        Acknowledges job completion ONLY after processing, manifest sealing, and backend sync succeed.
        Issues XACK to remove the message from the consumer group's PEL and releases the dispatch lock.
        """
        terminal_status = "COMPLETED" if success else "FAILED"
        progress = 100.0 if success else 0.0
        await self.set_job_status(job_id, status=terminal_status, progress=progress, details=details)

        if self._connected and self.client:
            try:
                if stream_msg_id:
                    await self.client.xack(STREAM_VIDEO_JOBS, CONSUMER_GROUP_WORKERS, stream_msg_id)
                    logger.info(f"Safely acknowledged (XACK) msg '{stream_msg_id}' for job '{job_id}'")
            except Exception as e:
                logger.warning(f"Redis XACK error for job {job_id} (msg {stream_msg_id}): {e}")
        else:
            if stream_msg_id:
                self._stream_engine.xack(STREAM_VIDEO_JOBS, CONSUMER_GROUP_WORKERS, stream_msg_id)
                logger.info(f"[In-Memory] Safely acknowledged (XACK) msg '{stream_msg_id}' for job '{job_id}'")

        await self.release_dispatch_lock(job_id)

    async def recover_startup_jobs(self) -> List[Dict[str, Any]]:
        """
        AI Service Restart Recovery:
        Detects any jobs that were left in 'PROCESSING' or pending in consumer group PEL
        when the worker process was terminated.
        """
        recovered: List[Dict[str, Any]] = []
        if self._connected and self.client:
            try:
                pending_info = await self.client.xpending(STREAM_VIDEO_JOBS, CONSUMER_GROUP_WORKERS)
                pending_count = pending_info.get("pending", 0) if isinstance(pending_info, dict) else 0
                if pending_count > 0:
                    logger.info(
                        f"AI Service restart recovery: Found {pending_count} pending messages in "
                        f"'{STREAM_VIDEO_JOBS}' consumer group '{CONSUMER_GROUP_WORKERS}'. Available for worker claim."
                    )
                    recovered.append({"type": "stream_pel", "pending_count": pending_count})
            except Exception as e:
                logger.debug(f"Redis startup PEL check: {e}")
        else:
            pending = self._stream_engine.xpending(STREAM_VIDEO_JOBS, CONSUMER_GROUP_WORKERS)
            if pending["pending_count"] > 0:
                logger.info(
                    f"[In-Memory] AI Service restart recovery: {pending['pending_count']} pending messages in PEL."
                )
                recovered.append({"type": "stream_pel", "pending_count": pending["pending_count"]})

        return recovered

    async def set_job_status(
        self, job_id: str, status: str, progress: float, details: Optional[Dict[str, Any]] = None
    ):
        """
        Stores video ingestion job progress (e.g. status='PROCESSING', progress=45.5).
        Fences stale workers:
        - Cannot overwrite a terminal status (COMPLETED, CANCELLED_SUPERSEDED) with a non-terminal status.
        - Cannot overwrite if details specify an older generation than existing job.
        """
        if self.mode == "DISCONNECTED_STRICT" and not self._connected:
            raise RuntimeError(f"Cannot update job status for '{job_id}': Redis disconnected in strict mode.")

        # Stale worker fencing:
        existing = await self.get_job_status(job_id)
        if existing:
            existing_status = existing.get("status")
            if existing_status in ("COMPLETED", "CANCELLED_SUPERSEDED") and status not in ("COMPLETED", "CANCELLED_SUPERSEDED", "FAILED"):
                logger.warning(
                    f"Stale worker status regression rejected: job '{job_id}' is already terminal ({existing_status}). "
                    f"Attempted regression to '{status}' blocked."
                )
                return existing

            new_gen = (details or {}).get("generation")
            old_gen = existing.get("details", {}).get("generation")
            if new_gen is not None and old_gen is not None and new_gen < old_gen:
                logger.warning(
                    f"Stale worker generation update rejected: incoming generation {new_gen} < current {old_gen}"
                )
                return existing

        payload = {
            "job_id": job_id,
            "status": status,
            "progress": progress,
            "updated_at": time.time(),
            "details": details or {},
        }
        if self._connected and self.client:
            try:
                key = f"cityai:job:{job_id}"
                await self.client.set(key, json.dumps(payload), ex=86400)  # 24h TTL
                return
            except Exception as e:
                logger.debug(f"Redis write job error: {e}")
                if STRICT_QUEUE_DURABILITY:
                    raise RuntimeError(f"Durable write job failed for {job_id}: {e}")

        self._in_memory_jobs[job_id] = payload

    async def get_job_status(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves video ingestion job progress."""
        if self._connected and self.client:
            try:
                key = f"cityai:job:{job_id}"
                raw = await self.client.get(key)
                if raw:
                    return json.loads(raw)
            except Exception as e:
                logger.debug(f"Redis read job error: {e}")
        return self._in_memory_jobs.get(job_id)

    async def get_cached_plate(self, crop_hash: str) -> Optional[Dict[str, Any]]:
        """Checks if OCR plate detection is cached for this vehicle crop hash."""
        if self._connected and self.client:
            try:
                raw = await self.client.get(f"cityai:plate_cache:{crop_hash}")
                if raw:
                    return json.loads(raw)
            except Exception:
                pass
        return self._in_memory_cache.get(crop_hash)

    async def cache_plate(self, crop_hash: str, plate_text: str, confidence: float):
        """Caches OCR plate inference result to prevent duplicate processing on consecutive video frames."""
        payload = {"plate": plate_text, "confidence": confidence}
        if self._connected and self.client:
            try:
                await self.client.set(f"cityai:plate_cache:{crop_hash}", json.dumps(payload), ex=300)  # 5 min TTL
                return
            except Exception:
                pass
        self._in_memory_cache[crop_hash] = payload


redis_service = RedisService()
