"use client";
import { useEffect, useSyncExternalStore } from "react";
import { useParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useGame, useCountdown } from "@/lib/useGame";
import { currentOrigin, noopSubscribe } from "@/lib/storage";
import { money, PHASE_LABEL, typeMeta } from "@/lib/format";
import { Logo } from "@/components/Logo";
import { Timer } from "@/components/Timer";
import { Leaderboard } from "@/components/Leaderboard";
import { EventCard, RoundRecap } from "@/components/EventCard";
import { Avatar } from "@/components/EmojiPicker";
import { PropertyImage } from "@/components/PropertyArt";

export default function ScreenPage() {
  const { code: raw } = useParams<{ code: string }>();
  const code = raw.toUpperCase();
  const { state, error, offset } = useGame(code, { pollMs: 3000 });
  const secs = useCountdown(state?.game, offset);
  const origin = useSyncExternalStore(noopSubscribe, currentOrigin, () => "");

  const finished = state?.game.phase === "finished";
  useEffect(() => {
    if (!finished) return;
    void import("canvas-confetti").then(({ default: confetti }) => {
      const end = Date.now() + 4000;
      const frame = () => {
        confetti({ particleCount: 6, angle: 60, spread: 70, origin: { x: 0 }, colors: ["#1f3f77", "#8e9aa5", "#ffffff"] });
        confetti({ particleCount: 6, angle: 120, spread: 70, origin: { x: 1 }, colors: ["#1f3f77", "#8e9aa5", "#ffffff"] });
        if (Date.now() < end) requestAnimationFrame(frame);
      };
      frame();
    });
  }, [finished]);

  if (error === "not_found") return <main className="flex-1 skyline-bg grid place-items-center text-4xl font-black text-white">Room {code} not found</main>;
  if (!state) return <main className="flex-1 skyline-bg grid place-items-center text-2xl text-white/70">Loading…</main>;

  const g = state.game;
  const joinUrl = `${origin}/play/${code}`;
  const lastLog = state.round_log[state.round_log.length - 1];
  const timed = (g.phase === "building" || g.phase === "round") && secs !== null;
  const winner = state.players[0];

  return (
    <main className="flex-1 skyline-bg text-white">
      <div className="mx-auto flex min-h-dvh max-w-[1700px] flex-col p-6 lg:p-10">
        <header className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            <span className="rounded-2xl bg-white p-2"><Logo className="h-20" /></span>
            <div>
              <h1 className="font-display text-3xl font-black lg:text-5xl">{g.name}</h1>
              <div className="text-lg text-white/60">
                {PHASE_LABEL[g.phase]}{g.round > 0 && g.phase !== "finished" ? ` · Round ${g.round} of ${g.total_rounds}` : ""}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-6">
            {g.phase !== "lobby" && (
              <div className="text-right">
                <div className="label !text-white/50">Room</div>
                <div className="font-display text-4xl font-black tracking-[0.25em]">{code}</div>
              </div>
            )}
            {timed && <Timer seconds={secs} paused={g.paused} big />}
          </div>
        </header>

        <section className="mt-8 flex-1">
          {g.phase === "lobby" && (
            <div className="grid items-center gap-10 lg:grid-cols-[auto_1fr]">
              <div className="rounded-3xl bg-white p-6 text-center text-ink anim-pop">
                {origin && <QRCodeSVG value={joinUrl} size={340} fgColor="#12264a" level="M" />}
                <div className="label mt-4">Scan to join</div>
                <div className="font-display text-7xl font-black tracking-[0.25em] text-navy">{code}</div>
                <div className="mt-1 text-sm text-steel break-all">{origin.replace(/^https?:\/\//, "")}</div>
              </div>
              <div>
                <h2 className="font-display text-5xl font-black">{state.players.length} {state.players.length === 1 ? "investor" : "investors"} ready</h2>
                <p className="mt-2 text-xl text-white/60">Everyone starts with {money(g.starting_cash)}. Waiting for the host to begin…</p>
                <div className="mt-8 flex flex-wrap gap-3">
                  {state.players.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 rounded-full bg-white/10 py-1.5 pl-1.5 pr-4 text-xl font-bold anim-pop">
                      <Avatar emoji={p.emoji} size={44} className="!bg-white" />{p.nickname}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {g.phase === "building" && (
            <div>
              <h2 className="font-display text-4xl font-black">The marketplace is open. Spend your {money(g.starting_cash)}.</h2>
              <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5 xl:grid-cols-6">
                {state.properties.filter((p) => p.enabled).map((p) => {
                  const left = p.supply === null ? null : Math.max(0, p.supply - p.owned);
                  return (
                    <div key={p.property_id} className="overflow-hidden rounded-2xl bg-white text-ink">
                      <PropertyImage src={p.image_url} type={p.type} seed={p.property_id} className="h-28 w-full" />
                      <div className="p-3">
                        <div className="font-display text-lg font-black leading-tight">{p.name}</div>
                        <div className="text-xs text-steel">{typeMeta(p.type).label} · {p.risk} risk</div>
                        <div className="mt-1 flex items-baseline justify-between">
                          <span className="num text-xl font-black">{money(p.current_value, { compact: true })}</span>
                          <span className="num text-sm font-bold text-navy">{p.monthly_rent ? `${money(p.monthly_rent)}/mo` : "no rent"}</span>
                        </div>
                        <div className="mt-1 text-xs font-bold text-steel">{p.owned} owned{left !== null ? ` · ${left} left` : ""}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {g.phase === "round" && state.event && (
            <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr]">
              <EventCard event={state.event} big dark />
              <div>
                <h2 className="font-display mb-3 text-3xl font-black">Standings</h2>
                <Leaderboard players={state.players} results={state.results} startingCash={g.starting_cash} limit={8} big hideScores={g.leaderboard_hidden} />
              </div>
            </div>
          )}

          {g.phase === "round_end" && lastLog && (
            <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
              <div className="text-ink"><RoundRecap log={lastLog} properties={state.properties} big /></div>
              <div>
                <h2 className="font-display mb-3 text-3xl font-black">After round {lastLog.round}</h2>
                <Leaderboard players={state.players} results={state.results} startingCash={g.starting_cash} limit={8} big hideScores={g.leaderboard_hidden} />
              </div>
            </div>
          )}

          {g.phase === "finished" && winner && (
            <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr]">
              <div className="flex flex-col items-center justify-center text-center anim-pop">
                <div className="text-9xl">🏆</div>
                <div className="label !text-white/60 mt-4">Winner</div>
                {g.leaderboard_hidden ? <div className="font-display text-6xl font-black">…</div> : (
                  <>
                    <Avatar emoji={winner.emoji} size={150} className="!bg-white mt-2" />
                    <h2 className="font-display mt-4 text-6xl font-black">{winner.nickname}</h2>
                    <div className="num mt-2 text-5xl font-black">{money(winner.net_worth)}</div>
                  </>
                )}
              </div>
              <div>
                <h2 className="font-display mb-3 text-3xl font-black">Final leaderboard</h2>
                <Leaderboard players={state.players} results={state.results} startingCash={g.starting_cash} limit={10} big hideScores={g.leaderboard_hidden} />
              </div>
            </div>
          )}
        </section>
        <footer className="mt-6 text-center text-xs tracking-[0.3em] text-white/30">RHO EPSILON IOTA · REAL ESTATE INVESTORS · FICTIONAL FIGURES FOR GAMEPLAY</footer>
      </div>
    </main>
  );
}
