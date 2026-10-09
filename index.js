#!/usr/bin/env node
//
// Leo text-to-speech provider, over MCP — ElevenLabs.
//
// Leo's speech pipeline doesn't synthesize anything itself: it resolves a
// TtsProvider and asks that. This server is one, reachable as a package the hub
// installs at runtime rather than one it is rebuilt for.
//
// The contract it answers is `tts` in leo_mcp::providers:
//
//   synthesize({ text, voice? }) -> { audio_base64 }
//   voices({})                   -> { voices: [{ id, name, detail? }] }
//   current_voice({})            -> { voice, setting }
//
// `current_voice` is what lets the hub offer a choice: it says which voice is
// configured right now (so a picker can mark it) and which settings key holds
// that choice (so choosing another writes to the key this server reads). Both
// are this package's own facts; the hub does not know its key names.
//
// Audio is the one payload that cannot travel as text, so it is base64 in the
// JSON body. The bytes are MPEG — which is what the compiled package returned
// too, since that is what this endpoint produces.
//
// Plain JavaScript on purpose — this ships as a commit-pinned git tarball, and
// npm does not reliably run build steps for a tarball URL.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const BASE_URL = "https://api.elevenlabs.io/v1";

// Handed over by Leo under their settings keys, verbatim and lower-case.
const KEY = "elevenlabs_api_key";
const VOICE = "elevenlabs_voice_id";
const MODEL = "elevenlabs_model";
const DEFAULT_MODEL = "eleven_multilingual_v2";

/** Map the /voices payload onto the role's shape. */
export function toVoices(payload) {
  const rows = Array.isArray(payload?.voices) ? payload.voices : [];
  return rows
    .filter((v) => typeof v?.voice_id === "string" && v.voice_id !== "")
    .map((v) => {
      const voice = { id: v.voice_id, name: v.name || v.voice_id };
      // One clause of context, or nothing. Padding it with the provider's own
      // name would just repeat the row above it in the picker.
      const accent = v?.labels?.accent;
      if (typeof accent === "string" && accent !== "") voice.detail = accent;
      return voice;
    });
}

function credentials() {
  const apiKey = process.env[KEY] ?? "";
  if (!apiKey) {
    throw new Error(
      `No ${KEY} configured. Add it in Settings → Packages → ElevenLabs.`,
    );
  }
  return apiKey;
}

async function synthesize({ text, voice }) {
  const apiKey = credentials();
  if (typeof text !== "string" || text.trim() === "") {
    throw new Error("synthesize requires non-empty `text`.");
  }
  // `voice` lets the hub audition one without changing what is configured —
  // the same split `synthesize_as` draws on the compiled side.
  const voiceId = voice || process.env[VOICE] || "";
  if (!voiceId) {
    throw new Error(
      `No ${VOICE} configured. Add a voice id in Settings → Packages → ElevenLabs.`,
    );
  }

  const response = await fetch(
    `${BASE_URL}/text-to-speech/${encodeURIComponent(voiceId)}/stream`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        Accept: "audio/mpeg",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: process.env[MODEL] || DEFAULT_MODEL,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `ElevenLabs TTS returned ${response.status}: ${detail.slice(0, 200)}`,
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  // Zero bytes reaches the speaker as silence, which is indistinguishable from
  // a TTS stack that is simply broken. Say so instead.
  if (bytes.length === 0) throw new Error("ElevenLabs returned zero bytes of audio.");
  return { audio_base64: bytes.toString("base64") };
}

/** The configured voice and the key that holds it. Pure; drives the test. */
export function currentVoice(env) {
  const voice = env?.[VOICE] ?? "";
  // `voice` is "" rather than absent when nothing is configured: the hub reads
  // an empty id as "none chosen", which is the honest state — a server that
  // omitted the field would read as not supporting the question at all.
  return { voice: typeof voice === "string" ? voice : "", setting: VOICE };
}

async function voices() {
  const apiKey = credentials();
  const response = await fetch(`${BASE_URL}/voices`, {
    headers: { "xi-api-key": apiKey },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `ElevenLabs /voices returned ${response.status}: ${detail.slice(0, 200)}`,
    );
  }
  return { voices: toVoices(await response.json()) };
}

const server = new Server(
  { name: "leo-elevenlabs-mcp", version: "1.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "synthesize",
      description: "Speak text with the configured ElevenLabs voice.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "What to say." },
          voice: {
            type: "string",
            description:
              "Optional voice id to use instead of the configured one, for auditioning.",
          },
        },
        required: ["text"],
      },
    },
    {
      name: "voices",
      description: "Every ElevenLabs voice this account can speak with.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "current_voice",
      description:
        "The voice id configured right now, and the settings key that holds it.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    if (name === "synthesize") {
      return { content: [{ type: "text", text: JSON.stringify(await synthesize(args ?? {})) }] };
    }
    if (name === "voices") {
      return { content: [{ type: "text", text: JSON.stringify(await voices()) }] };
    }
    if (name === "current_voice") {
      return { content: [{ type: "text", text: JSON.stringify(currentVoice(process.env)) }] };
    }
    return { isError: true, content: [{ type: "text", text: `Unknown tool: ${name}` }] };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: String(error?.message ?? error) }],
    };
  }
});

if (process.env.LEO_MCP_NO_SERVE !== "1") {
  await server.connect(new StdioServerTransport());
}
