#include <stdio.h>
#include "uart.h"

int main(void) {
    uart_t u;
    uart_init(&u, 0);
    const uint8_t hello[] = {'h', 'i'};
    uart_send_frame(&u, hello, sizeof hello);
    int n = uart_poll(&u);
    printf("looped %d bytes, errors=%u\n", n, (unsigned)u.errors);
    return 0;
}
