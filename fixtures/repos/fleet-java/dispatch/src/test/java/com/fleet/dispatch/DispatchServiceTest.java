package com.fleet.dispatch;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fleet.model.GeoPoint;
import com.fleet.model.Trip;
import com.fleet.model.Vehicle;
import com.fleet.model.VehicleStatus;
import org.junit.jupiter.api.Test;

class DispatchServiceTest {
    @Test
    void assignsNearestAvailableVehicle() {
        InMemoryVehicleRepository repo = new InMemoryVehicleRepository();
        repo.save(new Vehicle("near", new GeoPoint(12.97, 77.59), 4));
        repo.save(new Vehicle("far", new GeoPoint(13.50, 78.00), 4));
        DispatchService service = new DispatchService(repo, new NearestVehiclePolicy(25));
        Trip trip = new Trip("t1", new GeoPoint(12.98, 77.60), new GeoPoint(12.90, 77.50), 2);
        assertEquals("near", service.assign(trip).orElseThrow().getId());
        assertTrue(trip.isAssigned());
    }

    @Test
    void completeReleasesVehicle() {
        InMemoryVehicleRepository repo = new InMemoryVehicleRepository();
        Vehicle v = new Vehicle("v1", new GeoPoint(12.97, 77.59), 4);
        repo.save(v);
        DispatchService service = new DispatchService(repo, new NearestVehiclePolicy(25));
        Trip trip = new Trip("t2", new GeoPoint(12.97, 77.59), new GeoPoint(12.90, 77.50), 1);
        service.assign(trip);
        service.complete(trip);
        assertEquals(VehicleStatus.AVAILABLE, v.getStatus());
    }
}
