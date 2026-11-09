#ifndef UART_H
#define UART_H

#include <stddef.h>
#include <stdint.h>
#include "ring.h"

typedef struct uart {
    int port;
    ring_t rx;
    uint32_t errors;
} uart_t;

void uart_init(uart_t *u, int port);
int uart_write(uart_t *u, const uint8_t *buf, size_t len);
int uart_poll(uart_t *u);
int uart_read(uart_t *u, uint8_t *byte);
int uart_send_frame(uart_t *u, const uint8_t *payload, size_t len);

#endif
