import express from "express";
import { createUIMessageStream, pipeUIMessageStreamToResponse } from "ai";
import { api } from "../../../convex/_generated/api.js";
import { convex } from "../../convex-client.js";
import { handleUserMessage } from "../../interaction-agent.js";
import type { CommunicationProvider, NormalizedInbound } from "../types.js";

// ---------------------------------------------------------------------------
// Vercel AI SDK — Chat provider
// ---------------------------------------------------------------------------

/**
 * Vercel Chat provider.
 *
 * Inbound:  POST /api/chat  { id, messages }  (Vercel AI SDK `useChat` format)
 * Outbound: UI Message Stream (SSE, `X-Vercel-AI-UI-Message-Stream: v1`)
 *           Compatible with the `useChat` hook from the `ai` package.
 *
 * Replies are streamed inline in the HTTP response using the Vercel AI SDK
 * Data Stream Protocol — no separate outbound HTTP call is needed.
 *
 * The same boop agent (memory, spawn_agent, MCP tools, automations, drafts)
 * serves every connected channel.  The `onThinking` callback pipes incremental
 * Claude text blocks directly into the SSE stream so the user sees characters
 * appear in real time.
 */
export const vercelChatProvider: CommunicationProvider = {
  platform: "vercel-chat",
  conversationPrefix: "web",

  createRouter(
    // Web chat replies are streamed inline in the HTTP response, so the
    // standard async `onMessage` / `processInboundMessage` flow is not used
    // here.  The handler calls `handleUserMessage` directly and pipes the
    // result back to the same HTTP connection via the Vercel AI SDK stream.
    _onMessage: (msg: NormalizedInbound) => Promise<void>,
  ): express.Router {
    const router = express.Router();

    /**
     * POST /api/chat
     *
     * Request body (Vercel AI SDK `useChat` format):
     * ```json
     * { "id": "<conversationId>", "messages": [{ "role": "user", "content": "Hello" }, ...] }
     * ```
     *
     * Response: UI Message Stream (SSE, content-type: text/event-stream).
     * Compatible with the `useChat` hook from `ai/react`.
     */
    router.post("/", async (req, res) => {
      const { messages, id } = req.body ?? {};

      if (!id || typeof id !== "string") {
        res.status(400).json({ error: "id (string) is required" });
        return;
      }
      if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: "messages (non-empty array) is required" });
        return;
      }

      // Extract the latest user message.
      const lastUserMsg = [...messages]
        .reverse()
        .find((m: { role: string }) => m.role === "user");

      if (!lastUserMsg) {
        res.status(400).json({ error: "no user message found in messages array" });
        return;
      }

      // Normalise content — useChat sends a string or an array of content parts.
      const rawContent = lastUserMsg.content as
        | string
        | Array<{ type: string; text?: string }>;
      const content = Array.isArray(rawContent)
        ? rawContent
            .filter((p) => p.type === "text")
            .map((p) => p.text ?? "")
            .join("")
        : String(rawContent ?? "");

      if (!content.trim()) {
        res.status(400).json({ error: "empty user message content" });
        return;
      }

      const conversationId = `web:${id}`;
      const msgId = `msg-${Date.now().toString(36)}`;

      // Create a UI message stream, delegating the actual AI work to the
      // existing handleUserMessage agent (memory, tools, spawn_agent, etc.).
      const stream = createUIMessageStream({
        execute: ({ writer }) => {
          // Signal the start of a streamed text part.
          writer.write({ type: "text-start", id: msgId });

          // Return a Promise so the stream stays open until the agent finishes.
          return handleUserMessage({
            conversationId,
            content,
            onThinking: (chunk: string) => {
              writer.write({ type: "text-delta", id: msgId, delta: chunk });
            },
          }).then(async (reply) => {
            // Signal the end of the text part.
            writer.write({ type: "text-end", id: msgId });

            // Persist the assistant reply (same as agent-bridge does for SMS).
            if (reply) {
              await convex.mutation(api.messages.send, {
                conversationId,
                role: "assistant",
                content: reply,
              });
            }
          });
        },
        onError: (err) => {
          console.error("[vercel-chat] stream error", err);
          return err instanceof Error ? err.message : String(err);
        },
      });

      // Pipe the UI message stream to the Express response using the
      // Vercel AI SDK SSE wire format.
      pipeUIMessageStreamToResponse({
        response: res,
        stream,
      });
    });

    return router;
  },

  /**
   * For web chat, replies are always sent inline via the streaming HTTP
   * response — there is no separate outbound call.
   *
   * This is a safe no-op so that `sendReply()` from the registry doesn't
   * log a warning when called from `send_ack` inside the interaction agent.
   */
  send: async (_to: string, _content: string): Promise<void> => {},
};
