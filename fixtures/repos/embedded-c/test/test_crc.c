#include <assert.h>
#include "crc.h"

static void test_known_vector(void) {
    const uint8_t msg[] = "123456789";
    assert(crc16(msg, 9) == 0x29B1);
}

int main(void) {
    test_known_vector();
    return 0;
}
