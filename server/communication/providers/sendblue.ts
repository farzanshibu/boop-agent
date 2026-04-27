import express from "express";
import { api } from "../../../convex/_generated/api.js";
import { convex } from "../../convex-client.js";
import type { CommunicationProvider, NormalizedInbound } from "../types.js";

const API_BASE = "https://api.sendblue.co/api";
const MAX_CHUNK = 2900;

// ---------------------------------------------------------------------------
// Outbound helpers
// ---------------------------------------------------------------------------

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?|```/g, ""))
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1 ($2)")
    .trim();
}

function chunk(text: string, size = MAX_CHUNK): string[] {
  if (text.length <= size) return [text];
  const out: string[] = [];
  let buf = "";
  for (const line of text.split(/\n/)) {
    if ((buf + "\n" + line).length > size) {
      if (buf) out.push(buf);
      buf = line;
    } else {
      buf = buf ? buf + "\n" + line : line;
    }
  }
  if (buf) out.push(buf);
  return out;
}

function buildHeaders(): Record<string, string> | null {
  const apiKey = process.env.SENDBLUE_API_KEY;
  const apiSecret = process.env.SENDBLUE_API_SECRET;
  if (!apiKey || !apiSecret) return null;
  return {
    "Content-Type": "application/json",
    "sb-api-key-id": apiKey,
    "sb-api-secret-key": apiSecret,
  };
}

function normalizeE164(n: string | undefined): string | undefined {
  if (!n) return undefined;
  const trimmed = n.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("+")) return trimmed;
  if (/^\d{10}$/.test(trimmed)) return `+1${trimmed}`;
  if (/^\d{11,15}$/.test(trimmed)) return `+${trimmed}`;
  return trimmed;
}

async function sendImessage(toNumber: string, text: string): Promise<void> {
  const h = buildHeaders();
  if (!h) {
    console.warn("[sendblue] missing credentials — not sending");
    return;
  }
  const from = normalizeE164(process.env.SENDBLUE_FROM_NUMBER);
  if (!from) {
    console.error(
      `[sendblue] SENDBLUE_FROM_NUMBER is not set. Run \`npm run sendblue:sync\` (pulls it from \`sendblue lines\`) or paste your provisioned number into .env.local, then restart \`npm run dev\`.`,
    );
    return;
  }
  const plain = stripMarkdown(text);
  for (const part of chunk(plain)) {
    const res = await fetch(`${API_BASE}/send-message`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ number: toNumber, content: part, from_number: from }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[sendblue] send failed ${res.status}: ${body}`);
      if (body.includes("missing required parameter") && body.includes("from_number")) {
        console.error(
          `[sendblue] → Set SENDBLUE_FROM_NUMBER in .env.local to your Sendblue-provisioned number and restart the server.`,
        );
      } else if (body.includes("Cannot send messages to self")) {
        console.error(
          `[sendblue] → SENDBLUE_FROM_NUMBER is your personal cell. It must be the Sendblue-provisioned number (the one people text TO).`,
        );
      } else if (body.includes("This phone number is not defined")) {
        console.error(
          `[sendblue] → Sendblue doesn't recognize from_number=${from}. Run \`npm run sendblue:sync\` to pull the correct one from \`sendblue lines\`, then restart the server.`,
        );
      }
    } else {
      console.log(`[sendblue] → sent ${part.length} chars to ${toNumber}`);
    }
  }
}

async function sendTypingIndicator(toNumber: string): Promise<void> {
  const h = buildHeaders();
  if (!h) return;
  const from = process.env.SENDBLUE_FROM_NUMBER;
  try {
    await fetch(`${API_BASE}/send-typing-indicator`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ number: toNumber, from_number: from }),
    });
  } catch {
    /* non-fatal */
  }
}

function startTypingLoop(toNumber: string): () => void {
  sendTypingIndicator(toNumber);
  const timer = setInterval(() => sendTypingIndicator(toNumber), 5000);
  return () => clearInterval(timer);
}

// ---------------------------------------------------------------------------
// Sendblue CommunicationProvider
// ---------------------------------------------------------------------------

/**
 * Sendblue adapter.
 *
 * Inbound:  POST /sendblue/webhook → dedup → NormalizedInbound → onMessage
 * Outbound: send() → markdown-stripped, chunked iMessage via Sendblue API
 */
export const sendblueProvider: CommunicationProvider = {
  platform: "sendblue",
  conversationPrefix: "sms",

  createRouter(onMessage: (msg: NormalizedInbound) => Promise<void>): express.Router {
    const router = express.Router();

    router.post("/webhook", async (req, res) => {
      const { content, from_number, is_outbound, message_handle } = req.body ?? {};

      if (is_outbound || !content || !from_number) {
        res.json({ ok: true, skipped: true });
        return;
      }

      if (message_handle) {
        const { claimed } = await convex.mutation(api.sendblueDedup.claim, {
          handle: message_handle,
        });
        if (!claimed) {
          res.json({ ok: true, deduped: true });
          return;
        }
      }

      const normalized: NormalizedInbound = {
        platform: "sendblue",
        conversationId: `sms:${from_number}`,
        from: from_number,
        content,
        messageId: message_handle,
        raw: req.body,
      };

      // Acknowledge receipt immediately; process asynchronously.
      res.json({ ok: true });
      onMessage(normalized).catch((err) =>
        console.error("[sendblue] onMessage error", err),
      );
    });

    return router;
  },

  send: sendImessage,
  sendTypingIndicator,
  startTypingLoop,
};
