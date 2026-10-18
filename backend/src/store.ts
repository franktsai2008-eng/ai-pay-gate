import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FeedEvent, State } from "./types.js";
import { buildSeed } from "./seed.js";

const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "data");
const SNAPSHOT = join(DATA_DIR, "state.json");

export let state: State = load();
let dirty = false;

function load(): State {
  try {
    if (existsSync(SNAPSHOT)) return JSON.parse(readFileSync(SNAPSHOT, "utf8")) as State;
  } catch (err) {
    console.error("snapshot unreadable, reseeding", err);
  }
  return buildSeed(Date.now());
}

export function resetState(): void {
  state = buildSeed(Date.now());
  markDirty();
}

export function markDirty(): void {
  dirty = true;
}

export function flush(): void {
  if (!dirty) return;
  dirty = false;
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${SNAPSHOT}.tmp`;
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, SNAPSHOT);
}

/** Demo clock: admin timewarp moves it forward. */
export function now(): number {
  return Date.now() + state.clockOffsetMs;
}

export function nextId(prefix: string): string {
  state.seq += 1;
  return `${prefix}_${String(state.seq).padStart(4, "0")}`;
}

export function pushEvent(ownerId: string, type: string, data: Record<string, unknown>): void {
  state.eventSeq += 1;
  const ev: FeedEvent = { id: state.eventSeq, ownerId, type, at: now(), data };
  state.events.push(ev);
  if (state.events.length > 2000) state.events.splice(0, state.events.length - 2000);
  markDirty();
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function randomToken(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

export function usd(micro: number): string {
  const sign = micro < 0 ? "-" : "";
  return `${sign}$${(Math.abs(micro) / 1_000_000).toFixed(2)}`;
}

export function shortAddr(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
