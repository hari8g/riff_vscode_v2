import pytest

from telemetry.codec import Frame, decode, encode


def test_roundtrip():
    f = Frame(7, 1700000000000, 42.5)
    assert decode(encode(f)) == f


def test_bad_checksum_rejected():
    data = bytearray(encode(Frame(1, 2, 3.0)))
    data[-1] ^= 0xFF
    with pytest.raises(ValueError):
        decode(bytes(data))
