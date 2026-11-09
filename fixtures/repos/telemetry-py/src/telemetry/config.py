"""Runtime configuration loaded from the environment."""

import os
from dataclasses import dataclass

DEFAULT_BUFFER_SIZE = 256


@dataclass(frozen=True)
class Config:
    buffer_size: int = DEFAULT_BUFFER_SIZE
    sample_every: int = 1
    sink_url: str = "memory://"

    @classmethod
    def from_env(cls, env=None):
        """Builds a config from TELEMETRY_* variables, falling back to defaults."""
        env = os.environ if env is None else env
        return cls(
            buffer_size=int(env.get("TELEMETRY_BUFFER", DEFAULT_BUFFER_SIZE)),
            sample_every=int(env.get("TELEMETRY_SAMPLE_EVERY", 1)),
            sink_url=env.get("TELEMETRY_SINK", "memory://"),
        )
