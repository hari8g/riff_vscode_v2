#include "uart.h"
#include "crc.h"
#include "hal.h"

void uart_init(uart_t *u, int port) {
    u->port = port;
    u->errors = 0;
    ring_init(&u->rx);
}

/* Writes len bytes; returns bytes written or -1 on the first HAL error. */
int uart_write(uart_t *u, const uint8_t *buf, size_t len) {
    for (size_t i = 0; i < len; i++) {
        if (hal_put(u->port, buf[i]) != 0) {
            u->errors++;
            return -1;
        }
    }
    return (int)len;
}

/* Moves any pending HAL bytes into the rx ring; returns bytes moved. */
int uart_poll(uart_t *u) {
    uint8_t b;
    int moved = 0;
    while (hal_get(u->port, &b) == 0) {
        if (ring_push(&u->rx, b) != 0) {
            u->errors++;
            break;
        }
        moved++;
    }
    return moved;
}

int uart_read(uart_t *u, uint8_t *byte) {
    return ring_pop(&u->rx, byte);
}

/* Sends payload followed by its CRC-16, big-endian. */
int uart_send_frame(uart_t *u, const uint8_t *payload, size_t len) {
    uint16_t crc = crc16(payload, len);
    uint8_t tail[2] = {(uint8_t)(crc >> 8), (uint8_t)(crc & 0xFF)};
    if (uart_write(u, payload, len) < 0) {
        return -1;
    }
    return uart_write(u, tail, 2);
}
