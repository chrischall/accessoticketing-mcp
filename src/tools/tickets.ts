import { z } from 'zod';
import { isCompact, viewArg } from '../view.js';
import type { McpServer } from '@modelcontextprotocol/server';
import { McpToolError, imageResult, minifiedResult } from '@chrischall/mcp-utils';
import type { AccessoClient } from '../client.js';
import { redactUrl } from '../client.js';
import { blobStoreFromEnv, deliverFile, type BlobStore } from '@chrischall/mcp-utils/export';
import type { FileIO } from '../io.js';
import { presentOrder, presentTicket, selectTickets } from '../present.js';
import type { AccessoTicket as Ticket } from '../types.js';
import { BARCODE_ALIASES, ORDER_ALIASES, WALLET_ALIASES, familyMeta } from './hints.js';

export interface ToolDeps {
  client: AccessoClient;
  io: FileIO;
  /**
   * Cap on cumulative inline image bytes, so a large order cannot flood the
   * caller's context. Configurable because the useful ceiling differs between a
   * local stdio host and a remote connector.
   */
  maxInlineBytes?: number;
  /**
   * Where download links come from on a hosted deployment. Omitted: read from
   * the environment (`MCP_BLOB_BASE_URL` + `MCP_BLOB_SIGNING_KEY`) on each
   * call, so a malformed value fails the save tool rather than server start-up.
   * `null`: no blob store.
   */
  store?: BlobStore | null;
}

/** First key segment of barcode links in the blob store. */
const BARCODE_KEY_PREFIX = 'barcodes';

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
  const blobStore = (): BlobStore | undefined =>
    deps.store === undefined ? blobStoreFromEnv() : (deps.store ?? undefined);

  server.registerTool(
    'accesso_get_order',
    {
      description:
        'Read an accesso ticket link: the order number and every admission on it — product, participant, date, start time, barcode text, and the merchant instructions. Covers any accesso-powered venue (theme parks, camps, festivals). Needs no login; the emailed link is the credential.',
      _meta: familyMeta('lookup', ORDER_ALIASES),
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: z.object({
        url: urlArg,
        view: viewArg(),
        include_terms: z
          .boolean()
          .optional()
          .describe('Include each ticket\'s terms and conditions (long, and identical per venue).'),
      }),
    },
    (async ({ url, view, include_terms }) => {
      const target = client.resolveTicketUrl(url);
      const order = await client.getOrder(target, { includeTerms: include_terms === true });
      return minifiedResult(presentOrder(order, isCompact(view)));
    }),
  );

  server.registerTool(
    'accesso_get_ticket',
    {
      description:
        'One admission from an accesso order in full detail, including the merchant instructions and (on request) the terms. Identify it by its `index` from accesso_get_order.',
      _meta: familyMeta('lookup'),
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: z.object({
        index: z.number().int().nonnegative().describe('Ticket index, from accesso_get_order.'),
        url: urlArg,
        include_terms: z.boolean().optional().describe('Include the terms and conditions.'),
      }),
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
      return minifiedResult(presentTicket(ticket));
    }),
  );

  server.registerTool(
    'accesso_save_barcodes',
    {
      description:
        'Save the scannable barcode images from an accesso order. Run locally, writes PNGs and returns their paths. Run remotely (hosted), returns the images inline by default, with a download link for any past the size cap; set inline to false for one expiring download link per barcode instead. Set inline to true to receive the images directly in any deployment.',
      // A write, but not a change to anything the person owns: `other`.
      _meta: familyMeta('other', BARCODE_ALIASES),
      // Not read-only: it creates files (on disk, or in the blob store behind a
      // link). Never destructive (it never overwrites — a taken name gets a
      // fresh one, a link a fresh key), and not idempotent (a repeat call
      // writes another copy).
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        url: urlArg,
        indexes: indexesArg,
        inline: z
          .boolean()
          .optional()
          .describe(
            'true: return the images in the response. false: save them — files on a local install, expiring download links when hosted. Omitted: save locally, inline when hosted.',
          ),
      }),
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

      const store = blobStore();
      const fileName = (t: Ticket): string =>
        `accesso-${order.orderNumber ?? 'order'}-${String(t.index).padStart(2, '0')}.png`;
      // One signed, expiring GET link per barcode. Per-file rather than one
      // zip (openExportSink): a barcode is shown at the gate one admission at
      // a time, usually from a phone, where a link opens straight to the image
      // and a zip has to be unpacked first. An order is a handful of small
      // PNGs, so the extra PUTs cost nothing worth trading that for.
      const linkOf = async (t: Ticket) => {
        const delivered = await deliverFile({
          bytes: t.barcodePng!,
          fileName: fileName(t),
          mimeType: 'image/png',
          store: store!,
          prefer: 'link',
          keyPrefix: BARCODE_KEY_PREFIX,
        });
        return {
          index: t.index,
          participant: t.participant,
          packageName: t.packageName,
          barcodeText: t.barcodeText,
          url: delivered.url!,
          expiresAt: delivered.expiresAt!,
        };
      };
      const LINK_NOTE =
        'Each url opens one barcode image and expires at expiresAt. Anyone holding a link can use the barcode until then — share it only with the ticket holder.';

      // "Save" means a file the caller can keep: asked for with inline:false,
      // and the default wherever written paths are real. Hosted, that file is
      // a download link — never the runner's disk, which nobody can open.
      const save = inline === false || (inline === undefined && io.persistsFiles);
      if (save && store) {
        const saved = [];
        for (const t of withBarcodes) saved.push(await linkOf(t));
        return minifiedResult({ order: order.orderNumber, note: LINK_NOTE, saved });
      }

      if (save && io.persistsFiles) {
        const written = [];
        for (const t of withBarcodes) {
          written.push({
            index: t.index,
            participant: t.participant,
            packageName: t.packageName,
            path: await io.write(fileName(t), t.barcodePng!),
          });
        }
        return minifiedResult({ outputDir: io.outputDir, saved: written });
      }

      // Inline: asked for, the default where a written path would be a lie,
      // and the only route left when there is neither a disk nor a blob store.
      const images = [];
      // Tracked in the same loop as `images`: a skipped large barcode can be
      // followed by smaller ones that fit, so the included tickets are not a
      // prefix of the selection, and labelling by position would mismatch.
      const included = [];
      const overflow: Ticket[] = [];
      let bytes = 0;
      for (const t of withBarcodes) {
        const png = t.barcodePng!;
        if (bytes + png.length > maxInlineBytes) {
          overflow.push(t);
          continue;
        }
        bytes += png.length;
        images.push(imageResult(png.toString('base64'), 'image/png'));
        included.push(t);
      }
      // Past the cap, a blob store turns a dropped barcode into a link.
      const linked = [];
      if (store) for (const t of overflow) linked.push(await linkOf(t));
      const dropped = store ? [] : overflow.map((t) => t.index);
      if (images.length === 0 && linked.length === 0) {
        throw new McpToolError(
          `None of the ${withBarcodes.length} barcode image(s) fit the ${maxInlineBytes}-byte inline limit, and this server has no other way to hand them over (no blob store for a download link, no download directory).`,
          {
            kind: 'too_large',
            hint: 'Ask for fewer tickets with `indexes`, or open the ticket link itself in a browser.',
          },
        );
      }
      const note = {
        order: order.orderNumber,
        returned: images.length,
        ...(dropped.length > 0 ? { omittedForSize: dropped.length, omittedIndexes: dropped } : {}),
        ...(save
          ? { note: 'There is no download link or download directory here, so the barcodes are returned inline instead.' }
          : {}),
        // Same order as the images above: tickets[i] describes image i.
        tickets: included.map((t) => ({
          index: t.index,
          participant: t.participant,
          packageName: t.packageName,
          barcodeText: t.barcodeText,
        })),
        ...(linked.length > 0 ? { linkNote: LINK_NOTE, linked } : {}),
      };
      return {
        content: [...images.flatMap((r) => r.content), ...minifiedResult(note).content],
      };
    }),
  );

  server.registerTool(
    'accesso_get_wallet_passes',
    {
      description:
        'Google Wallet save links for the tickets on an accesso order. Open one on a phone to add that ticket to Google Wallet. Not every merchant enables passes.',
      _meta: familyMeta('lookup', WALLET_ALIASES),
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: z.object({ url: urlArg, indexes: indexesArg }),
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
      return minifiedResult({
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
      _meta: familyMeta('lookup'),
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: z.object({
        url: z.string().url().describe('The tracking link from the email.'),
      }),
    },
    (async ({ url }) => {
      const { url: resolved, hops } = await client.resolveLink(url);
      return minifiedResult({
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
      inputSchema: z.object({ url: urlArg }),
    },
    (async ({ url }) => {
      if (!client.hasDefaultUrl && url === undefined) {
        return minifiedResult({
          ok: false,
          defaultTicketUrl: false,
          filesPersist: io.persistsFiles,
          hint: 'Set ACCESSO_TICKET_URL, or pass `url`, to verify end to end.',
        });
      }
      const target = client.resolveTicketUrl(url);
      const order = await client.getOrder(target);
      return minifiedResult({
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
