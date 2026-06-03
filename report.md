# Task 4 — ATC MCP Server — Report

## Scheduling approach

The server keeps an in-memory **flight queue** and a **single active schedule** that is replaced wholesale on each `generate_schedule` call. Scheduling is not incremental: every generation recomputes assignments from the current queue and airport configuration, which keeps behavior predictable and satisfies the determinism requirement.

### Algorithm (high level)

1. **Filter** flights that are `cancelled` or `blocked`; they are not placed.
2. **Order** remaining flights with Kahn’s topological sort on dependencies. Within each “ready” wave, sort by **priority** (high → medium → low), then **flight number** for stable ties.
3. For each flight in order:
   - Fail early if a dependency is cancelled, blocked, or unscheduled.
   - Reject if no runway meets `minLengthMeters` (Heavy Hauler case).
   - Search all eligible **runway × gate** pairs; pick the slot with the **earliest start**, breaking ties by lowest runway id, then gate id.
   - Enforce **earliest start** = max of:
     - dependency end + `ATC_DEPENDENCY_BUFFER_MINUTES`
     - runway separation after the previous op on that runway
     - gate free time (previous end + turnaround)
     - ground-crew availability (bump minute-by-minute until concurrent ops ≤ crew limit)
   - Reject if end time exceeds `ATC_MAX_SCHEDULING_HORIZON_MINUTES`.

Runway separation uses three buffers (takeoff / landing / mixed). Gate reuse uses a per-gate `availableFromMinute` tracker. Ground crew is modeled as “one crew unit per active operation minute,” not per runway.

### Bottleneck analysis

Among **scheduled** flights only, we build dependency edges (dep → dependent) and use dynamic programming to find the chain with the largest **wall-clock span** in the published schedule: `last.endMinute − first.startMinute`. That includes real waits and buffers, not just summed nominal durations. The tool also reports per-link `dependencyBufferMinutes` and extra `waitAfterDependencyMinutes`.

### Cancellation

`cancel_flight` marks the flight cancelled, removes it from the active schedule, and **blocks** all transitive dependents. If a schedule already existed, the server immediately calls **`generate_schedule` again** so remaining flights are re-evaluated without manual steps.

---

## Key design decisions

| Decision | Rationale |
|----------|-----------|
| **stdio MCP** | Standard for Cursor, Inspector, Claude Desktop; no HTTP server to deploy. |
| **Runway lengths env (`ATC_RUNWAY_LENGTHS`)** | Runway *count* = list length; lengths enable Scenario 2 (oversized aircraft) without a separate count variable. Optional `ATC_RUNWAY_COUNT` cross-checks the list. |
| **Regenerate schedule on cancel** | Meets “re-evaluate dependents” by recomputing the plan for all non-blocked flights. |
| **Blocked vs unscheduled** | Blocked = dependency failure (e.g. cancelled inbound); unscheduled = scheduler could not place. |
| **0 = no runway requirement** | MCP Inspector often sends `0` for empty numeric fields. |
| **In-memory state** | Task scope is coordination logic, not persistence. |

---

## Tools and techniques

- **Language:** TypeScript on Node 20+
- **MCP:** `@modelcontextprotocol/sdk` (`McpServer`, stdio transport)
- **Validation:** Zod for tool inputs and config parsing
- **Tests:** Node built-in test runner (`npm test`, 26+ tests)
- **Acceptance:** `npm run validate` script for scenarios 1–3 and edge cases
- **Local testing:** MCP Inspector via `scripts/start-inspector.ps1` and `mcp.json`

---

## What worked well

- Topological ordering plus priority waves produced correct connecting-flight ordering and sensible Morning Rush priority behavior.
- Fail-fast config at startup caught misconfigured airports before any client connected.
- Separating **tools** (mutate state) from **resources** (read snapshots) matched how AI clients discover and use the server.
- `npm run validate` gave fast regression signal without driving the UI manually.

---

## What was tricky / limitations

- **Inspector UX:** Optional numeric fields default to `0`; documenting “0 means none” was necessary. Dependency arrays must be real JSON arrays, not informal text.
- **Cancel without reschedule:** Early versions only blocked dependents; auto-`generate_schedule` after cancel aligned better with the written requirement.
- **Gate overlap tests:** Logic prevents gate conflicts via turnaround tracking; automated tests emphasized runway overlap first; gate overlap checks were added to `npm run validate`.
- **No persistence:** Restarting the MCP process clears all flights (expected for this task).
- **No physics:** Speed, weight, and weather are out of scope; only time windows and capacity matter.
