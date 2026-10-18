import { serve } from "@hono/node-server";
import { root as app } from "./app.js";
import { flush } from "./store.js";
import { tick } from "./engine.js";

const port = Number(process.env.PORT ?? 8787);

if (!process.env.ADMIN_KEY) console.warn("ADMIN_KEY not set; using the demo default. Set it before deploying.");
if (!process.env.ANTHROPIC_API_KEY) console.warn("ANTHROPIC_API_KEY not set; delivery checks use code checks only.");

setInterval(() => {
  try {
    tick();
  } catch (err) {
    console.error("tick failed", err);
  }
}, 1000);
setInterval(flush, 2000);
process.on("SIGTERM", () => {
  flush();
  process.exit(0);
});
process.on("SIGINT", () => {
  flush();
  process.exit(0);
});

serve({ fetch: app.fetch, port }, (info) => console.log(`Sigil backend on http://localhost:${info.port}/api/v1 (phone app contract on /v1)`));
