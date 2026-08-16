/** A single admission line on an accesso order. */
export interface AccessoTicket {
  /** Position on the order page (`data-ticketidx`). */
  index: number;
  /**
   * accesso's own id for the ticket, needed for a Google Wallet pass. Null when
   * it could not be established safely — see `AccessoOrder.warnings`.
   */
  ticketId: string | null;
  packageName: string | null;
  participant: string | null;
  additionalGuests: string[];
  /** Merchant-local wall clock, `MM/DD/YYYY`. No timezone is published. */
  date: string | null;
  /** Merchant-local start time, or null for an all-day item. */
  time: string | null;
  /** The human-readable code under the barcode, e.g. `ID %RC90000001`. */
  barcodeText: string | null;
  /** Decoded barcode image bytes, when the page inlined one. */
  barcodePng: Buffer | null;
  /**
   * Every other label/value row the merchant rendered, verbatim and
   * un-renamed (`Guest Number`, `Web Sales ID`, …). Harvested generically so a
   * venue with different rows still comes through instead of being dropped.
   */
  details: Record<string, string>;
  instructions: string | null;
  termsAndConditions?: string;
  googleWalletUrl: string | null;
}

export interface AccessoOrder {
  orderNumber: string | null;
  /** accesso's merchant slug, e.g. `accesso155`. */
  island: string | null;
  merchantId: string | null;
  merchantLogo: string | null;
  ticketCount: number;
  /** What the page itself claimed (`data-totaltickets`), for cross-checking. */
  declaredTicketCount: number | null;
  tickets: AccessoTicket[];
  /** Non-fatal parsing concerns, surfaced rather than swallowed. */
  warnings: string[];
}

export interface ParseOptions {
  includeTerms?: boolean;
  /** The ticket URL the HTML came from; required to build wallet links. */
  sourceUrl?: string | null;
}
