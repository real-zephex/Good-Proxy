import type { Env } from "../types";

/** A console.log that only fires when DEBUG is enabled. */
export function makeDebug(env: Env | undefined) {
  const on = env?.DEBUG === "true" || env?.DEBUG === "1";
  return (...args: unknown[]) => {
    if (on) console.log("[goodproxy]", ...args);
  };
}

export type Debug = ReturnType<typeof makeDebug>;
