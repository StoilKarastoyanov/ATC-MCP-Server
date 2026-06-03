import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadAirportConfig } from "../config/index.js";
import { createAirportState } from "../domain/index.js";
import { buildAirportStatus } from "./airport-status.js";

const config = loadAirportConfig({
  ATC_RUNWAY_LENGTHS: "2500,3000",
  ATC_GATE_COUNT: "2",
  ATC_GROUND_CREW_COUNT: "1",
  ATC_SEPARATION_TAKEOFF_MINUTES: "2",
  ATC_SEPARATION_LANDING_MINUTES: "3",
  ATC_SEPARATION_MIXED_MINUTES: "4",
  ATC_GATE_TURNAROUND_MINUTES: "45",
  ATC_DEPENDENCY_BUFFER_MINUTES: "30",
  ATC_MAX_SCHEDULING_HORIZON_MINUTES: "1440",
});

describe("buildAirportStatus", () => {
  it("reports empty airport before scheduling", () => {
    const state = createAirportState();
    const status = buildAirportStatus(config, state);
    assert.equal(status.scheduleGenerated, false);
    assert.equal(status.scheduleCompletionMinute, null);
    assert.equal(status.flights.total, 0);
    assert.equal(status.constraints.scheduleNotGenerated, true);
  });

  it("reports unscheduled flights and completion time after schedule", () => {
    const state = createAirportState();
    state.submitFlight({
      flightNumber: "OK1",
      operationType: "arrival",
      priority: "high",
    });
    state.submitFlight({
      flightNumber: "HEAVY1",
      operationType: "departure",
      priority: "high",
      runwayRequirement: { minLengthMeters: 9000 },
    });
    state.runGenerateSchedule(config);

    const status = buildAirportStatus(config, state);
    assert.equal(status.scheduleGenerated, true);
    assert.ok(status.scheduleCompletionMinute !== null);
    assert.equal(status.flights.byStatus.scheduled, 1);
    assert.equal(status.flights.byStatus.unscheduled, 1);
    assert.equal(status.constraints.hasUnscheduledFlights, true);
    assert.equal(status.issues.unscheduled.length, 1);
    assert.match(status.issues.unscheduled[0]!.reason, /runway/i);
  });
});
