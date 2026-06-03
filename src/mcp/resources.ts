import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { configSummary } from "../config/index.js";
import type { AppContext } from "./context.js";

export function registerResources(server: McpServer, ctx: AppContext): void {
  server.registerResource(
    "server-info",
    "atc://server/info",
    {
      title: "Server info",
      description: "Server metadata and airport configuration summary.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              name: ctx.serverName,
              version: ctx.serverVersion,
              status: "operational",
              airport: configSummary(ctx.config),
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.registerResource(
    "flight-queue",
    "atc://flights/queue",
    {
      title: "Flight queue",
      description:
        "All flights including queued, scheduled, unscheduled, cancelled, and blocked, with reasons and scheduled slots when applicable.",
      mimeType: "application/json",
    },
    async (uri) => {
      const queue = ctx.state.getFlightQueue();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                scheduleGenerated: ctx.state.hasSchedule(),
                flightCount: queue.length,
                flights: queue,
                summary: ctx.state.getFlightCounts(),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerResource(
    "operation-timeline",
    "atc://operations/timeline",
    {
      title: "Operation timeline",
      description:
        "Chronological list of scheduled airport operations from the active schedule.",
      mimeType: "application/json",
    },
    async (uri) => {
      const slots = ctx.state.getSchedule();
      const queue = ctx.state.getFlightQueue();
      const byFlight = new Map(queue.map((f) => [f.flightNumber, f]));
      const timeline = slots.map((slot) => ({
        ...slot,
        priority: byFlight.get(slot.flightNumber)?.priority,
        dependencies: byFlight.get(slot.flightNumber)?.dependencies ?? [],
      }));
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                scheduleGenerated: ctx.state.hasSchedule(),
                completionMinute: ctx.state.getScheduleCompletionMinute(),
                operationCount: timeline.length,
                timeline,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerResource(
    "runway-status",
    "atc://runways/status",
    {
      title: "Runway status",
      description:
        "Runway capacity and scheduled usage windows for the active schedule.",
      mimeType: "application/json",
    },
    async (uri) => {
      const slots = ctx.state.getSchedule();
      const runways = ctx.config.runways.map((runway) => {
        const usage = slots
          .filter((s) => s.runwayId === runway.id)
          .map((s) => ({
            flightNumber: s.flightNumber,
            operationType: s.operationType,
            startMinute: s.startMinute,
            endMinute: s.endMinute,
            gateId: s.gateId,
          }));
        return {
          runwayId: runway.id,
          lengthMeters: runway.lengthMeters,
          scheduledOperations: usage.length,
          available: usage.length === 0,
          usage,
        };
      });
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                runwayCount: runways.length,
                runways,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
