import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiFor } from '../services/internalApi.js';
import { TOOLS, runTool, capJson } from '../agent/tools.js';

export const MCP_VERSION = '1.0.0';

/** One MCP server per request (stateless: works on Render today and on Lambda later). */
export function buildMcpServer({ userId, readOnly = false }) {
  const server = new McpServer({ name: 'tendrils', version: MCP_VERSION }, {
    instructions: 'Tendrils Operations platform: tickets, tasks, clients and teams. You act as the signed-in user with exactly their permissions. Prefer list_* tools first, then get_ticket. Ticket keys look like SOF-123456.',
  });
  const api = apiFor(userId);
  for (const t of TOOLS) {
    if (readOnly && t.write) continue;
    server.registerTool(t.name, {
      title: t.title, description: t.description, inputSchema: t.shape,
      annotations: { readOnlyHint: !t.write, destructiveHint: false, idempotentHint: !t.write, openWorldHint: false },
    }, async (args) => {
      const r = await runTool(api, t.name, args);
      return { content: [{ type: 'text', text: r.ok ? capJson(r.data) : r.error }], ...(r.ok ? {} : { isError: true }) };
    });
  }
  const prompt = (name, title, description, text) => server.registerPrompt(name, { title, description, argsSchema: {} }, async () => ({ messages: [{ role: 'user', content: { type: 'text', text } }] }));
  prompt('daily_standup', 'Daily stand-up', 'Summarise my work for stand-up', 'Using Tendrils tools: list my open tasks and tickets assigned to me, then write a short stand-up (done / doing / blocked). Flag anything overdue.');
  prompt('triage_inbox', 'Triage new tickets', 'Find tickets that need routing or a first response', 'Using Tendrils tools: list OPEN tickets without an assignee, group them by team, and suggest priority and next action for each. Do not change anything until I confirm.');
  prompt('client_status', 'Client status report', 'Status digest of tickets for a client', 'Using Tendrils tools: list tickets and tasks waiting for my review, and tickets that changed recently. Write a plain-language status update I can forward.');
  return server;
}
export { z };
