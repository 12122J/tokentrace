#!/usr/bin/env node
import { startMcpServer } from '../src/mcp-server.mjs';

startMcpServer().catch((err) => {
  process.stderr.write(`[tokentrace-mcp] Fatal: ${err.message}\n`);
  process.exit(1);
});
