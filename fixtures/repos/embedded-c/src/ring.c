#include "ring.h"

void ring_init(ring_t *r) {
    r->head = 0;
    r->tail = 0;
    r->count = 0;
}

/* Returns 0 on success, -1 when full. */
int ring_push(ring_t *r, uint8_t byte) {
    if (r->count == RING_CAPACITY) {
        return -1;
    }
    r->data[r->head] = byte;
    r->head = (r->head + 1) % RING_CAPACITY;
    r->count++;
    return 0;
}

/* Returns 0 on success, -1 when empty. */
int ring_pop(ring_t *r, uint8_t *byte) {
    if (r->count == 0) {
        return -1;
    }
    *byte = r->data[r->tail];
    r->tail = (r->tail + 1) % RING_CAPACITY;
    r->count--;
    return 0;
}

size_t ring_count(const ring_t *r) {
    return r->count;
}
