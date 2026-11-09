"""Down-samples a stream of readings."""

from .codec import Frame


class Sampler:
    """Keeps every n-th reading per vehicle."""

    def __init__(self, every=1):
        self.every = max(1, every)
        self._seen = {}

    def accept(self, frame: Frame) -> bool:
        count = self._seen.get(frame.vehicle_id, 0)
        self._seen[frame.vehicle_id] = count + 1
        return count % self.every == 0

    def reset(self):
        self._seen.clear()
