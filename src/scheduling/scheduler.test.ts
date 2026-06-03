import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadAirportConfig } from "../config/index.js";
import { createAirportState } from "../domain/index.js";
import { generateSchedule } from "./scheduler.js";

const testConfig = loadAirportConfig({
  ATC_RUNWAY_LENGTHS: "2500,3000,3500",
  ATC_GATE_COUNT: "4",
  ATC_GROUND_CREW_COUNT: "3",
  ATC_SEPARATION_TAKEOFF_MINUTES: "2",
  ATC_SEPARATION_LANDING_MINUTES: "3",
  ATC_SEPARATION_MIXED_MINUTES: "4",
  ATC_GATE_TURNAROUND_MINUTES: "45",
  ATC_DEPENDENCY_BUFFER_MINUTES: "30",
  ATC_MAX_SCHEDULING_HORIZON_MINUTES: "1440",
  ATC_ARRIVAL_DURATION_MINUTES: "30",
  ATC_DEPARTURE_DURATION_MINUTES: "25",
});

function assertNoRunwayOverlap(
  slots: { runwayId: number; startMinute: number; endMinute: number; operationType: string }[],
  config: typeof testConfig,
) {
  const byRunway = new Map<number, typeof slots>();
  for (const s of slots) {
    const list = byRunway.get(s.runwayId) ?? [];
    list.push(s);
    byRunway.set(s.runwayId, list);
  }
  for (const ops of byRunway.values()) {
    ops.sort((a, b) => a.startMinute - b.startMinute);
    for (let i = 1; i < ops.length; i++) {
      const prev = ops[i - 1]!;
      const next = ops[i]!;
      const sep =
        prev.operationType === "arrival" && next.operationType === "arrival"
          ? config.separationLandingMinutes
          : prev.operationType === "departure" &&
              next.operationType === "departure"
            ? config.separationTakeoffMinutes
            : config.separationMixedMinutes;
      assert.ok(
        next.startMinute >= prev.endMinute + sep,
        `runway overlap ${prev.endMinute} -> ${next.startMinute}`,
      );
    }
  }
}

describe("generateSchedule", () => {
  it("schedules morning rush mix with priority ordering under contention", () => {
    const state = createAirportState();
    state.submitFlight({
      flightNumber: "LA1",
      operationType: "arrival",
      priority: "low",
    });
    state.submitFlight({
      flightNumber: "LD1",
      operationType: "departure",
      priority: "low",
    });
    state.submitFlight({
      flightNumber: "HA1",
      operationType: "arrival",
      priority: "high",
    });
    state.submitFlight({
      flightNumber: "MD1",
      operationType: "departure",
      priority: "medium",
    });

    const result = state.runGenerateSchedule(testConfig);
    assert.equal(result.outcomes.get("HA1")?.status, "scheduled");
    assert.equal(result.outcomes.get("MD1")?.status, "scheduled");
    assert.equal(result.outcomes.get("LA1")?.status, "scheduled");
    assert.equal(result.outcomes.get("LD1")?.status, "scheduled");
    assertNoRunwayOverlap(result.slots, testConfig);

    const ha1 = result.slots.find((s) => s.flightNumber === "HA1")!;
    const la1 = result.slots.find((s) => s.flightNumber === "LA1")!;
    assert.ok(
      ha1.startMinute <= la1.startMinute,
      "high-priority arrival should not start after low when both compete",
    );
  });

  it("leaves heavy hauler unscheduled when runway too short", () => {
    const state = createAirportState();
    state.submitFlight({
      flightNumber: "OK1",
      operationType: "departure",
      priority: "medium",
    });
    state.submitFlight({
      flightNumber: "HEAVY1",
      operationType: "departure",
      priority: "high",
      runwayRequirement: { minLengthMeters: 5000 },
    });

    const result = state.runGenerateSchedule(testConfig);
    assert.equal(result.outcomes.get("OK1")?.status, "scheduled");
    const heavy = result.outcomes.get("HEAVY1");
    assert.equal(heavy?.status, "unscheduled");
    if (heavy?.status === "unscheduled") {
      assert.match(heavy.reason, /runway/i);
    }
  });

  it("respects dependency buffer for connecting flights", () => {
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

    const result = state.runGenerateSchedule(testConfig);
    const inbound = result.slots.find((s) => s.flightNumber === "IN1")!;
    const outbound = result.slots.find((s) => s.flightNumber === "OUT1")!;
    assert.ok(outbound.startMinute >= inbound.endMinute + testConfig.dependencyBufferMinutes);
  });

  it("produces deterministic results for the same inputs", () => {
    const build = () => {
      const state = createAirportState();
      state.submitFlight({
        flightNumber: "A1",
        operationType: "arrival",
        priority: "medium",
      });
      state.submitFlight({
        flightNumber: "B1",
        operationType: "departure",
        priority: "high",
      });
      return generateSchedule(testConfig, state.listFlights());
    };
    const r1 = build();
    const r2 = build();
    assert.deepEqual(r1.slots, r2.slots);
  });
});
