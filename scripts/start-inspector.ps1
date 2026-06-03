# Start MCP Inspector for local dev (auth disabled — local only).
$env:DANGEROUSLY_OMIT_AUTH = "true"
Set-Location $PSScriptRoot\..
npx @modelcontextprotocol/inspector --config mcp.json --server atc
