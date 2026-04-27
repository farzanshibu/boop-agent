import type express from "express";

/**
 * A message received from any inbound channel, normalised to a platform-
 * agnostic shape so the rest of the system never has to inspect raw payloads.
 */
export interface NormalizedInbound {
  /** Short platform identifier, e.g. `'sendblue'`, `'whatsapp'`, `'slack'`. */
  platform: string;
  /**
   * Stable conversation ID used throughout the system.
   * Format: `${conversationPrefix}:${address}`, e.g. `sms:+12125551234`.
   */
  conversationId: string;
  /** Raw sender address — phone number, user ID, channel ID, etc. */
  from: string;
  /** Plain-text content of the message. */
  content: string;
  /** Platform-specific message ID used for deduplication. */
  messageId?: string;
  /** Original, unmodified platform payload for debugging or advanced use. */
  raw: unknown;
}

/**
 * Contract every platform adapter must satisfy.
 *
 * Adding a new channel (WhatsApp, Slack, Telegram, …) means implementing
 * this interface and calling `registerProvider` at server start — nothing
 * else in the codebase needs to change.
 */
export interface CommunicationProvider {
  /** Short unique platform identifier, e.g. `'sendblue'`. */
  readonly platform: string;
  /**
   * Prefix used in `conversationId`.
   * E.g. `'sms'` produces IDs like `sms:+12125551234`.
   */
  readonly conversationPrefix: string;

  /**
   * Build an Express router that accepts inbound platform webhooks and
   * forwards normalised messages to `onMessage`.
   */
  createRouter(onMessage: (msg: NormalizedInbound) => Promise<void>): express.Router;

  /** Send a text reply to an address on this platform. */
  send(to: string, content: string): Promise<void>;

  /** Send a typing indicator (best-effort, non-fatal). */
  sendTypingIndicator?(to: string): Promise<void>;

  /**
   * Start a repeating typing-indicator loop.
   * Returns a stop function that must be called when the reply is ready.
   */
  startTypingLoop?(to: string): () => void;
}
