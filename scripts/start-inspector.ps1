# Start MCP Inspector for local dev (auth disabled - local only).
$env:DANGEROUSLY_OMIT_AUTH = "true"
Set-Location $PSScriptRoot\..
yarn dlx @modelcontextprotocol/inspector --config mcp.json --server atc
