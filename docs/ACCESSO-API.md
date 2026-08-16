# accesso ticket delivery — captured shapes

Everything here was captured live against a real accesso order on
`media-engine.na3.accessoticketing.com` (island `accesso155`, 12 tickets, 2026-08-16).
No tokens or personal data are reproduced.

## Surfaces

accesso exposes two consumer surfaces. **This server implements only the first.**

| | Ticket delivery (implemented) | Passport store API (not implemented) |
|---|---|---|
| Host | `media-engine.<region>.accessoticketing.com` | `ecomm.api.<region>.accessoticketing.com` |
| Auth | `oToken` in the emailed URL | merchant session + account credentials |
| Shape | server-rendered HTML | `POST /api/request/<service>`, JSON |
| Bot wall | none | none (a malformed body returns 400) |

The store API carries ~150 services (`GetMerchantPackageList`, `GetParkHours`,
`GetEventCalendarDates`, `CP_Login`, `GuestOrderSearch`, `GuestViewOrder`, cart and
purchase). A merchant's store lives at `<merchant>.secure.<region>.accessoticketing.com`,
whose page sets `accessoHost = 'ecomm.api.<region>.accessoticketing.com'`. Adding it
would need merchant identification captured from a live store session.

## Ticket page

```
GET https://media-engine.<region>.accessoticketing.com/tickets/v1/<island>
      ?oToken=A1:…&cToken=A1:…&language=en&merchant_id=<n>
→ 200 text/html
```

No headers required. No cookies. Both tokens are needed.

**Failure:** an expired or invalid `oToken` returns **HTTP 200** with a page reading
*"We are sorry, but there are no tickets available to print on this order."* Verified by
probing a deliberately bogus token. There is no error status to key on.

### Document structure

```
span.ticketHeader__orderNumber              "Order #  <n>"
img.ticketHeader__merchantLogo              …/assets/<island>/images/…

div#ticket-grouping-container
  div#ticket-item-container<N>[data-ticketidx][data-totaltickets]   ← one per ticket
    .ticket__packageName                    product name
    .ticket__customerName > div             participant, then additional guests
    .ticket__barcodeText                    "ID %RC<order>"
    img#barcode<N>                          inline base64 PNG
    .gap-font--overline + .gap-font--body-2 label/value pairs (Date, Time)
  div#flip-ticket-info-container<N>         ← SIBLING of the block above, not a child
    .gap-font--overline + .gap-font--body-2 Guest Number, Web Sales ID
    .flipTicket__content-heading + .flipTicket__content   Instructions, Terms

div#desktop-ticket-section.desktopTicketGrouping   ← the SAME tickets again,
  div.desktopTicket ×N                               reusing img#barcode<N> ids

form#registrationForm ×N                    ← trailing "Register this ticket" modals
  input[name=ticketId]                        the only place ticketId appears,
  input[name=oToken]                          in ticket order
  input[name=merchantId]
```

Three traps, each of which produced a wrong parser first time:

1. Selecting barcodes or package names document-wide **doubles** every ticket, because
   the desktop grouping repeats them all.
2. The detail panel is a **sibling**, so reading fields "inside the ticket block" yields
   an empty `details` map.
3. `ticketId` is in **neither** rendering. It is positional against the registration
   forms — which is safe only while the counts match, so a mismatch must disable the
   mapping rather than shift it.

Detail rows vary by merchant, so they are harvested generically rather than by a fixed
list of labels.

## Google Wallet pass

```
GET https://media-engine.<region>.accessoticketing.com/google-wallet/v1/<island>/<oToken>/<ticketId>
→ 200 application/json   {"jwt": "eyJ0eXAiOiJKV1QiLC…"}
```

The page sends `X-ACCESSOPASSPORT-ORIGIN: <store-origin>`; it is **not** required — a
bare request returns 200. The JWT becomes a save link via Google's standard form,
`https://pay.google.com/gp/v/save/<jwt>` (verified: resolves, then prompts Google
sign-in, as expected).

## Not implemented

`form#registrationForm` posts a `ticketCustomerName` to assign a name to an unassigned
ticket (orders show `GUEST GUEST` until then). It is a **write**, and was not captured
or verified, so no tool exposes it.
