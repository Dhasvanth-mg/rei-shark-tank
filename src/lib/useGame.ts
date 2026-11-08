"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { rpc, supabase } from "./supabase";
import type { GameState } from "./types";

interface Opts { token?: string | null; admin?: string | null; pollMs?: number }

/**
 * Live game state. One RPC returns everything the caller may see; Supabase Realtime
 * only tells us when to refetch, with a poll as a safety net.
 */
export function useGame(code: string, { token = null, admin = null, pollMs = 4000 }: Opts = {}) {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const inflight = useRef(false);
  const queued = useRef(false);
  const gameId = state?.game.id;

  const refresh = useCallback(async () => {
    if (inflight.current) { queued.current = true; return; }
    inflight.current = true;
    try {
      do {
        queued.current = false;
        const t0 = Date.now();
        try {
          const s = await rpc<GameState>("game_state", { p_code: code, p_token: token, p_admin: admin });
          if (s.error) { setError(s.error); setState(null); }
          else {
            setError(null);
            setState(s);
            setOffset(s.server_now + (Date.now() - t0) / 2 - Date.now());
          }
        } catch (e) {
          setError((e as Error).message);
        }
      } while (queued.current);
    } finally {
      inflight.current = false;
    }
  }, [code, token, admin]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const id = setInterval(() => void refresh(), pollMs);
    const vis = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", vis); };
  }, [refresh, pollMs]);

  useEffect(() => {
    if (!gameId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ping = () => { clearTimeout(timer); timer = setTimeout(() => void refresh(), 250); };
    const ch = supabase
      .channel(`game-${gameId}-${Math.random().toString(36).slice(2, 7)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "games", filter: `id=eq.${gameId}` }, ping)
      .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `game_id=eq.${gameId}` }, ping)
      .on("postgres_changes", { event: "*", schema: "public", table: "game_properties", filter: `game_id=eq.${gameId}` }, ping)
      .subscribe();
    return () => { clearTimeout(timer); void supabase.removeChannel(ch); };
  }, [gameId, refresh]);

  // Any open client settles an expired round, so the game never stalls if the host tab sleeps.
  const phase = state?.game.phase;
  const endsAt = state?.game.ends_at;
  const paused = state?.game.paused;
  useEffect(() => {
    if (phase !== "round" || paused || !endsAt) return;
    const ms = new Date(endsAt).getTime() - (Date.now() + offset) + 1500 + Math.random() * 2500;
    const id = setTimeout(() => { rpc("tick", { p_code: code }).then(() => refresh()).catch(() => {}); }, Math.max(500, ms));
    return () => clearTimeout(id);
  }, [phase, endsAt, paused, offset, code, refresh]);

  return { state, error, refresh, offset };
}

/** Seconds remaining, corrected for device clock skew. null = untimed. */
export function useCountdown(g: GameState["game"] | undefined, offset: number): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  if (!g) return null;
  if (g.paused) return g.paused_remaining;
  if (!g.ends_at) return null;
  return Math.max(0, Math.ceil((new Date(g.ends_at).getTime() - (now + offset)) / 1000));
}
