#include <assert.h>
#include "ring.h"

static void test_push_pop_order(void) {
    ring_t r;
    ring_init(&r);
    ring_push(&r, 1);
    ring_push(&r, 2);
    uint8_t b;
    assert(ring_pop(&r, &b) == 0 && b == 1);
    assert(ring_pop(&r, &b) == 0 && b == 2);
    assert(ring_pop(&r, &b) == -1);
}

static void test_full_rejects(void) {
    ring_t r;
    ring_init(&r);
    for (int i = 0; i < RING_CAPACITY; i++) assert(ring_push(&r, (uint8_t)i) == 0);
    assert(ring_push(&r, 0) == -1);
    assert(ring_count(&r) == RING_CAPACITY);
}

int main(void) {
    test_push_pop_order();
    test_full_rejects();
    return 0;
}
