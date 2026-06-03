import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DomainError, createAirportState } from "./index.js";
import { wouldCreateDependencyCycle } from "./airport-state.js";

describe("AirportState", () => {
  it("submits flights and lists by status", () => {
    const state = createAirportState();
    state.submitFlight({
      flightNumber: "aa100",
      operationType: "arrival",
      priority: "high",
    });
    state.submitFlight({
      flightNumber: "bb200",
      operationType: "departure",
      priority: "low",
      dependencies: ["AA100"],
    });

    assert.equal(state.listFlights("queued").length, 2);
    assert.equal(state.getFlight("AA100")?.flightNumber, "AA100");
    assert.deepEqual(state.getFlight("BB200")?.dependencies, ["AA100"]);
  });

  it("rejects duplicate flight numbers", () => {
    const state = createAirportState();
    state.submitFlight({
      flightNumber: "UA1",
      operationType: "arrival",
      priority: "medium",
    });
    assert.throws(
      () =>
        state.submitFlight({
          flightNumber: "ua1",
          operationType: "departure",
          priority: "high",
        }),
      (e: unknown) => e instanceof DomainError && e.message.includes("already exists"),
    );
  });

  it("rejects circular dependencies", () => {
    const state = createAirportState();
    state.submitFlight({
      flightNumber: "A",
      operationType: "arrival",
      priority: "high",
    });
    state.submitFlight({
      flightNumber: "LOOP",
      operationType: "departure",
      priority: "medium",
      dependencies: ["A"],
    });
    assert.throws(
      () =>
        state.submitFlight({
          flightNumber: "A",
          operationType: "arrival",
          priority: "low",
          dependencies: ["LOOP"],
        }),
      (e: unknown) =>
        e instanceof DomainError &&
        (e.message.includes("circular") || e.message.includes("already exists")),
    );

    const chain = createAirportState();
    chain.submitFlight({
      flightNumber: "A",
      operationType: "arrival",
      priority: "high",
    });
    chain.submitFlight({
      flightNumber: "C",
      operationType: "departure",
      priority: "medium",
      dependencies: ["A"],
    });
    chain.submitFlight({
      flightNumber: "B",
      operationType: "departure",
      priority: "medium",
      dependencies: ["C"],
    });
    chain.submitFlight({
      flightNumber: "Z",
      operationType: "arrival",
      priority: "low",
      dependencies: ["B"],
    });
    chain.submitFlight({
      flightNumber: "HUB",
      operationType: "departure",
      priority: "high",
      dependencies: ["Z"],
    });
    chain.submitFlight({
      flightNumber: "TAIL",
      operationType: "arrival",
      priority: "low",
      dependencies: ["HUB"],
    });
    const flights = new Map(
      chain.listFlights().map((f) => [f.flightNumber, f] as const),
    );
    assert.equal(
      wouldCreateDependencyCycle(flights, "A", ["TAIL"]),
      true,
    );
  });

  it("rejects unknown dependencies at submit", () => {
    const state = createAirportState();
    assert.throws(
      () =>
        state.submitFlight({
          flightNumber: "DL9",
          operationType: "departure",
          priority: "high",
          dependencies: ["MISSING"],
        }),
      (e: unknown) => e instanceof DomainError && e.message.includes("unknown"),
    );
  });

  it("cancels a flight and blocks transitive dependents", () => {
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
    state.submitFlight({
      flightNumber: "OUT2",
      operationType: "departure",
      priority: "medium",
      dependencies: ["OUT1"],
    });

    const affected = state.cancelFlight("IN1");
    assert.deepEqual(affected, ["IN1", "OUT1", "OUT2"]);
    assert.equal(state.getFlight("IN1")?.status, "cancelled");
    assert.equal(state.getFlight("OUT1")?.status, "blocked");
    assert.match(state.getFlight("OUT1")?.unscheduledReason ?? "", /IN1/);
    assert.equal(state.getFlight("OUT2")?.status, "blocked");
  });

  it("applySchedule updates flight statuses", () => {
    const state = createAirportState();
    state.submitFlight({
      flightNumber: "A1",
      operationType: "arrival",
      priority: "high",
    });
    state.submitFlight({
      flightNumber: "B1",
      operationType: "departure",
      priority: "low",
      runwayRequirement: { minLengthMeters: 99999 },
    });

    state.applySchedule(
      [
        {
          flightNumber: "A1",
          operationType: "arrival",
          runwayId: 1,
          gateId: 1,
          startMinute: 0,
          endMinute: 30,
        },
      ],
      new Map([
        ["A1", { status: "scheduled" }],
        ["B1", { status: "unscheduled", reason: "No suitable runway" }],
      ]),
    );

    const queue = state.getFlightQueue();
    assert.equal(state.getFlight("A1")?.status, "scheduled");
    assert.equal(state.getFlight("B1")?.status, "unscheduled");
    assert.equal(queue.find((f) => f.flightNumber === "A1")?.scheduledSlot?.runwayId, 1);
    assert.equal(queue.find((f) => f.flightNumber === "B1")?.unscheduledReason, "No suitable runway");
  });

  it("cancel removes flight from active schedule", () => {
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
    });
    state.applySchedule(
      [
        {
          flightNumber: "A1",
          operationType: "arrival",
          runwayId: 1,
          gateId: 1,
          startMinute: 0,
          endMinute: 30,
        },
        {
          flightNumber: "B1",
          operationType: "departure",
          runwayId: 2,
          gateId: 2,
          startMinute: 35,
          endMinute: 60,
        },
      ],
      new Map([
        ["A1", { status: "scheduled" }],
        ["B1", { status: "scheduled" }],
      ]),
    );
    state.cancelFlight("A1");
    assert.equal(state.getFlight("A1")?.status, "cancelled");
    assert.equal(state.getSchedule().length, 1);
    assert.equal(state.getSchedule()[0]?.flightNumber, "B1");
  });

  it("resetSchedule returns active flights to queued", () => {
    const state = createAirportState();
    state.submitFlight({
      flightNumber: "X1",
      operationType: "arrival",
      priority: "medium",
    });
    state.applySchedule(
      [
        {
          flightNumber: "X1",
          operationType: "arrival",
          runwayId: 2,
          gateId: 1,
          startMinute: 10,
          endMinute: 40,
        },
      ],
      new Map([["X1", { status: "scheduled" }]]),
    );
    state.resetSchedule();
    assert.equal(state.getFlight("X1")?.status, "queued");
    assert.equal(state.getSchedule().length, 0);
  });
});
