import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { configSummary } from "../config/index.js";
import { DomainError } from "../domain/index.js";
import { buildAirportStatus } from "./airport-status.js";
import { analyzeBottleneck } from "../scheduling/index.js";
import type { AppContext } from "./context.js";
import { jsonContent, toolError } from "./responses.js";

const submitFlightSchema = {
  flightNumber: z
    .string()
    .min(1)
    .describe("Unique flight identifier (e.g. UA100)"),
  operationType: z
    .enum(["arrival", "departure"])
    .describe("arrival (landing) or departure (takeoff)"),
  priority: z
    .enum(["high", "medium", "low"])
    .describe("Scheduling priority when resources are contested"),
  dependencies: z
    .array(z.string())
    .optional()
    .describe(
      "Flight numbers that must complete before this one (submit dependencies first)",
    ),
  minRunwayLengthMeters: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      "Minimum runway length (meters). Omit or use 0 for no requirement (Inspector often defaults to 0).",
    ),
};

/** Inspector number inputs often send 0 when the field looks empty. */
function runwayRequirementFromMeters(
  meters: number | undefined,
): { minLengthMeters: number } | undefined {
  if (meters === undefined || meters <= 0) {
    return undefined;
  }
  return { minLengthMeters: meters };
}

export function registerTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "ping",
    {
      title: "Ping",
      description:
        "Health check with airport configuration and flight count summary.",
      inputSchema: {},
    },
    async () =>
      jsonContent({
        ok: true,
        server: ctx.serverName,
        version: ctx.serverVersion,
        airport: configSummary(ctx.config),
        flights: ctx.state.getFlightCounts(),
      }),
  );

  server.registerTool(
    "submit_flight",
    {
      title: "Submit flight",
      description:
        "Add a new arrival or departure to the flight queue. Dependencies must already exist. Rejects duplicates, cycles, and unknown dependencies.",
      inputSchema: submitFlightSchema,
    },
    async (args) => {
      try {
        const flight = ctx.state.submitFlight({
          flightNumber: args.flightNumber,
          operationType: args.operationType,
          priority: args.priority,
          dependencies: args.dependencies,
          runwayRequirement: runwayRequirementFromMeters(
            args.minRunwayLengthMeters,
          ),
        });
        return jsonContent({
          ok: true,
          flight: {
            flightNumber: flight.flightNumber,
            operationType: flight.operationType,
            priority: flight.priority,
            dependencies: flight.dependencies,
            runwayRequirement: flight.runwayRequirement,
            status: flight.status,
            submittedAt: flight.submittedAt,
          },
          flights: ctx.state.getFlightCounts(),
        });
      } catch (err) {
        if (err instanceof DomainError) {
          return toolError(err.message);
        }
        throw err;
      }
    },
  );

  server.registerTool(
    "generate_schedule",
    {
      title: "Generate schedule",
      description:
        "Replace the current airport schedule with a freshly computed plan from the flight queue and airport configuration.",
      inputSchema: {},
    },
    async () => {
      const result = ctx.state.runGenerateSchedule(ctx.config);
      return jsonContent({
        ok: true,
        scheduledCount: result.slots.length,
        completionMinute: result.completionMinute,
        flights: ctx.state.getFlightCounts(),
        slots: result.slots,
      });
    },
  );

  server.registerTool(
    "get_airport_status",
    {
      title: "Get airport status",
      description:
        "Structured operational snapshot: flight counts, runway/gate/crew usage, constraint flags, unscheduled and blocked flights with reasons, and schedule completion time.",
      inputSchema: {},
    },
    async () =>
      jsonContent({
        ok: true,
        status: buildAirportStatus(ctx.config, ctx.state),
      }),
  );

  server.registerTool(
    "cancel_flight",
    {
      title: "Cancel flight",
      description:
        "Cancel a flight by number. Removes it from the active schedule, blocks transitive dependents, and regenerates the schedule when one already exists.",
      inputSchema: {
        flightNumber: z
          .string()
          .min(1)
          .describe("Flight number to cancel (e.g. AA100)"),
      },
    },
    async (args) => {
      try {
        const hadSchedule = ctx.state.hasSchedule();
        const affected = ctx.state.cancelFlight(args.flightNumber);
        const cancelled = affected[0] ?? args.flightNumber.trim().toUpperCase();
        const blockedDependents = affected.filter((id) => id !== cancelled);

        let scheduleRefresh: {
          scheduledCount: number;
          completionMinute: number | null;
        } | null = null;
        if (hadSchedule) {
          const result = ctx.state.runGenerateSchedule(ctx.config);
          scheduleRefresh = {
            scheduledCount: result.slots.length,
            completionMinute: result.completionMinute,
          };
        }

        return jsonContent({
          ok: true,
          cancelled,
          affectedFlights: affected,
          blockedDependents,
          scheduleRegenerated: scheduleRefresh !== null,
          scheduleRefresh,
          flights: ctx.state.getFlightCounts(),
        });
      } catch (err) {
        if (err instanceof DomainError) {
          return toolError(err.message);
        }
        throw err;
      }
    },
  );

  server.registerTool(
    "analyze_bottleneck",
    {
      title: "Analyze bottleneck",
      description:
        "Find the longest active dependency chain in the current schedule. Returns ordered flights and total elapsed minutes (from first start to last end, including buffers and waits). Requires a generated schedule.",
      inputSchema: {},
    },
    async () => {
      const analysis = analyzeBottleneck(
        ctx.config,
        ctx.state.listFlights(),
        ctx.state.getSchedule(),
      );
      return jsonContent({
        ok: true,
        analysis,
      });
    },
  );
}
