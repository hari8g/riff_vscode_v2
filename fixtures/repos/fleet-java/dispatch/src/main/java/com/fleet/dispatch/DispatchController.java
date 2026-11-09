package com.fleet.dispatch;

import com.fleet.model.GeoPoint;
import com.fleet.model.Trip;
import java.util.UUID;

/** Thin HTTP-style facade; a real deployment maps this onto a web framework. */
public class DispatchController {
    private final DispatchService service;

    public DispatchController(DispatchService service) {
        this.service = service;
    }

    /** Handles POST /trips. Returns the vehicle id or "none". */
    public String requestTrip(double fromLat, double fromLon, double toLat, double toLon, int passengers) {
        Trip trip = new Trip(UUID.randomUUID().toString(), new GeoPoint(fromLat, fromLon), new GeoPoint(toLat, toLon), passengers);
        return service.assign(trip).map(v -> v.getId()).orElse("none");
    }
}
