package com.fleet.dispatch;

import com.fleet.model.Vehicle;
import java.util.List;
import java.util.Optional;

/** Storage port for vehicles. */
public interface VehicleRepository {
    Optional<Vehicle> find(String id);
    List<Vehicle> findAvailable();
    void save(Vehicle vehicle);
}
