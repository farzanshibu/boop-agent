import type { CommunicationProvider, NormalizedInbound } from "./types.js";

const providers = new Map<string, CommunicationProvider>();

/** Register a platform adapter so it can be looked up by conversation prefix. */
export function registerProvider(provider: CommunicationProvider): void {
  providers.set(provider.conversationPrefix, provider);
  console.log(`[communication] registered provider: ${provider.platform} (prefix: ${provider.conversationPrefix}:)`);
}

/**
 * Find the provider responsible for a given `conversationId`.
 * Returns `undefined` when no matching provider has been registered.
 */
export function getProviderForConversation(
  conversationId: string,
): CommunicationProvider | undefined {
  const colonIndex = conversationId.indexOf(":");
  if (colonIndex === -1) return undefined;
  const prefix = conversationId.slice(0, colonIndex);
  return providers.get(prefix);
}

/**
 * Send a reply on whichever platform owns this `conversationId`.
 * Logs a warning and no-ops when no provider is registered for the prefix.
 */
export async function sendReply(conversationId: string, content: string): Promise<void> {
  const provider = getProviderForConversation(conversationId);
  if (!provider) {
    console.warn(`[communication] no provider registered for conversationId: ${conversationId}`);
    return;
  }
  const to = conversationId.slice(provider.conversationPrefix.length + 1);
  await provider.send(to, content);
}

export type { NormalizedInbound };
