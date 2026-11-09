"""Binary frame codec: header byte, vehicle id, timestamp, speed and a checksum."""

import struct
from dataclasses import dataclass

MAGIC = 0x7E
_FMT = ">BIQf"


@dataclass(frozen=True)
class Frame:
    vehicle_id: int
    timestamp_ms: int
    speed_kmh: float


def checksum(payload: bytes) -> int:
    """Simple additive checksum modulo 256."""
    return sum(payload) % 256


def encode(frame: Frame) -> bytes:
    """Encodes a frame and appends its checksum byte."""
    payload = struct.pack(_FMT, MAGIC, frame.vehicle_id, frame.timestamp_ms, frame.speed_kmh)
    return payload + bytes([checksum(payload)])


def decode(data: bytes) -> Frame:
    """Decodes a frame, validating magic and checksum."""
    payload, check = data[:-1], data[-1]
    if checksum(payload) != check:
        raise ValueError("bad checksum")
    magic, vehicle_id, ts, speed = struct.unpack(_FMT, payload)
    if magic != MAGIC:
        raise ValueError("bad magic")
    return Frame(vehicle_id, ts, speed)
