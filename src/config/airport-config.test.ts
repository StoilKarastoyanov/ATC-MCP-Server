import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConfigError, loadAirportConfig } from "./airport-config.js";

const validEnv: NodeJS.ProcessEnv = {
  ATC_RUNWAY_LENGTHS: "2500,3000,3500",
  ATC_GATE_COUNT: "4",
  ATC_GROUND_CREW_COUNT: "3",
  ATC_SEPARATION_TAKEOFF_MINUTES: "2",
  ATC_SEPARATION_LANDING_MINUTES: "3",
  ATC_SEPARATION_MIXED_MINUTES: "4",
  ATC_GATE_TURNAROUND_MINUTES: "45",
  ATC_DEPENDENCY_BUFFER_MINUTES: "30",
  ATC_MAX_SCHEDULING_HORIZON_MINUTES: "1440",
};

describe("loadAirportConfig", () => {
  it("loads valid configuration", () => {
    const config = loadAirportConfig(validEnv);
    assert.equal(config.runways.length, 3);
    assert.deepEqual(config.runways[0], { id: 1, lengthMeters: 2500 });
    assert.deepEqual(config.runways[2], { id: 3, lengthMeters: 3500 });
    assert.equal(config.gateCount, 4);
    assert.equal(config.groundCrewCount, 3);
    assert.equal(config.dependencyBufferMinutes, 30);
    assert.equal(config.arrivalDurationMinutes, 30);
    assert.equal(config.departureDurationMinutes, 25);
  });

  it("accepts optional operation duration overrides", () => {
    const config = loadAirportConfig({
      ...validEnv,
      ATC_ARRIVAL_DURATION_MINUTES: "40",
      ATC_DEPARTURE_DURATION_MINUTES: "35",
    });
    assert.equal(config.arrivalDurationMinutes, 40);
    assert.equal(config.departureDurationMinutes, 35);
  });

  it("fails when runway lengths are missing", () => {
    assert.throws(
      () => loadAirportConfig({ ...validEnv, ATC_RUNWAY_LENGTHS: undefined }),
      (err: unknown) =>
        err instanceof ConfigError &&
        err.message.includes("ATC_RUNWAY_LENGTHS"),
    );
  });

  it("fails on invalid runway length token", () => {
    assert.throws(
      () =>
        loadAirportConfig({ ...validEnv, ATC_RUNWAY_LENGTHS: "2500,abc" }),
      (err: unknown) =>
        err instanceof ConfigError && err.message.includes("abc"),
    );
  });

  it("fails when a required key is missing", () => {
    const env = { ...validEnv };
    delete env.ATC_GATE_COUNT;
    assert.throws(
      () => loadAirportConfig(env),
      (err: unknown) =>
        err instanceof ConfigError &&
        err.message.includes("ATC_GATE_COUNT is required"),
    );
  });

  it("fails when gate count is zero", () => {
    assert.throws(
      () => loadAirportConfig({ ...validEnv, ATC_GATE_COUNT: "0" }),
      (err: unknown) => err instanceof ConfigError,
    );
  });

  it("fails when ATC_RUNWAY_COUNT disagrees with runway lengths", () => {
    assert.throws(
      () =>
        loadAirportConfig({
          ...validEnv,
          ATC_RUNWAY_COUNT: "99",
        }),
      (err: unknown) =>
        err instanceof ConfigError &&
        err.message.includes("ATC_RUNWAY_COUNT"),
    );
  });

  it("fails when mixed separation is less than takeoff/landing separation", () => {
    assert.throws(
      () =>
        loadAirportConfig({
          ...validEnv,
          ATC_SEPARATION_MIXED_MINUTES: "1",
        }),
      (err: unknown) =>
        err instanceof ConfigError &&
        err.message.includes("ATC_SEPARATION_MIXED_MINUTES"),
    );
  });
});
