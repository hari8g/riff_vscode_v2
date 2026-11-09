"""Destinations for encoded frames."""


class Sink:
    def write(self, batch):
        raise NotImplementedError


class MemorySink(Sink):
    """Collects batches in memory (tests and demos)."""

    def __init__(self):
        self.batches = []

    def write(self, batch):
        self.batches.append(list(batch))


class FailingSink(Sink):
    """Always raises; used to test retry behaviour."""

    def write(self, batch):
        raise IOError("sink unavailable")


def make_sink(url):
    """Creates a sink from a URL; only memory:// is built in."""
    if url.startswith("memory://"):
        return MemorySink()
    raise ValueError(f"unsupported sink {url}")
