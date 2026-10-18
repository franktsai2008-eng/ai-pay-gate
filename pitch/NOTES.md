# Pitch assets (2026-10-18, built 04:20–05:40 EDT) — HANDOFF for the pitch line

Read this first if you pick up the deck or the video. The backend/merge line has its own HANDOFF.md at the repo root.

## Done
- **Deck**: `pitch/deck.html`, 10 slides, 16:9 stage, keyboard ← → / space, F fullscreen, click right half = next. Fonts local (`pitch/fonts/`), works offline. Same content as the private artifact https://claude.ai/artifact/8BRL3YL9vG9QjehEEonGhr (publish from this conversation or pass the URL as `url`).
  Order: 1 title · 2 problem ($47,000 / $3) · 3 what Sigil does + "made for anyone with an AI" · 4 green · 5 yellow · 6 red (illustration card, labelled) · 7 six checks table (red/yellow per check) · 8 credit formula + hard-to-game + risk · 9 what's next · 10 team + close.
  Images `pitch/img/`: real Sigil screenshots (frontend mock mode, Playwright, Chrome channel) + three brand stills from `brand/generated/`.
  Independent clean-Opus review ran once on the 9-slide version; P0/P1 fixed (fonts path bug, test count, expiry number, MCP wording, labels, sizes). Slides 7–8 were added after that review and only self-checked by screenshot.
- **Video**: `pitch/sigil-demo.mp4`, 2:12, 1920×1080, Kokoro voice af_heart, BGM "Floating Cities" (CC BY). Build project in the scratchpad `video/sigil-demo/` (HyperFrames 0.8.170); the agent's NOTES.md there has the scene map and mix. Known weak spots: ~1.5 s near-empty plate at 0:33–0:36, "23 tests" on screen (deck says 30), short black tail after the fade.
- **Docs**: `docs/SCORING.md` (six-check reason-code table, credit factors, worked example +0.017, tiers, risk rules, demo numbers). README "Credit score" section got one link line to it (README is also being edited by the merge session; if the line is gone after their save, re-add it).

## Frank's decisions / preferences this run
- "I want the good kind" (quality over speed); use our real UI; Higgsfield Katana wanted but unavailable (free plan, 0 credits).
- Technical highlight = credit calculation + six checks; business highlight = built for the general public. Both now on the deck and in SCORING.md.
- Hard gate kept: no money spent (no Higgsfield, no ElevenLabs).

## Waiting on Frank
1. Teammate names and roles for slide 10 (now "Teammates: names to confirm").
2. Test count: deck says 30 (README), video says 23 (committed main + DEVPOST-draft). Pick one after `npm test` is green post-merge; then fix deck line on slide 8, DEVPOST-draft line 67, and re-render the video (change the "23 tests" text in `video/sigil-demo/index.html`, re-render: `cd sigil-demo && npx --yes hyperframes@0.8.170 render -o ../renders/video.mp4`, copy to pitch/).
3. Higgsfield b-roll: 2A = three 5-s Seedance clips via hf-api (~US$1.5 each) · 2C = ship as is (recommended).

## Next first action (new session)
- If Frank answered 1–3: apply names to slide 10, fix the test number everywhere, re-render the video if its number changes, republish the artifact, and copy the final mp4 to `pitch/`. Then he uploads the mp4 to YouTube himself with the music line below in the description and pastes the link into Devpost.
- Devpost description must carry: `Music: "Floating Cities" Kevin MacLeod (incompetech.com), licensed under Creative Commons: By Attribution 4.0`

## Environment notes
- Kokoro TTS: `HYPERFRAMES_PYTHON=$HOME/.venvs/kokoro/bin/python npx hyperframes tts "<text>" --voice af_heart -o out.wav`.
- Playwright screenshots: playwright-core under `~/.npm-global/lib/node_modules/@playwright/cli/node_modules/playwright-core`, launch with `{ channel: "chrome" }`.
- Side effect: `npx hyperframes skills update` removed 11 HyperFrames skills it says are unpublished (animejs, gsap, lottie, three, tailwind, waapi, typegpu, css-animations, hyperframes-media, contribute-catalog, website-to-hyperframes). Re-install if needed later.
- Security note from the automated review (owner token in the `/events` query string) was fixed by the merge session at 05:15 (single-use ticket).

## Devpost checklist (rules verified on hackharvard2026.devpost.com)
- Submit by 8:00 AM EDT. Public GitHub repo created 10/16–18 (ai-pay-gate is public). Tick every track and sponsor prize: at least Overall + Digital Trust; Chalk or Nessie only if actually used.
- Video optional, max 3 minutes, on YouTube or similar.
- Judging 9:00–12:00 at the table: 3-minute presentation + questions. Closing ceremony 3:00–4:00 PM.
