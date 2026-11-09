#include "hal.h"

/* Host-side HAL stub: loops written bytes back to reads. */
static uint8_t loop_buf[256];
static int loop_head = 0;
static int loop_tail = 0;
static uint32_t ticks = 0;

int hal_put(int port, uint8_t byte) {
    (void)port;
    loop_buf[loop_head] = byte;
    loop_head = (loop_head + 1) % 256;
    return 0;
}

int hal_get(int port, uint8_t *byte) {
    (void)port;
    if (loop_tail == loop_head) {
        return -1;
    }
    *byte = loop_buf[loop_tail];
    loop_tail = (loop_tail + 1) % 256;
    return 0;
}

uint32_t hal_millis(void) {
    return ticks++;
}
