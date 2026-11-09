package com.fleet.dispatch;

import com.fleet.model.GeoPoint;

/** Great-circle helpers. */
public final class GeoUtil {
    private static final double EARTH_RADIUS_KM = 6371.0;

    private GeoUtil() {}

    /** Haversine distance in kilometres. */
    public static double distanceKm(GeoPoint a, GeoPoint b) {
        double dLat = Math.toRadians(b.lat() - a.lat());
        double dLon = Math.toRadians(b.lon() - a.lon());
        double h = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(a.lat())) * Math.cos(Math.toRadians(b.lat()))
                * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
    }
}
