/**
 * @deprecated
 * The Sendblue adapter has moved to `server/communication/providers/sendblue.ts`.
 * This file is kept only for backward compatibility and re-exports from the
 * new communication layer.
 *
 * Use `sendReply` from `server/communication` for all outbound sends so that
 * the call site is not tied to a specific platform.
 */

export { sendblueProvider as default } from "./communication/index.js";
export {
  sendblueProvider,
  registerProvider,
  getProviderForConversation,
  sendReply,
  processInboundMessage,
} from "./communication/index.js";
