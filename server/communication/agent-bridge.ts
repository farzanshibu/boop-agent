import { api } from "../../convex/_generated/api.js";
import { convex } from "../convex-client.js";
import { handleUserMessage } from "../interaction-agent.js";
import { broadcast } from "../broadcast.js";
import { getProviderForConversation } from "./registry.js";
import type { NormalizedInbound } from "./types.js";

/**
 * Entry point for all inbound messages from any registered platform.
 *
 * Flow:
 *   platform adapter → NormalizedInbound → processInboundMessage
 *     → handleUserMessage (agent)
 *     → platform adapter send (outbound reply)
 *     → Convex message persistence
 */
export async function processInboundMessage(msg: NormalizedInbound): Promise<void> {
  const turnTag = Math.random().toString(36).slice(2, 8);
  const preview = msg.content.length > 100 ? msg.content.slice(0, 100) + "…" : msg.content;
  console.log(`[turn ${turnTag}] ← ${msg.from} (${msg.platform}): ${JSON.stringify(preview)}`);
  const start = Date.now();

  broadcast("message_in", {
    conversationId: msg.conversationId,
    content: msg.content,
    from: msg.from,
    platform: msg.platform,
    handle: msg.messageId,
  });

  const provider = getProviderForConversation(msg.conversationId);
  const stopTyping = provider?.startTypingLoop
    ? provider.startTypingLoop(msg.from)
    : () => {};

  try {
    const reply = await handleUserMessage({
      conversationId: msg.conversationId,
      content: msg.content,
      turnTag,
      onThinking: (t) => broadcast("thinking", { conversationId: msg.conversationId, t }),
    });

    if (reply) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const replyPreview = reply.length > 100 ? reply.slice(0, 100) + "…" : reply;
      console.log(
        `[turn ${turnTag}] → reply (${elapsed}s, ${reply.length} chars): ${JSON.stringify(replyPreview)}`,
      );
      if (provider) {
        await provider.send(msg.from, reply);
      }
      await convex.mutation(api.messages.send, {
        conversationId: msg.conversationId,
        role: "assistant",
        content: reply,
      });
    } else {
      console.log(`[turn ${turnTag}] → (no reply)`);
    }
  } catch (err) {
    console.error(`[turn ${turnTag}] handler error`, err);
  } finally {
    stopTyping();
  }
}
