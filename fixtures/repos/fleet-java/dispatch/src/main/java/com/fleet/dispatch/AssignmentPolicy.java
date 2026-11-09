package com.fleet.dispatch;

import com.fleet.model.Trip;
import com.fleet.model.Vehicle;
import java.util.List;
import java.util.Optional;

/** Chooses a vehicle for a trip among candidates. */
public interface AssignmentPolicy {
    Optional<Vehicle> choose(Trip trip, List<Vehicle> candidates);
}
