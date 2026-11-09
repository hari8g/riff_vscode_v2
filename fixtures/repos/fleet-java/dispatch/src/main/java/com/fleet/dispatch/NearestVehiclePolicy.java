package com.fleet.dispatch;

import com.fleet.model.Trip;
import com.fleet.model.Vehicle;
import java.util.List;
import java.util.Optional;

/** Picks the closest vehicle with enough seats within a radius. */
public class NearestVehiclePolicy implements AssignmentPolicy {
    private final double maxRadiusKm;

    public NearestVehiclePolicy(double maxRadiusKm) {
        this.maxRadiusKm = maxRadiusKm;
    }

    @Override
    public Optional<Vehicle> choose(Trip trip, List<Vehicle> candidates) {
        Vehicle best = null;
        double bestKm = Double.MAX_VALUE;
        for (Vehicle v : candidates) {
            if (v.getSeats() < trip.getPassengers()) continue;
            double km = GeoUtil.distanceKm(v.getPosition(), trip.getPickup());
            if (km <= maxRadiusKm && km < bestKm) {
                best = v;
                bestKm = km;
            }
        }
        return Optional.ofNullable(best);
    }
}
