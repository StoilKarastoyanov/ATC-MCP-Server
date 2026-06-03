import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadAirportConfig } from "../config/index.js";
import { createAirportState } from "../domain/index.js";
import { analyzeBottleneck } from "./bottleneck.js";

const config = loadAirportConfig({
  ATC_RUNWAY_LENGTHS: "3000,3500",
  ATC_GATE_COUNT: "4",
  ATC_GROUND_CREW_COUNT: "3",
  ATC_SEPARATION_TAKEOFF_MINUTES: "2",
  ATC_SEPARATION_LANDING_MINUTES: "3",
  ATC_SEPARATION_MIXED_MINUTES: "4",
  ATC_GATE_TURNAROUND_MINUTES: "45",
  ATC_DEPENDENCY_BUFFER_MINUTES: "30",
  ATC_MAX_SCHEDULING_HORIZON_MINUTES: "1440",
});

describe("analyzeBottleneck", () => {
  it("returns no chain when nothing is scheduled", () => {
    const state = createAirportState();
    const analysis = analyzeBottleneck(config, state.listFlights(), state.getSchedule());
    assert.equal(analysis.hasChain, false);
    assert.ok(analysis.message);
  });

  it("finds connecting flight chain with schedule-based elapsed time", () => {
    const state = createAirportState();
    state.submitFlight({
      flightNumber: "IN1",
      operationType: "arrival",
      priority: "high",
    });
    state.submitFlight({
      flightNumber: "OUT1",
      operationType: "departure",
      priority: "high",
      dependencies: ["IN1"],
    });
    state.runGenerateSchedule(config);

    const analysis = analyzeBottleneck(
      config,
      state.listFlights(),
      state.getSchedule(),
    );
    assert.equal(analysis.hasChain, true);
    assert.equal(analysis.chain.length, 2);
    assert.equal(analysis.chain[0]!.flightNumber, "IN1");
    assert.equal(analysis.chain[1]!.flightNumber, "OUT1");
    assert.equal(
      analysis.totalElapsedMinutes,
      analysis.chainEndMinute! - analysis.chainStartMinute!,
    );
    assert.ok(analysis.chain[1]!.startMinute >= analysis.chain[0]!.endMinute + 30);
    assert.equal(analysis.chain[1]!.dependencyBufferMinutes, 30);
  });

  it("picks the longest chain when multiple scheduled branches exist", () => {
    const state = createAirportState();
    state.submitFlight({
      flightNumber: "A1",
      operationType: "arrival",
      priority: "high",
    });
    state.submitFlight({
      flightNumber: "B1",
      operationType: "departure",
      priority: "medium",
      dependencies: ["A1"],
    });
    state.submitFlight({
      flightNumber: "C1",
      operationType: "departure",
      priority: "low",
      dependencies: ["B1"],
    });
    state.submitFlight({
      flightNumber: "X1",
      operationType: "arrival",
      priority: "low",
    });
    state.runGenerateSchedule(config);

    const analysis = analyzeBottleneck(
      config,
      state.listFlights(),
      state.getSchedule(),
    );
    assert.equal(analysis.chain.length, 3);
    assert.deepEqual(
      analysis.chain.map((s) => s.flightNumber),
      ["A1", "B1", "C1"],
    );
    assert.ok(analysis.totalElapsedMinutes > 0);
  });
});
