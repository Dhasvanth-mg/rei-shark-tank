"use client";
import { useEffect, useRef, useState } from "react";
import { rpc } from "@/lib/supabase";
import { money } from "@/lib/format";

interface Spin { spin: number; color: "red" | "black" | "green"; pick: string; win: boolean; wager: number; payout: number }

const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = (n: number) => (n === 0 ? "green" : REDS.has(n) ? "red" : "black");
const BG = { red: "bg-red-600", black: "bg-neutral-900 ring-1 ring-white/30", green: "bg-emerald-600" } as const;

/** Put it all on red or black. The spin is decided on the server; the animation just reveals it. */
export function GambleModal({ code, token, cash, onClose, onSettled }: { code: string; token: string; cash: number; onClose: () => void; onSettled: () => void }) {
  const [stage, setStage] = useState<"pick" | "spin" | "result">("pick");
  const [pick, setPick] = useState<"red" | "black" | null>(null);
  const [shown, setShown] = useState(0);
  const [res, setRes] = useState<Spin | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const go = async (color: "red" | "black") => {
    setPick(color); setErr(null);
    try {
      const r = await rpc<Spin>("gamble_spin", { p_code: code, p_token: token, p_color: color });
      setStage("spin");
      // Slot-machine style reveal: fast random numbers that slow down and land on the real result.
      let delay = 50, step = 0;
      const run = () => {
        step++;
        if (step >= 26) {
          setShown(r.spin); setRes(r); setStage("result"); onSettled();
          if (r.win) void import("canvas-confetti").then(({ default: c }) => c({ particleCount: 160, spread: 90, origin: { y: 0.5 }, colors: ["#dc2626", "#ffffff", "#1f3f77"] }));
          return;
        }
        setShown(Math.floor(Math.random() * 37));
        delay *= 1.12;
        timers.current.push(setTimeout(run, delay));
      };
      run();
    } catch (e) { setErr((e as Error).message); setPick(null); }
  };

  const c = stage === "result" && res ? res.color : colorOf(shown);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 sm:items-center">
      <div className="w-full max-w-md rounded-t-3xl bg-navy-ink p-6 text-white sm:rounded-3xl anim-pop" role="dialog" aria-label="Roulette">
        {stage === "pick" && (
          <>
            <div className="text-5xl">🎰</div>
            <h2 className="font-display mt-2 text-3xl font-black">All on one color</h2>
            <p className="mt-2 text-white/70">
              Bet <b className="text-white">all {money(cash)}</b> of your cash. Hit your color and it doubles. Miss, and it is gone.
            </p>
            <p className="mt-1 text-xs text-white/50">European wheel: 18 red, 18 black, one green zero (house wins). One spin per round. Properties are not touched.</p>
            {err && <p className="mt-3 rounded-lg bg-red-600 px-3 py-2 text-sm font-bold">{err}</p>}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button onClick={() => void go("red")} disabled={cash < 1000} className="rounded-2xl bg-red-600 py-6 text-2xl font-black shadow-lg active:scale-95 disabled:opacity-50">🔴 RED</button>
              <button onClick={() => void go("black")} disabled={cash < 1000} className="rounded-2xl bg-neutral-900 py-6 text-2xl font-black shadow-lg ring-1 ring-white/30 active:scale-95 disabled:opacity-50">⚫ BLACK</button>
            </div>
            <button className="btn btn-ghost mt-3 w-full !border-white/30 !text-white" onClick={onClose}>Walk away</button>
          </>
        )}

        {stage !== "pick" && (
          <div className="text-center">
            <div className="label !text-white/60">You bet {money(res?.wager ?? cash)} on {pick}</div>
            <div className={`mx-auto mt-4 flex h-40 w-40 items-center justify-center rounded-full border-8 border-amber-300/80 text-7xl font-black num transition-colors ${BG[c]}`}>
              {shown}
            </div>
            {stage === "result" && res && (
              <div className="mt-5 anim-pop">
                <h3 className="font-display text-3xl font-black">
                  {res.win ? `${res.color.toUpperCase()}! You doubled up` : res.color === "green" ? "Green zero. The house wins" : `${res.color.toUpperCase()}. Wiped out`}
                </h3>
                <div className={`num mt-1 text-4xl font-black ${res.win ? "text-emerald-300" : "text-red-300"}`}>{money(res.payout - res.wager, { sign: true })}</div>
                <p className="text-sm text-white/60">Cash is now {money(res.payout)}</p>
                <button className="btn btn-light mt-5 w-full" onClick={onClose}>Back to the market</button>
              </div>
            )}
            {stage === "spin" && <p className="mt-5 animate-pulse text-white/70">No more bets…</p>}
          </div>
        )}
      </div>
    </div>
  );
}
