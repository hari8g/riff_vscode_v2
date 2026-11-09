package com.fleet.dispatch;

import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fleet.model.GeoPoint;
import com.fleet.model.Trip;
import com.fleet.model.Vehicle;
import java.util.List;
import org.junit.jupiter.api.Test;

class NearestVehiclePolicyTest {
    @Test
    void skipsVehiclesWithTooFewSeats() {
        NearestVehiclePolicy policy = new NearestVehiclePolicy(50);
        Trip trip = new Trip("t", new GeoPoint(0, 0), new GeoPoint(1, 1), 6);
        assertTrue(policy.choose(trip, List.of(new Vehicle("small", new GeoPoint(0, 0), 4))).isEmpty());
    }
}
