package com.fleet.dispatch;

import com.fleet.model.Trip;
import com.fleet.model.Vehicle;
import java.util.Optional;

/** Assigns trips to vehicles using an assignment policy. */
public class DispatchService {
    private final VehicleRepository repository;
    private final AssignmentPolicy policy;

    public DispatchService(VehicleRepository repository, AssignmentPolicy policy) {
        this.repository = repository;
        this.policy = policy;
    }

    /** Assigns the trip to a vehicle and persists the vehicle; empty when none qualifies. */
    public Optional<Vehicle> assign(Trip trip) {
        Optional<Vehicle> chosen = policy.choose(trip, repository.findAvailable());
        chosen.ifPresent(v -> {
            v.assign();
            trip.assignTo(v);
            repository.save(v);
        });
        return chosen;
    }

    /** Releases the vehicle serving a trip back to the pool. */
    public void complete(Trip trip) {
        if (!trip.isAssigned()) return;
        repository.find(trip.getVehicleId()).ifPresent(v -> {
            v.release();
            repository.save(v);
        });
    }
}
