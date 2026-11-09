from telemetry.buffer import RingBuffer


def test_drops_oldest_when_full():
    b = RingBuffer(2)
    for i in range(3):
        b.push(i)
    assert b.drain() == [1, 2]
    assert b.dropped == 1


def test_drain_empties():
    b = RingBuffer(3)
    b.push("a")
    b.drain()
    assert len(b) == 0
