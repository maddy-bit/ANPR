import os
import subprocess
import sys
import unittest


class ProductionQueueConfigTests(unittest.TestCase):
    def test_production_cannot_disable_durable_queue_fallback_guard(self):
        env = os.environ.copy()
        env["NODE_ENV"] = "production"
        env["STRICT_QUEUE_DURABILITY"] = "false"
        env.pop("REDIS_URL", None)
        result = subprocess.run(
            [sys.executable, "-c", "from services.redis_service import STRICT_QUEUE_DURABILITY; print(STRICT_QUEUE_DURABILITY)"],
            check=True,
            capture_output=True,
            text=True,
            env=env,
        )
        self.assertEqual(result.stdout.strip(), "True")

    def test_local_development_can_keep_explicit_non_durable_fallback(self):
        env = os.environ.copy()
        env["NODE_ENV"] = "development"
        env["STRICT_QUEUE_DURABILITY"] = "false"
        env.pop("REDIS_URL", None)
        result = subprocess.run(
            [sys.executable, "-c", "from services.redis_service import STRICT_QUEUE_DURABILITY; print(STRICT_QUEUE_DURABILITY)"],
            check=True,
            capture_output=True,
            text=True,
            env=env,
        )
        self.assertEqual(result.stdout.strip(), "False")


if __name__ == "__main__":
    unittest.main()

