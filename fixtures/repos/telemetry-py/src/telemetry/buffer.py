"""Fixed-capacity ring buffer that drops the oldest frame when full."""


class RingBuffer:
    def __init__(self, capacity):
        if capacity <= 0:
            raise ValueError("capacity must be positive")
        self._items = [None] * capacity
        self._start = 0
        self._size = 0
        self.dropped = 0

    def __len__(self):
        return self._size

    @property
    def capacity(self):
        return len(self._items)

    def push(self, item):
        """Appends an item, overwriting the oldest one when the buffer is full."""
        end = (self._start + self._size) % self.capacity
        self._items[end] = item
        if self._size == self.capacity:
            self._start = (self._start + 1) % self.capacity
            self.dropped += 1
        else:
            self._size += 1

    def drain(self):
        """Returns all items oldest first and empties the buffer."""
        out = [self._items[(self._start + i) % self.capacity] for i in range(self._size)]
        self._start = 0
        self._size = 0
        return out
