import { haversineDistanceMeters } from './geo.util';

describe('haversineDistanceMeters', () => {
  it('returns 0 for the same point', () => {
    expect(haversineDistanceMeters(12.9716, 77.5946, 12.9716, 77.5946)).toBeCloseTo(0, 3);
  });

  it('matches a known reference distance (~1.47km between two Bangalore points)', () => {
    const d = haversineDistanceMeters(12.9716, 77.5946, 12.9816, 77.6046);
    expect(d).toBeGreaterThan(1300);
    expect(d).toBeLessThan(1600);
  });

  it('is symmetric regardless of argument order', () => {
    const a = haversineDistanceMeters(12.9716, 77.5946, 12.9816, 77.6046);
    const b = haversineDistanceMeters(12.9816, 77.6046, 12.9716, 77.5946);
    expect(a).toBeCloseTo(b, 6);
  });

  it('a point ~50m away is inside a 100m radius, ~50m further is outside', () => {
    const campusLat = 12.9716;
    const campusLon = 77.5946;
    // ~0.00045 deg latitude ≈ 50m
    const near = haversineDistanceMeters(campusLat + 0.00045, campusLon, campusLat, campusLon);
    const far = haversineDistanceMeters(campusLat + 0.0014, campusLon, campusLat, campusLon);
    expect(near).toBeLessThan(100);
    expect(far).toBeGreaterThan(100);
  });
});
