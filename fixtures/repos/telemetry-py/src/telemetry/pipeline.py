"""Sample → encode → buffer → flush to a sink."""

from .buffer import RingBuffer
from .codec import encode
from .config import Config
from .sampler import Sampler
from .sinks import make_sink


class Pipeline:
    def __init__(self, config: Config, sink=None):
        self.config = config
        self.sampler = Sampler(config.sample_every)
        self.buffer = RingBuffer(config.buffer_size)
        self.sink = sink if sink is not None else make_sink(config.sink_url)

    def submit(self, frame):
        """Samples and buffers one frame; returns True when it was kept."""
        if not self.sampler.accept(frame):
            return False
        self.buffer.push(encode(frame))
        return True

    def flush(self):
        """Writes buffered frames to the sink; frames are kept if the sink fails."""
        batch = self.buffer.drain()
        if not batch:
            return 0
        try:
            self.sink.write(batch)
        except IOError:
            for item in batch:
                self.buffer.push(item)
            raise
        return len(batch)
