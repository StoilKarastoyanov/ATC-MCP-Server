#!/usr/bin/env node
/**
 * ATC MCP Server — entry point.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigError, loadAirportConfig } from "./config/index.js";
import { createAirportState } from "./domain/index.js";
import { registerAtcHandlers } from "./mcp/register.js";

const SERVER_NAME = "atc-mcp-server";
const SERVER_VERSION = "0.1.0";

async function main(): Promise<void> {
  let config;
  try {
    config = loadAirportConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`Configuration error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const state = createAirportState();
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerAtcHandlers(server, {
    config,
    state,
    serverName: SERVER_NAME,
    serverVersion: SERVER_VERSION,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `${SERVER_NAME} v${SERVER_VERSION} listening on stdio (${config.runways.length} runways, ${config.gateCount} gates)`,
  );
}

main().catch((err) => {
  console.error("Fatal error starting MCP server:", err);
  process.exit(1);
});
