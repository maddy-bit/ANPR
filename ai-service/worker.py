"""Standalone Redis Streams consumer process for horizontally scalable AI inference."""

import asyncio
import logging
import os
import signal

from main import run_queue_workers, set_main_event_loop, stop_queue_workers, verify_worker_model_runtime
from services.redis_service import redis_service


logger = logging.getLogger("cityai.worker")


async def serve() -> None:
    loop = asyncio.get_running_loop()
    set_main_event_loop(loop)
    await redis_service.initialize()

    health = await redis_service.check_health()
    if health.get("status") != "UP":
        raise RuntimeError("The standalone inference worker requires a healthy Redis connection")
    if os.environ.get("NODE_ENV", "development").lower() == "production" and health.get("durable") is not True:
        raise RuntimeError("Production inference workers require persistent Redis AOF or a successful RDB snapshot")

    model_status = verify_worker_model_runtime()
    logger.info(
        "AI inference worker is ready (queue=%s, model_artifacts=%s)",
        health.get("mode", "UNKNOWN"),
        model_status.get("status", "UNKNOWN"),
    )

    for shutdown_signal in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(shutdown_signal, stop_queue_workers)
        except (NotImplementedError, RuntimeError):
            # Some development event loops do not support OS signal handlers.
            pass

    try:
        await run_queue_workers()
    finally:
        stop_queue_workers()
        set_main_event_loop(None)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(serve())
