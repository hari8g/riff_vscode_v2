cmake_minimum_required(VERSION 3.16)
project(embedded_c C)

add_library(fw src/uart.c src/ring.c src/crc.c src/hal_stub.c)
target_include_directories(fw PUBLIC include)

add_executable(firmware src/main.c)
target_link_libraries(firmware fw)

enable_testing()
add_executable(test_ring test/test_ring.c)
target_link_libraries(test_ring fw)
add_test(NAME ring COMMAND test_ring)
add_executable(test_crc test/test_crc.c)
target_link_libraries(test_crc fw)
add_test(NAME crc COMMAND test_crc)
