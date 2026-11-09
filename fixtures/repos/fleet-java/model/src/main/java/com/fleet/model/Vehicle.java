package com.fleet.model;

/** A dispatchable vehicle with its last known position and capacity in seats. */
public class Vehicle {
    private final String id;
    private GeoPoint position;
    private VehicleStatus status;
    private final int seats;

    public Vehicle(String id, GeoPoint position, int seats) {
        this.id = id;
        this.position = position;
        this.seats = seats;
        this.status = VehicleStatus.AVAILABLE;
    }

    public String getId() { return id; }
    public GeoPoint getPosition() { return position; }
    public int getSeats() { return seats; }
    public VehicleStatus getStatus() { return status; }

    public void moveTo(GeoPoint p) { this.position = p; }

    /** Marks the vehicle assigned; fails if it is not assignable. */
    public void assign() {
        if (!status.isAssignable()) {
            throw new IllegalStateException("vehicle " + id + " is " + status);
        }
        this.status = VehicleStatus.ASSIGNED;
    }

    public void release() { this.status = VehicleStatus.AVAILABLE; }

    public void sendToMaintenance() { this.status = VehicleStatus.MAINTENANCE; }
}
