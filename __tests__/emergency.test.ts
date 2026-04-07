/**
 * Tests for utils/emergency.ts — pure utility functions.
 *
 * Only tests functions that don't require network/Supabase calls.
 */

// We need to mock the modules that emergency.ts imports
jest.mock("../utils/api", () => ({
  backendGet: jest.fn(),
  backendPost: jest.fn(),
}));

import {
  formatCoords,
  buildMapHtml,
  calculateDistance,
  parsePostGISPoint,
} from "../utils/emergency";

describe("formatCoords", () => {
  test("formats positive coordinates (N, E)", () => {
    const result = formatCoords(9.02, 38.75);
    expect(result).toContain("N");
    expect(result).toContain("E");
    expect(result).toContain("9.0200");
    expect(result).toContain("38.7500");
  });

  test("formats negative coordinates (S, W)", () => {
    const result = formatCoords(-33.87, -151.21);
    expect(result).toContain("S");
    expect(result).toContain("W");
  });

  test("respects decimal places argument", () => {
    const result = formatCoords(9.02, 38.75, 2);
    expect(result).toContain("9.02");
  });
});

describe("buildMapHtml", () => {
  test("returns a Google Maps embed URL", () => {
    const url = buildMapHtml(9.02, 38.75);
    expect(url).toContain("maps.google.com");
    expect(url).toContain("output=embed");
  });

  test("includes coordinates in URL", () => {
    const url = buildMapHtml(9.02, 38.75);
    expect(url).toContain("9.02");
    expect(url).toContain("38.75");
  });

  test("uses default zoom of 17", () => {
    const url = buildMapHtml(9.02, 38.75);
    expect(url).toContain("z=17");
  });

  test("accepts custom zoom", () => {
    const url = buildMapHtml(9.02, 38.75, 12);
    expect(url).toContain("z=12");
  });
});

describe("calculateDistance", () => {
  test("same point returns 0", () => {
    expect(calculateDistance(9.02, 38.75, 9.02, 38.75)).toBe(0);
  });

  test("Addis Ababa to Adama is approximately 74 km", () => {
    const d = calculateDistance(9.02, 38.75, 8.54, 39.27);
    expect(d).toBeGreaterThan(50);
    expect(d).toBeLessThan(100);
  });

  test("is symmetric", () => {
    const d1 = calculateDistance(9.0, 38.7, 8.5, 39.2);
    const d2 = calculateDistance(8.5, 39.2, 9.0, 38.7);
    expect(Math.abs(d1 - d2)).toBeLessThan(0.001);
  });

  test("short distance (~111m for 0.001 degree)", () => {
    const d = calculateDistance(9.0, 38.7, 9.001, 38.7);
    expect(d).toBeGreaterThan(0.05);
    expect(d).toBeLessThan(0.2);
  });
});

describe("parsePostGISPoint", () => {
  test("parses GeoJSON dict", () => {
    const result = parsePostGISPoint({
      type: "Point",
      coordinates: [38.75, 9.02],
    });
    expect(result).not.toBeNull();
    expect(result!.latitude).toBeCloseTo(9.02, 2);
    expect(result!.longitude).toBeCloseTo(38.75, 2);
  });

  test("parses WKT POINT string", () => {
    const result = parsePostGISPoint("POINT(38.75 9.02)");
    expect(result).not.toBeNull();
    expect(result!.latitude).toBeCloseTo(9.02, 2);
    expect(result!.longitude).toBeCloseTo(38.75, 2);
  });

  test("parses EWKT with SRID", () => {
    const result = parsePostGISPoint("SRID=4326;POINT(38.75 9.02)");
    expect(result).not.toBeNull();
    expect(result!.latitude).toBeCloseTo(9.02, 2);
    expect(result!.longitude).toBeCloseTo(38.75, 2);
  });

  test("returns null for null/undefined/empty", () => {
    expect(parsePostGISPoint(null)).toBeNull();
    expect(parsePostGISPoint(undefined)).toBeNull();
    expect(parsePostGISPoint("")).toBeNull();
  });

  test("returns null for garbage input", () => {
    expect(parsePostGISPoint("not a point")).toBeNull();
    expect(parsePostGISPoint(42)).toBeNull();
  });
});
