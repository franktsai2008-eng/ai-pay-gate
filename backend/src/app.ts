import { Hono } from "hono";
import { app as api } from "./routes.js";
import { sigil } from "./sigil.js";

/**
 * One server, two faces:
 *  /api/v1  the gate's own API (owner app, MCP agent tools, public profiles, admin)
 *  /v1      the Sigil frontend's contract, served by the adapter in sigil.ts
 */
export const root = new Hono();
root.route("/", api);
root.route("/v1", sigil);
root.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: "No such endpoint." } }, 404));
