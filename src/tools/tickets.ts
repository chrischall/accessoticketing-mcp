import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textResult, imageResult, McpToolError } from '@chrischall/mcp-utils';
import type { AccessoClient } from '../client.js';
import { redactUrl } from '../client.js';
import type { FileIO } from '../io.js';
import { presentOrder, presentTicket, selectTickets } from '../present.js';

export interface ToolDeps {
  client: AccessoClient;
  io: FileIO;
  /**
   * Cap on cumulative inline image bytes, so a large order cannot flood the
   * caller's context. Configurable because the useful ceiling differs between a
   * local stdio host and a remote connector.
   */
  maxInlineBytes?: number;
}

const urlArg = z
  .string()
  .optional()
  .describe(
    'The accesso ticket link from the order-confirmation email. Optional when ACCESSO_TICKET_URL is set.',
  );

const indexesArg = z
  .array(z.number().int().nonnegative())
  .optional()
  .describe('Ticket `index` values to act on. Omit for every ticket on the order.');

/** Default cap on cumulative inline image bytes. */
export const MAX_INLINE_BYTES = 2 * 1024 * 1024;

export function registerTicketTools(server: McpServer, deps: ToolDeps): void {
  const { client, io, maxInlineBytes = MAX_INLINE_BYTES } = deps;

  server.registerTool(
    'accesso_get_order',
    {
      description:
        'Read an accesso ticket link: the order number and every admission on it — product, participant, date, start time, barcode text, and the merchant instructions. Covers any accesso-powered venue (theme parks, camps, festivals). Needs no login; the emailed link is the credential.',
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        url: urlArg,
        compact: z
          .boolean()
          .optional()
          .describe('Return only index, product, participant, date and time (default false).'),
        include_terms: z
          .boolean()
          .optional()
          .describe('Include each ticket\'s terms and conditions (long, and identical per venue).'),
      },
    },
    (async ({ url, compact, include_terms }) => {
      const target = client.resolveTicketUrl(url);
      const order = await client.getOrder(target, { includeTerms: include_terms === true });
      return textResult(presentOrder(order, compact === true));
    }),
  );

  server.registerTool(
    'accesso_get_ticket',
    {
      description:
        'One admission from an accesso order in full detail, including the merchant instructions and (on request) the terms. Identify it by its `index` from accesso_get_order.',
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        index: z.number().int().nonnegative().describe('Ticket index, from accesso_get_order.'),
        url: urlArg,
        include_terms: z.boolean().optional().describe('Include the terms and conditions.'),
      },
    },
    (async ({ index, url, include_terms }) => {
      const target = client.resolveTicketUrl(url);
      const order = await client.getOrder(target, { includeTerms: include_terms === true });
      const ticket = order.tickets.find((t) => t.index === index);
      if (!ticket) {
        throw new McpToolError(`No ticket with index ${index} on order ${order.orderNumber}.`, {
          hint: `This order has indexes 0–${order.tickets.length - 1}.`,
        });
      }
      return textResult(presentTicket(ticket));
    }),
  );

  server.registerTool(
    'accesso_save_barcodes',
    {
      description:
        'Save the scannable barcode images from an accesso order. Writes PNGs and returns their paths; set inline to receive the images directly instead (which is the only useful mode when this server runs remotely, since its filesystem is not the user\'s).',
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        url: urlArg,
        indexes: indexesArg,
        inline: z
          .boolean()
          .optional()
          .describe('Return the images in the response instead of writing files.'),
      },
    },
    (async ({ url, indexes, inline }) => {
      const target = client.resolveTicketUrl(url);
      const order = await client.getOrder(target);
      const { selected, missing } = selectTickets(order.tickets, indexes);
      if (missing.length > 0) {
        throw new McpToolError(`Order ${order.orderNumber} has no ticket at index ${missing.join(', ')}.`, {
          hint: `Valid indexes are 0–${order.tickets.length - 1}.`,
        });
      }

      const withBarcodes = selected.filter((t) => t.barcodePng !== null);
      if (withBarcodes.length === 0) {
        throw new McpToolError('None of the selected tickets carry a barcode image.');
      }

      // Inline whenever asked, and always when a written path would be a lie.
      if (inline === true || !io.persistsFiles) {
        const images = [];
        let bytes = 0;
        let dropped = 0;
        for (const t of withBarcodes) {
          const png = t.barcodePng!;
          if (bytes + png.length > maxInlineBytes) {
            dropped++;
            continue;
          }
          bytes += png.length;
          images.push(imageResult(png.toString('base64'), 'image/png'));
        }
        const note = {
          order: order.orderNumber,
          returned: images.length,
          ...(dropped > 0 ? { omittedForSize: dropped } : {}),
          tickets: withBarcodes.slice(0, images.length).map((t) => ({
            index: t.index,
            participant: t.participant,
            packageName: t.packageName,
            barcodeText: t.barcodeText,
          })),
        };
        return {
          content: [...images.flatMap((r) => r.content), ...textResult(note).content],
        };
      }

      const written = [];
      for (const t of withBarcodes) {
        const name = `accesso-${order.orderNumber ?? 'order'}-${String(t.index).padStart(2, '0')}.png`;
        written.push({
          index: t.index,
          participant: t.participant,
          packageName: t.packageName,
          path: await io.write(name, t.barcodePng!),
        });
      }
      return textResult({ outputDir: io.outputDir, saved: written });
    }),
  );

  server.registerTool(
    'accesso_get_wallet_passes',
    {
      description:
        'Google Wallet save links for the tickets on an accesso order. Open one on a phone to add that ticket to Google Wallet. Not every merchant enables passes.',
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: { url: urlArg, indexes: indexesArg },
    },
    (async ({ url, indexes }) => {
      const target = client.resolveTicketUrl(url);
      const order = await client.getOrder(target);
      const { selected, missing } = selectTickets(order.tickets, indexes);
      if (missing.length > 0) {
        throw new McpToolError(`Order ${order.orderNumber} has no ticket at index ${missing.join(', ')}.`);
      }

      const eligible = selected.filter((t) => t.googleWalletUrl !== null);
      if (eligible.length === 0) {
        throw new McpToolError('No Wallet passes available for the selected tickets.', {
          hint:
            order.warnings.length > 0
              ? order.warnings.join('; ')
              : 'The merchant may not have enabled Google Wallet.',
        });
      }

      const passes = [];
      for (const t of eligible) {
        passes.push({
          index: t.index,
          participant: t.participant,
          packageName: t.packageName,
          saveUrl: await client.getWalletSaveUrl(t.googleWalletUrl!),
        });
      }
      return textResult({
        order: order.orderNumber,
        note: 'These links contain the order token — treat them as private.',
        passes,
      });
    }),
  );

  server.registerTool(
    'accesso_resolve_link',
    {
      description:
        'Turn an order-confirmation email\'s click-tracking link into the direct accesso ticket URL it wraps. Use when a link is not already an accessoticketing.com address.',
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: {
        url: z.string().url().describe('The tracking link from the email.'),
      },
    },
    (async ({ url }) => {
      const { url: resolved, hops } = await client.resolveLink(url);
      return textResult({
        url: resolved,
        hops,
        note: 'This URL is a credential — it grants the order\'s tickets to anyone holding it.',
      });
    }),
  );

  server.registerTool(
    'accesso_healthcheck',
    {
      description:
        'Check that this server can reach accesso and whether a default ticket link is configured.',
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: { url: urlArg },
    },
    (async ({ url }) => {
      if (!client.hasDefaultUrl && url === undefined) {
        return textResult({
          ok: false,
          defaultTicketUrl: false,
          filesPersist: io.persistsFiles,
          hint: 'Set ACCESSO_TICKET_URL, or pass `url`, to verify end to end.',
        });
      }
      const target = client.resolveTicketUrl(url);
      const order = await client.getOrder(target);
      return textResult({
        ok: true,
        defaultTicketUrl: client.hasDefaultUrl,
        filesPersist: io.persistsFiles,
        reachedUrl: redactUrl(target),
        orderNumber: order.orderNumber,
        ticketCount: order.ticketCount,
      });
    }),
  );
}
