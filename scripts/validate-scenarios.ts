#!/usr/bin/env node
/**
 * Automated acceptance checks for task-4 validation scenarios.
 * Run: npm run validate
 */
import { loadAirportConfig } from "../src/config/index.js";
import { createAirportState } from "../src/domain/index.js";
import { analyzeBottleneck } from "../src/scheduling/bottleneck.js";

const config = loadAirportConfig(process.env);

let passed = 0;
let failed = 0;

function ok(name: string): void {
  passed++;
  console.log(`  PASS  ${name}`);
}

function fail(name: string, detail: string): void {
  failed++;
  console.error(`  FAIL  ${name}`);
  console.error(`        ${detail}`);
}

function assert(name: string, condition: boolean, detail: string): void {
  if (condition) {
    ok(name);
  } else {
    fail(name, detail);
  }
}

function assertNoRunwayOverlaps(
  slots: {
    runwayId: number;
    startMinute: number;
    endMinute: number;
    operationType: string;
    flightNumber: string;
  }[],
  cfg: typeof config,
) {
  for (const s of slots) {
    const overlaps = slots.filter(
      (o) =>
        o.runwayId === s.runwayId &&
        o.flightNumber !== s.flightNumber &&
        o.startMinute < s.endMinute &&
        s.startMinute < o.endMinute,
    );
    assert(
      `no runway overlap (${s.flightNumber} runway ${s.runwayId})`,
      overlaps.length === 0,
      JSON.stringify(overlaps),
    );
  }
}

function assertNoGateOverlaps(
  slots: {
    gateId: number;
    startMinute: number;
    endMinute: number;
    flightNumber: string;
  }[],
  cfg: typeof config,
) {
  for (const s of slots) {
    const overlaps = slots.filter(
      (o) =>
        o.gateId === s.gateId &&
        o.flightNumber !== s.flightNumber &&
        o.startMinute < s.endMinute &&
        s.startMinute < o.endMinute,
    );
    assert(
      `no gate overlap (${s.flightNumber} gate ${s.gateId})`,
      overlaps.length === 0,
      JSON.stringify(overlaps),
    );
  }
}

console.log("\n=== Scenario 1: Morning Rush ===\n");
{
  const state = createAirportState();
  state.submitFlight({
    flightNumber: "HA100",
    operationType: "arrival",
    priority: "high",
  });
  state.submitFlight({
    flightNumber: "MD200",
    operationType: "departure",
    priority: "medium",
  });
  state.submitFlight({
    flightNumber: "LA300",
    operationType: "arrival",
    priority: "low",
  });
  state.submitFlight({
    flightNumber: "LD400",
    operationType: "departure",
    priority: "low",
  });
  const result = state.runGenerateSchedule(config);
  const scheduled = [...result.outcomes.values()].filter(
    (o) => o.status === "scheduled",
  ).length;
  assert("all four flights scheduled", scheduled === 4, `scheduled=${scheduled}`);
  const ha = result.slots.find((s) => s.flightNumber === "HA100")!;
  const la = result.slots.find((s) => s.flightNumber === "LA300")!;
  assert(
    "high-priority arrival not after low-priority arrival",
    ha.startMinute <= la.startMinute,
    `HA100@${ha.startMinute} LA300@${la.startMinute}`,
  );
  assertNoRunwayOverlaps(result.slots, config);
  assertNoGateOverlaps(result.slots, config);
}

console.log("\n=== Scenario 2: Heavy Hauler ===\n");
{
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
  const result = state.runGenerateSchedule(config);
  assert(
    "HEAVY1 unscheduled",
    result.outcomes.get("HEAVY1")?.status === "unscheduled",
    String(result.outcomes.get("HEAVY1")),
  );
  const reason =
    result.outcomes.get("HEAVY1")?.status === "unscheduled"
      ? result.outcomes.get("HEAVY1")!.reason
      : "";
  assert(
    "reason mentions runway",
    /runway/i.test(reason),
    reason,
  );
  assert(
    "OK1 still scheduled",
    result.outcomes.get("OK1")?.status === "scheduled",
    String(result.outcomes.get("OK1")),
  );
  const heavy = state.getFlight("HEAVY1");
  assert(
    "HEAVY1 visible in queue as unscheduled",
    heavy?.status === "unscheduled",
    String(heavy?.status),
  );
}

console.log("\n=== Scenario 3: Connecting Flight ===\n");
{
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
  const result = state.runGenerateSchedule(config);
  const inbound = result.slots.find((s) => s.flightNumber === "IN1")!;
  const outbound = result.slots.find((s) => s.flightNumber === "OUT1")!;
  assert(
    "both scheduled",
    result.outcomes.get("IN1")?.status === "scheduled" &&
      result.outcomes.get("OUT1")?.status === "scheduled",
    JSON.stringify([...result.outcomes.entries()]),
  );
  assert(
    "outbound starts after inbound + buffer",
    outbound.startMinute >= inbound.endMinute + config.dependencyBufferMinutes,
    `out@${outbound.startMinute} inEnd@${inbound.endMinute} buffer@${config.dependencyBufferMinutes}`,
  );
  const bn = analyzeBottleneck(config, state.listFlights(), result.slots);
  assert(
    "bottleneck chain includes IN1 then OUT1",
    bn.chain.map((c) => c.flightNumber).join(",") === "IN1,OUT1",
    bn.chain.map((c) => c.flightNumber).join(","),
  );
}

console.log("\n=== Edge cases ===\n");
{
  const state = createAirportState();
  state.submitFlight({
    flightNumber: "IN2",
    operationType: "arrival",
    priority: "high",
  });
  state.submitFlight({
    flightNumber: "OUT2",
    operationType: "departure",
    priority: "high",
    dependencies: ["IN2"],
  });
  state.runGenerateSchedule(config);
  state.cancelFlight("IN2");
  assert(
    "cancel blocks dependent",
    state.getFlight("OUT2")?.status === "blocked",
    String(state.getFlight("OUT2")?.status),
  );
  state.submitFlight({
    flightNumber: "SOLO1",
    operationType: "arrival",
    priority: "medium",
  });
  const afterCancel = state.runGenerateSchedule(config);
  assert(
    "cancel triggers reschedule of remaining flights",
    afterCancel.outcomes.get("SOLO1")?.status === "scheduled",
    String(afterCancel.outcomes.get("SOLO1")),
  );
  assert(
    "horizon limit prevents long schedule",
    (() => {
      const tight = loadAirportConfig({
        ...process.env,
        ATC_MAX_SCHEDULING_HORIZON_MINUTES: "10",
        ATC_RUNWAY_LENGTHS: "3000",
        ATC_RUNWAY_COUNT: "1",
        ATC_GATE_COUNT: "1",
        ATC_GROUND_CREW_COUNT: "1",
      });
      const s = createAirportState();
      s.submitFlight({
        flightNumber: "LATE1",
        operationType: "arrival",
        priority: "high",
      });
      const r = s.runGenerateSchedule(tight);
      return r.outcomes.get("LATE1")?.status === "unscheduled";
    })(),
    "expected unscheduled within 10 minute horizon",
  );
  assert(
    "ground crew limit delays concurrent ops",
    (() => {
      const tight = loadAirportConfig({
        ...process.env,
        ATC_GROUND_CREW_COUNT: "1",
        ATC_GATE_COUNT: "4",
        ATC_RUNWAY_LENGTHS: "3000,3500",
        ATC_RUNWAY_COUNT: "2",
      });
      const s = createAirportState();
      s.submitFlight({
        flightNumber: "C1",
        operationType: "arrival",
        priority: "high",
      });
      s.submitFlight({
        flightNumber: "C2",
        operationType: "arrival",
        priority: "high",
      });
      const r = s.runGenerateSchedule(tight);
      const a = r.slots.find((x) => x.flightNumber === "C1")!;
      const b = r.slots.find((x) => x.flightNumber === "C2")!;
      return (
        r.outcomes.get("C1")?.status === "scheduled" &&
        r.outcomes.get("C2")?.status === "scheduled" &&
        (a.startMinute >= b.endMinute || b.startMinute >= a.endMinute)
      );
    })(),
    "expected serial ground crew usage",
  );
  assert(
    "unknown dependency rejected at submit",
    (() => {
      const s = createAirportState();
      try {
        s.submitFlight({
          flightNumber: "X1",
          operationType: "departure",
          priority: "low",
          dependencies: ["NOPE"],
        });
        return false;
      } catch {
        return true;
      }
    })(),
    "expected DomainError",
  );
}

console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
