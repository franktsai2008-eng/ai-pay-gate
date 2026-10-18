# Pitch assets (2026-10-18, built 04:20–05:00 EDT)

## Deck
- Source: `pitch/deck.html` (16:9 stage, keyboard: ← → / space, F fullscreen, click right half = next). Fonts are local in `pitch/fonts/`, so it works offline.
- Private artifact (same content): https://claude.ai/artifact/8BRL3YL9vG9QjehEEonGhr
- Images in `pitch/img/`: real Sigil screenshots from the frontend in mock mode (`npm run dev` in the teammate's repo, captured with Playwright at 1440×900 @2x and 390×844 @3x) plus three brand stills from `brand/generated/`.
- Facts on the slides come from README.md and DEVPOST-draft.md. Slide 7 says **30 backend tests** because README says 30; the committed main (6ec9a27) had 23 and DEVPOST-draft still says 23. Confirm with a green `npm test` after the merge and make all three agree.
- Slide 9 still has the line "Teammates: names to confirm". Replace with real names and roles.
- Independent review (clean Opus) ran once; its P0/P1 items are fixed. Not done from its list: a sub-line explaining "Sealed" on every slide, and curly quotes everywhere.

## Demo video
- Built by a background agent in `/private/tmp/claude-501/-Users-franktsai/3021d348-e4f4-428f-ab80-3a4a6d12cea8/scratchpad/video/` and copied to `pitch/sigil-demo.mp4` when done. Its NOTES.md lists duration, voice, music.
- Voice: local Kokoro through HyperFrames, free. Setup that works on this Mac: `uv venv ~/.venvs/kokoro --python 3.12 && VIRTUAL_ENV=~/.venvs/kokoro uv pip install kokoro-onnx soundfile`, then `HYPERFRAMES_PYTHON=$HOME/.venvs/kokoro/bin/python npx hyperframes tts "<text>" --voice af_heart -o out.wav`.
- Music: Kevin MacLeod tracks (CC BY 4.0) downloaded from incompetech.com into the scratchpad `bgm/`. The Devpost description must carry: "Music: '<track>' Kevin MacLeod (incompetech.com), licensed under Creative Commons: By Attribution 4.0".
- Higgsfield: account is on the free plan with 0 credits, so Katana (needs a subscription plus the Higgsfield connector in Claude) is unavailable. Pay-per-use API (`hf-api`) works; Seedance 2.0 720p is about US$1.5 per 5-second clip. Not used unless Frank says so.

## Devpost checklist (rules verified on hackharvard2026.devpost.com)
- Submit by 8:00 AM EDT. Public GitHub repo created 10/16–18 (ai-pay-gate is public). Tick every track and sponsor prize you want: at least Overall + Digital Trust; Chalk or Nessie only if actually used.
- Video is optional, max 3 minutes, hosted on YouTube or similar.
- Judging 9:00–12:00 at the table: 3-minute presentation + questions. Closing ceremony 3:00–4:00 PM.

## Security note (resolved 05:15)
- The event stream no longer takes the owner token in the query string. The client POSTs to `/v1/events/ticket` with its bearer, gets a 60-second single-use ticket, and opens `GET /v1/events?ticket=`. `?token=` is rejected.
