import pytest

from telemetry.codec import Frame
from telemetry.config import Config
from telemetry.pipeline import Pipeline
from telemetry.sinks import FailingSink, MemorySink


def test_flush_writes_batch():
    sink = MemorySink()
    p = Pipeline(Config(buffer_size=8), sink=sink)
    p.submit(Frame(1, 1, 10.0))
    assert p.flush() == 1
    assert len(sink.batches) == 1


def test_failed_flush_keeps_frames():
    p = Pipeline(Config(buffer_size=8), sink=FailingSink())
    p.submit(Frame(1, 1, 10.0))
    with pytest.raises(IOError):
        p.flush()
    assert len(p.buffer) == 1
