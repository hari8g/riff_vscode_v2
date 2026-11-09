package com.fleet.model;

/** Lifecycle of a vehicle as seen by dispatch. */
public enum VehicleStatus {
    AVAILABLE,
    ASSIGNED,
    MAINTENANCE,
    OFFLINE;

    /** True when dispatch may hand this vehicle a new trip. */
    public boolean isAssignable() {
        return this == AVAILABLE;
    }
}
