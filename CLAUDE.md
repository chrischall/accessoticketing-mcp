# accessoticketing-mcp — repo notes

MCP server over accesso Passport **mobile ticket links**. Read `docs/ACCESSO-API.md`
before changing anything that touches the wire.

## Shape

- `src/parse.ts` — HTML → `AccessoOrder`. All the hard-won knowledge lives here.
- `src/client.ts` — fetch, redirect resolution, the accesso-host allowlist, error mapping.
- `src/present.ts` — projections for tool output (and the reason barcodes never reach `textResult`).
- `src/io.ts` — the file-output boundary, so hosted deployments don't report paths nobody can open.
- `src/tools/tickets.ts` — the six read-only tools.

## Things that will bite you

- **The ticket URL is a credential.** `oToken` grants the order. Never log it, never
  put one in a fixture, never commit one. `redactUrl` exists for this; use it on any
  path that renders a URL.
- **An expired link returns HTTP 200** with "no tickets available to print on this
  order". Status codes tell you nothing here — gate on the body (`isExpiredOrderPage`).
- **Every ticket is rendered twice.** A mobile `#ticket-item-container<N>` grouping and
  a `.desktopTicketGrouping` one, sharing `img#barcode<N>` ids. Only the mobile blocks
  carry the container id, which is why the selector is what it is.
- **The detail panel is a sibling, not a child.** `#flip-ticket-info-container<N>` hangs
  off `#ticket-grouping-container` alongside the ticket block. Guest Number, Web Sales
  ID, Instructions and Terms all live there and must be joined back by index.
- **`ticketId` is in neither rendering** — only in the trailing "Register this ticket"
  modal forms, in ticket order. The mapping is positional and is *refused* (with a
  warning) when the counts disagree. Do not "fix" that by guessing: a shifted map hands
  out wallet links for the wrong tickets.
- **The host allowlist in `client.ts` is a security boundary.** These tools take a URL
  from the model; without it the server is an SSRF proxy. Don't widen it casually.

## Fixtures

`tests/fixtures/order.html` is a real 12-ticket order with tokens, names, order number,
guest numbers and ticketIds all replaced, and the barcodes swapped for a 1×1 PNG. If you
re-capture, sanitize the same way and re-run the leak scan before committing.

## Conventions

TDD. 100% coverage thresholds, enforced in CI — cover defensive branches rather than
adding `/* v8 ignore */`. Never hand-bump versions (release-please owns them). Don't
merge PRs or add `ready-to-merge` yourself.
