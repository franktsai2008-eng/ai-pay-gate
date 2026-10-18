import type { SigilClient } from "./client";
import { createHttpClient } from "./http";
import { mockClient } from "./mock";

const url = import.meta.env.VITE_API_URL as string | undefined;

/** One place decides mock vs real. Nothing else in the UI cares. */
export const api: SigilClient = url
  ? createHttpClient(url, () => localStorage.getItem("sigil.token"))
  : mockClient;

export const isMock = !url;
export * from "./types";
