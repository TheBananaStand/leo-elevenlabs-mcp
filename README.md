# leo-elevenlabs-mcp

ElevenLabs text-to-speech as a **Leo provider package**, over MCP.

Leo's speech pipeline doesn't do this itself — it resolves a provider and asks that. This
server is one, reachable as a package the hub installs at runtime rather than
one it has to be rebuilt for.

## What it answers

The `tts` role in `leo_mcp::providers`:

```
synthesize({ text, voice? }) -> { audio_base64 }
voices({})                   -> { voices: [{ id, name, detail? }] }
current_voice({})            -> { voice, setting }
```

`voice` on `synthesize` speaks in that voice without changing what is
configured — an audition, or one person's own choice. `current_voice` answers
which voice is configured now and which settings key holds it
(`elevenlabs_voice_id`), so the hub can mark it in a picker and write a new
choice to the key this server reads, without knowing the key by name.

Results come back as JSON in a text content block, which is the convention the
hub's bridge reads.

## Configuration

Handed to this process by Leo as environment variables **under their settings
keys, verbatim and lower-case** — only the keys the descriptor declares in
`entitlements.settings_read` and the owner consented to, never the whole
settings table.

| env | where it comes from |
|---|---|
| `elevenlabs_api_key` | Settings → Packages → ElevenLabs |
| `elevenlabs_voice_id` | the voice to speak with |
| `elevenlabs_model` | optional; defaults to `eleven_multilingual_v2` |

With nothing configured the tool returns `isError` naming the setting. That is
deliberate: an empty answer would reach Leo as a real result.

## Running it

```bash
npm install
node index.js   # speaks MCP over stdio
npm test        # checks the response mapping, no network needed
```

## Why plain JavaScript

This ships as a git tarball pinned to a commit SHA, and npm does not reliably
run build steps for a tarball URL. A TypeScript source tree would install and
then fail to start on somebody else's machine, where it is hardest to diagnose.

The registry entry must name a **full 40-character commit SHA**. A tag reads as
equally specific and is not — it can be moved after the entry is reviewed.

## License

MIT
