package com.fleet.model;

/** A passenger request from pickup to dropoff. */
public class Trip {
    private final String id;
    private final GeoPoint pickup;
    private final GeoPoint dropoff;
    private final int passengers;
    private String vehicleId;

    public Trip(String id, GeoPoint pickup, GeoPoint dropoff, int passengers) {
        this.id = id;
        this.pickup = pickup;
        this.dropoff = dropoff;
        this.passengers = passengers;
    }

    public String getId() { return id; }
    public GeoPoint getPickup() { return pickup; }
    public GeoPoint getDropoff() { return dropoff; }
    public int getPassengers() { return passengers; }
    public String getVehicleId() { return vehicleId; }

    public void assignTo(Vehicle v) { this.vehicleId = v.getId(); }

    public boolean isAssigned() { return vehicleId != null; }
}
