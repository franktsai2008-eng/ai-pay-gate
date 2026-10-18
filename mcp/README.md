# Backup MCP server

A spare copy of the Claude connection, in case the team's MCP server isn't ready. It gives Claude Desktop the eight agent tools from BACKEND-PLAN-for-team.md section 8 (`find_offers`, `check_payment`, `pay`, `payment_status`, `get_delivery`, `balance`, `history`, `my_rules`) and passes the backend's answers through unchanged.

It holds only the agent token. No owner token and no keys, so Claude can't approve, change rules, pause or withdraw through it.

## Use

```bash
cd mcp && npm install
```

Claude Desktop → Settings → Developer → Edit Config, then add:

```json
{
  "mcpServers": {
    "sigil": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/ai-pay-gate/mcp/index.mjs"],
      "env": {
        "API_BASE": "https://<backend url>/api/v1",
        "AGENT_TOKEN": "<agent token from Frank>"
      }
    }
  }
}
```

Restart Claude Desktop. For the stage demo, turn off every other tool in Claude (SPEC 10: only this connector, no files, terminal or web), so the audience can see the config.

Tested 10/18 with an MCP client against a local backend: the listing search, green, yellow and red payments, the sanctioned-address check, balance, rules, and an error case all came back as expected.
