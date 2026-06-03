# Task 4 — ATC MCP Server

AI-ready **Air Traffic Control** server using the [Model Context Protocol](https://modelcontextprotocol.io/). It schedules arrivals and departures, respects runways/gates/ground crew limits, handles flight dependencies and cancellations, and exposes airport state through MCP **tools** and **resources**.

---

## Quick start

```bash
cd task-4
npm install
cp .env.example .env    # first time; .env may already exist for local dev
npm run build
npm test                # 26+ unit tests
npm run validate        # acceptance scenarios 1–3 + edge cases
```

Run the server (stdio MCP):

```bash
npm run dev
```

Configuration is loaded from **environment variables** (via `.env` when using `npm run dev` / `npm start`). Invalid config **exits at startup** with a clear message.

---

## MCP Inspector (recommended UI)

```powershell
cd task-4
.\scripts\start-inspector.ps1
```

Open **http://127.0.0.1:6274** (auth disabled in that script). Config is in [`mcp.json`](./mcp.json) (`env` block).

**Tips**

- Use **JSON** for tool arguments; `dependencies` must be an array, e.g. `["AA100"]`.
- `minRunwayLengthMeters`: leave at **0** or omit in JSON = no runway requirement.
- **Reconnect** Inspector to restart the server and clear the in-memory queue.
- MCP may show “Success” even when a tool returns `isError: true` — read the response text.

---

## Environment variables

| Variable | Description | Example |
|----------|-------------|---------|
| `ATC_RUNWAY_LENGTHS` | Comma-separated runway lengths (m); **runway count** = number of values | `2500,3000,3500` |
| `ATC_RUNWAY_COUNT` | Optional; must match count of `ATC_RUNWAY_LENGTHS` if set | `3` |
| `ATC_GATE_COUNT` | Number of gates | `4` |
| `ATC_GROUND_CREW_COUNT` | Max simultaneous ground operations | `3` |
| `ATC_SEPARATION_TAKEOFF_MINUTES` | Same-runway buffer after takeoff | `2` |
| `ATC_SEPARATION_LANDING_MINUTES` | Same-runway buffer after landing | `3` |
| `ATC_SEPARATION_MIXED_MINUTES` | Mixed takeoff/landing buffer (≥ both above) | `4` |
| `ATC_GATE_TURNAROUND_MINUTES` | Gate free time after use | `45` |
| `ATC_DEPENDENCY_BUFFER_MINUTES` | Gap after inbound before dependent outbound | `30` |
| `ATC_MAX_SCHEDULING_HORIZON_MINUTES` | Latest end minute for any operation | `1440` |
| `ATC_ARRIVAL_DURATION_MINUTES` | Optional block time for arrivals (default `30`) | `30` |
| `ATC_DEPARTURE_DURATION_MINUTES` | Optional block time for departures (default `25`) | `25` |

Copy [`.env.example`](./.env.example) to `.env` for local development.

---

## MCP tools

| Tool | Arguments | Description |
|------|-----------|-------------|
| `ping` | — | Health check, config summary, flight counts |
| `submit_flight` | `flightNumber`, `operationType` (`arrival` \| `departure`), `priority` (`high` \| `medium` \| `low`), optional `dependencies[]`, optional `minRunwayLengthMeters` | Add flight to queue |
| `generate_schedule` | — | Replace active schedule from queue + config |
| `get_airport_status` | — | Operational snapshot (usage, constraints, issues) |
| `cancel_flight` | `flightNumber` | Cancel flight, block dependents, auto-regenerate schedule if one exists |
| `analyze_bottleneck` | — | Longest scheduled dependency chain (critical path) |

---

## MCP resources

| Resource | URI | Description |
|----------|-----|-------------|
| `server-info` | `atc://server/info` | Server metadata + airport config |
| `flight-queue` | `atc://flights/queue` | All flights by status, with reasons |
| `operation-timeline` | `atc://operations/timeline` | Chronological scheduled operations |
| `runway-status` | `atc://runways/status` | Per-runway usage windows |

---

## Validation scenarios (manual in Inspector)

Reconnect for a **clean queue** before each scenario.

### 1 — Morning Rush

Submit:

```json
{"flightNumber":"HA100","operationType":"arrival","priority":"high"}
{"flightNumber":"MD200","operationType":"departure","priority":"medium"}
{"flightNumber":"LA300","operationType":"arrival","priority":"low"}
{"flightNumber":"LD400","operationType":"departure","priority":"low"}
```

Then `generate_schedule` → read `flight-queue`, `operation-timeline`, `runway-status`.

**Expect:** all four `scheduled`; no overlapping runway windows; high-priority arrival not after low when competing.

### 2 — Heavy Hauler

```json
{"flightNumber":"HEAVY1","operationType":"departure","priority":"high","minRunwayLengthMeters":5000}
```

Optional: add a normal flight without `minRunwayLengthMeters`. `generate_schedule` → `get_airport_status`.

**Expect:** `HEAVY1` → `unscheduled`, reason like *No suitable runway available*; others can still schedule.

### 3 — Connecting Flight

```json
{"flightNumber":"IN1","operationType":"arrival","priority":"high"}
{"flightNumber":"OUT1","operationType":"departure","priority":"high","dependencies":["IN1"]}
```

`generate_schedule` → `operation-timeline` → `analyze_bottleneck`.

**Expect:** both scheduled; `OUT1.start ≥ IN1.end + 30`; bottleneck chain `IN1` → `OUT1`.

### Extra checks

| Test | Steps | Expect |
|------|--------|--------|
| Unknown dependency | `submit_flight` with `"dependencies":["MISSING"]` | Tool error |
| Cancel chain | Schedule IN1+OUT1, `cancel_flight` IN1 | OUT1 `blocked` |
| Bad config | Remove `ATC_GATE_COUNT`, restart server | Startup error |

**Automated:** `npm run validate` runs scenarios 1–3 and edge checks in process (no Inspector).

---

## Project layout

```
src/
  index.ts           # MCP entry (stdio)
  config/            # Env loading + validation
  domain/            # Flights, queue, cancel
  scheduling/        # Scheduler + bottleneck
  mcp/               # Tools, resources, airport status
scripts/
  start-inspector.ps1
  validate-scenarios.ts
```

---

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Run server with tsx + `.env` |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run compiled server |
| `npm test` | Unit tests |
| `npm run validate` | Acceptance scenario script |
| `npm run typecheck` | TypeScript check |

---

## Cursor / Claude MCP config (optional)

```json
{
  "mcpServers": {
    "atc": {
      "command": "npm",
      "args": ["run", "dev"],
      "cwd": "D:/example/ai-challenge/task-4",
      "env": {
        "ATC_RUNWAY_LENGTHS": "2500,3000,3500",
        "ATC_GATE_COUNT": "4",
        "ATC_GROUND_CREW_COUNT": "3",
        "ATC_SEPARATION_TAKEOFF_MINUTES": "2",
        "ATC_SEPARATION_LANDING_MINUTES": "3",
        "ATC_SEPARATION_MIXED_MINUTES": "4",
        "ATC_GATE_TURNAROUND_MINUTES": "45",
        "ATC_DEPENDENCY_BUFFER_MINUTES": "30",
        "ATC_MAX_SCHEDULING_HORIZON_MINUTES": "1440"
      }
    }
  }
}
```

Adjust `cwd` to your machine path.
