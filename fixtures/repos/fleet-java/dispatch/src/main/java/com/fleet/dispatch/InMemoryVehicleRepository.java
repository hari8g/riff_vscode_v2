package com.fleet.dispatch;

import com.fleet.model.Vehicle;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Test and demo repository backed by a map. */
public class InMemoryVehicleRepository implements VehicleRepository {
    private final Map<String, Vehicle> vehicles = new LinkedHashMap<>();

    @Override
    public Optional<Vehicle> find(String id) {
        return Optional.ofNullable(vehicles.get(id));
    }

    @Override
    public List<Vehicle> findAvailable() {
        List<Vehicle> out = new ArrayList<>();
        for (Vehicle v : vehicles.values()) {
            if (v.getStatus().isAssignable()) out.add(v);
        }
        return out;
    }

    @Override
    public void save(Vehicle vehicle) {
        vehicles.put(vehicle.getId(), vehicle);
    }
}
