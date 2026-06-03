import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadAirportConfig } from "../config/index.js";
import { createAirportState } from "../domain/index.js";
import { DomainError } from "../domain/index.js";

const config = loadAirportConfig({
  ATC_RUNWAY_LENGTHS: "3000",
  ATC_GATE_COUNT: "2",
  ATC_GROUND_CREW_COUNT: "2",
  ATC_SEPARATION_TAKEOFF_MINUTES: "2",
  ATC_SEPARATION_LANDING_MINUTES: "3",
  ATC_SEPARATION_MIXED_MINUTES: "4",
  ATC_GATE_TURNAROUND_MINUTES: "45",
  ATC_DEPENDENCY_BUFFER_MINUTES: "30",
  ATC_MAX_SCHEDULING_HORIZON_MINUTES: "1440",
});

describe("cancelFlight integration", () => {
  it("blocks connecting outbound after inbound cancel", () => {
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
    assert.equal(state.getFlight("OUT1")?.status, "scheduled");

    const affected = state.cancelFlight("IN1");
    assert.deepEqual(affected, ["IN1", "OUT1"]);
    assert.equal(state.getFlight("IN1")?.status, "cancelled");
    assert.equal(state.getFlight("OUT1")?.status, "blocked");
    assert.ok(!state.getSchedule().some((s) => s.flightNumber === "OUT1"));

    state.submitFlight({
      flightNumber: "SOLO",
      operationType: "arrival",
      priority: "low",
    });
    const regen = state.runGenerateSchedule(config);
    assert.equal(regen.outcomes.get("SOLO")?.status, "scheduled");
  });

  it("throws when flight is unknown", () => {
    const state = createAirportState();
    assert.throws(
      () => state.cancelFlight("NOPE"),
      (e: unknown) => e instanceof DomainError && e.message.includes("not found"),
    );
  });
});
