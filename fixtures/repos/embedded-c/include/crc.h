#ifndef CRC_H
#define CRC_H

#include <stddef.h>
#include <stdint.h>

/* CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF. */
uint16_t crc16(const uint8_t *data, size_t len);
uint16_t crc16_update(uint16_t crc, uint8_t byte);

#endif
