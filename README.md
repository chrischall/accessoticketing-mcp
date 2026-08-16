# accessoticketing-mcp

[![CI](https://github.com/chrischall/accessoticketing-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/chrischall/accessoticketing-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@chrischall/accessoticketing-mcp)](https://www.npmjs.com/package/@chrischall/accessoticketing-mcp)

An MCP server for **accesso Passport mobile ticket links** — the URL a venue emails
you after a purchase. Reads the order and every admission on it, the scannable
barcodes, and Google Wallet save links.

accesso powers ticketing for a lot of theme parks, water parks, camps, museums and
festivals, so one server covers all of them: the merchant is encoded in the link.

> Developed and maintained by AI (Claude Code). Use at your own discretion.

## What it needs

**No login.** These links carry their own credential — the `oToken` in the query
string is what authorises the read. There is no account, no password, no browser
session, and no bot wall.

> [!WARNING]
> That also means **the link is a secret**. Anyone holding it can view and add the
> order's tickets. Treat it like a password: don't paste it into issues, logs or
> chats. This server redacts the tokens from its own output and error messages.

## Install

```bash
npx -y @chrischall/accessoticketing-mcp
```

```jsonc
// claude_desktop_config.json / .mcp.json
{
  "mcpServers": {
    "accessoticketing": {
      "command": "npx",
      "args": ["-y", "@chrischall/accessoticketing-mcp"],
      "env": { "ACCESSO_TICKET_URL": "https://media-engine.na3.accessoticketing.com/tickets/v1/..." }
    }
  }
}
```

`ACCESSO_TICKET_URL` is optional — it just saves passing `url` on every call. The
server starts fine without it and reports the missing link on first use.

| Variable | Required | Purpose |
|---|---|---|
| `ACCESSO_TICKET_URL` | no | Default ticket link, used when a tool is called without `url`. |
| `ACCESSO_OUTPUT_DIR` | no | Where `accesso_save_barcodes` writes PNGs. Defaults to cwd. |
| `ACCESSO_NO_FILE_OUTPUT` | no | Set to `1` where the filesystem isn't the user's (a hosted deployment) so barcodes return inline. |

## Tools

| Tool | Does |
|---|---|
| `accesso_get_order` | The order and every admission: product, participant, date, start time, instructions. `compact` for a slim list. |
| `accesso_get_ticket` | One admission in full, by `index`. |
| `accesso_save_barcodes` | Writes barcode PNGs and returns paths, or returns the images inline. |
| `accesso_get_wallet_passes` | Google Wallet save links for the tickets. |
| `accesso_resolve_link` | Unwraps an email click-tracking link to the accesso URL it hides. |
| `accesso_healthcheck` | Confirms reachability and whether a default link is configured. |

Every tool is read-only; nothing here mutates an order.

```
> what do we have booked tomorrow?
9:00 AM   Tiny Trekkers Full-Day (Ages 4-7)   — one participant
9:00 AM   Whitewater Kayak Camp I: Intro      — two participants
all-day   Lunch / Snack / Early Drop-Off      — nine more admissions
```

## Shell-out skill

Prefer a shell? `skills/accesso-tickets/` does the same reading with `curl` and a
dependency-free parser, no server required. It ships with the package.

## Notes on the data

- `date` / `time` are the merchant's local wall-clock strings with no timezone
  attached. They are passed through verbatim rather than converted.
- Merchant-specific detail rows (`Guest Number`, `Web Sales ID`, …) are harvested
  generically into `details`, so a venue this was never tested against still works.
- An expired link returns **HTTP 200**, not an error status — the server detects
  the body and says the link is expired rather than reporting zero tickets.

## Development

```bash
npm install
npm run build
npm test
npm run test:coverage   # 100% thresholds, enforced in CI
```

See `docs/ACCESSO-API.md` for the captured request/response shapes and `CLAUDE.md`
for repo conventions.

## License

MIT
