#ifndef RING_H
#define RING_H

#include <stddef.h>
#include <stdint.h>

#define RING_CAPACITY 64

typedef struct ring {
    uint8_t data[RING_CAPACITY];
    size_t head;
    size_t tail;
    size_t count;
} ring_t;

void ring_init(ring_t *r);
int ring_push(ring_t *r, uint8_t byte);
int ring_pop(ring_t *r, uint8_t *byte);
size_t ring_count(const ring_t *r);

#endif
