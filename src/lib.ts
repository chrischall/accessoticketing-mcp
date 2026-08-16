/**
 * Library surface: the parsing and normalisation this server is built on,
 * importable without running an MCP server.
 */
export { parseTicketPage, isExpiredOrderPage } from './parse.js';
export { AccessoClient, isAccessoUrl, redactUrl } from './client.js';
export { presentOrder, presentTicket, compactTicket, selectTickets } from './present.js';
export { DiskFileIO, NoFileIO, defaultFileIO, type FileIO } from './io.js';
export type { AccessoOrder, AccessoTicket, ParseOptions } from './types.js';
export { VERSION } from './version.js';
