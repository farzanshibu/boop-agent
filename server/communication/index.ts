/**
 * Communication layer — provider-agnostic messaging abstraction.
 *
 * Registered providers:
 *   - `sendblueProvider`   (prefix: sms:)   SMS / iMessage via Sendblue webhook
 *   - `vercelChatProvider` (prefix: web:)   Web chat via Vercel AI SDK (`useChat`)
 *
 * Adding a new channel (WhatsApp, Slack, Telegram, Discord, …):
 *   1. Implement `CommunicationProvider` (see `./types.ts`).
 *   2. Call `registerProvider(yourProvider)` in `server/index.ts`.
 *   3. Mount `yourProvider.createRouter(processInboundMessage)` on an Express path.
 *
 * No other files need to change.
 */

export type { NormalizedInbound, CommunicationProvider } from "./types.js";
export { registerProvider, getProviderForConversation, sendReply } from "./registry.js";
export { processInboundMessage } from "./agent-bridge.js";
export { sendblueProvider } from "./providers/sendblue.js";
export { vercelChatProvider } from "./providers/vercel-chat.js";
