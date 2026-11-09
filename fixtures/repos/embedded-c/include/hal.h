#ifndef HAL_H
#define HAL_H

#include <stdint.h>

/* Board support: one byte in, one byte out, millisecond tick. */
int hal_put(int port, uint8_t byte);
int hal_get(int port, uint8_t *byte);
uint32_t hal_millis(void);

#endif
