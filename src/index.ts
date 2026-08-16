#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { client } from './client.js';
import { defaultFileIO } from './io.js';
import { VERSION } from './version.js';
import { registerTicketTools } from './tools/tickets.js';

// The client is a module-level singleton built in ./client.js, not here, so the
// deferred-config-error pattern holds: the server boots and answers the host's
// install-time tools/list probe with no configuration at all, and a missing
// ticket link only surfaces on the first tool call that needs one.
await runMcp({
  name: 'accessoticketing-mcp',
  version: VERSION,
  deps: { client, io: defaultFileIO() },
  banner:
    '[accessoticketing-mcp] This project was developed and is maintained by AI. Use at your own discretion.',
  tools: [registerTicketTools],
});
