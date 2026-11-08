"use client";
import { useEffect, useRef, useState } from "react";
import { rpc } from "@/lib/supabase";
import { money } from "@/lib/format";

type Kind = "color" | "number" | "dice";
interface Play {
  game: Kind; pick: string; spin: number | null; roll: number | null; color: "red" | "black" | "green" | null;
  win: boolean; wager: number; gross: number; tax: number; net: number; left: number;
}

const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = (n: number) => (n === 0 ? "green" : REDS.has(n) ? "red" : "black");
const BG = { red: "bg-red-600", black: "bg-neutral-900 ring-1 ring-white/30", green: "bg-emerald-600" } as const;
const DICE = [
  { pick: "2x", label: "2×", odds: "49%", note: "roll 52+" },
  { pick: "3x", label: "3×", odds: "33%", note: "roll 68+" },
  { pick: "10x", label: "10×", odds: "10%", note: "roll 91+" },
];
const STAKES = [{ f: 0.25, label: "¼ cash" }, { f: 0.5, label: "½ cash" }, { f: 1, label: "ALL IN" }];

/** Casino: bets are resolved on the server; the animation only reveals the result. */
export function GambleModal({ code, token, cash, taxRate, limit, onClose, onSettled }: {
  code: string; token: string; cash: number; taxRate: number; limit: number; onClose: () => void; onSettled: () => void;
}) {
  const [kind, setKind] = useState<Kind>("color");
  const [stake, setStake] = useState(1);
  const [color, setColor] = useState<"red" | "black">("red");
  const [num, setNum] = useState(7);
  const [dice, setDice] = useState("2x");
  const [stage, setStage] = useState<"pick" | "spin" | "result">("pick");
  const [shown, setShown] = useState(0);
  const [res, setRes] = useState<Play | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [liveCash, setLiveCash] = useState(cash);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const wager = Math.floor(liveCash * stake);
  const pick = kind === "color" ? color : kind === "number" ? String(num) : dice;

  const place = async () => {
    setErr(null);
    try {
      const r = await rpc<Play>("gamble_play", { p_code: code, p_token: token, p_game: kind, p_pick: pick, p_fraction: stake });
      setStage("spin");
      const max = kind === "dice" ? 100 : 36;
      const final = (kind === "dice" ? r.roll : r.spin) ?? 0;
      let delay = 50, step = 0;
      const run = () => {
        step++;
        if (step >= 26) {
          setShown(final); setRes(r); setStage("result"); setLiveCash((c) => c - r.wager + r.gross - r.tax); onSettled();
          if (r.win) void import("canvas-confetti").then(({ default: c }) => c({ particleCount: 160, spread: 90, origin: { y: 0.5 } }));
          return;
        }
        setShown(kind === "dice" ? 1 + Math.floor(Math.random() * max) : Math.floor(Math.random() * (max + 1)));
        delay *= 1.12;
        timers.current.push(setTimeout(run, delay));
      };
      run();
    } catch (e) { setErr((e as Error).message); }
  };

  const wheelColor = kind === "dice" ? null : stage === "result" && res?.color ? res.color : colorOf(shown);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 sm:items-center">
      <div className="max-h-[94dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-navy-ink p-6 text-white sm:rounded-3xl anim-pop" role="dialog" aria-label="Casino">
        {stage === "pick" && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-3xl font-black">🎰 The Casino</h2>
              <button onClick={onClose} className="text-3xl text-white/60" aria-label="Close">×</button>
            </div>
            <p className="mt-1 text-sm text-white/60">Cash {money(liveCash)} · winnings taxed <b className="text-red-300">{Math.round(taxRate * 100)}%</b> · up to {limit} bets per round</p>

            <div className="mt-4 grid grid-cols-3 gap-2" role="tablist">
              {([["color", "Red / Black"], ["number", "Lucky #"], ["dice", "Dice"]] as const).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={`rounded-xl py-2.5 text-sm font-extrabold ${kind === k ? "bg-white text-navy-deep" : "bg-white/10"}`}>{l}</button>
              ))}
            </div>

            <div className="mt-4">
              {kind === "color" && (
                <>
                  <p className="mb-2 text-sm text-white/70">Pays <b>2×</b>. Green zero loses to everyone.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => setColor("red")} aria-pressed={color === "red"} className={`rounded-2xl bg-red-600 py-5 text-xl font-black ${color === "red" ? "ring-4 ring-white" : "opacity-60"}`}>🔴 RED</button>
                    <button onClick={() => setColor("black")} aria-pressed={color === "black"} className={`rounded-2xl bg-neutral-900 py-5 text-xl font-black ring-1 ring-white/30 ${color === "black" ? "!ring-4 !ring-white" : "opacity-60"}`}>⚫ BLACK</button>
                  </div>
                </>
              )}
              {kind === "number" && (
                <>
                  <p className="mb-2 text-sm text-white/70">Pick one number from 0 to 36. Pays <b>36×</b> if it lands (1 in 37).</p>
                  <div className="grid grid-cols-7 gap-1.5">
                    {Array.from({ length: 37 }, (_, n) => (
                      <button key={n} onClick={() => setNum(n)} aria-pressed={num === n} className={`aspect-square rounded-lg text-sm font-black ${BG[colorOf(n)]} ${num === n ? "ring-4 ring-white" : "opacity-70"}`}>{n}</button>
                    ))}
                  </div>
                </>
              )}
              {kind === "dice" && (
                <>
                  <p className="mb-2 text-sm text-white/70">Roll 1–100. Higher payouts need a higher roll.</p>
                  <div className="grid grid-cols-3 gap-2">
                    {DICE.map((d) => (
                      <button key={d.pick} onClick={() => setDice(d.pick)} aria-pressed={dice === d.pick} className={`rounded-2xl py-3 text-center ${dice === d.pick ? "bg-white text-navy-deep" : "bg-white/10"}`}>
                        <div className="text-2xl font-black">{d.label}</div>
                        <div className="text-xs font-bold opacity-70">{d.odds} · {d.note}</div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="mt-4">
              <div className="label !text-white/60">Stake</div>
              <div className="mt-1 grid grid-cols-3 gap-2">
                {STAKES.map((s) => (
                  <button key={s.f} onClick={() => setStake(s.f)} aria-pressed={stake === s.f} className={`rounded-xl py-2 text-sm font-extrabold ${stake === s.f ? "bg-amber-300 text-ink" : "bg-white/10"}`}>
                    {s.label}<span className="block text-[0.7rem] font-bold opacity-70">{money(Math.floor(liveCash * s.f), { compact: true })}</span>
                  </button>
                ))}
              </div>
            </div>

            {err && <p className="mt-3 rounded-lg bg-red-600 px-3 py-2 text-sm font-bold">{err}</p>}
            <button className="btn btn-light mt-5 w-full !py-4 text-lg" disabled={wager < 1000} onClick={() => void place()}>
              Bet {money(wager)}
            </button>
          </>
        )}

        {stage !== "pick" && (
          <div className="text-center">
            <div className="label !text-white/60">{money(res?.wager ?? wager)} on {kind === "dice" ? dice : pick}</div>
            <div className={`mx-auto mt-4 flex h-40 w-40 items-center justify-center border-8 border-amber-300/80 text-7xl font-black num transition-colors ${kind === "dice" ? "rounded-3xl bg-navy" : `rounded-full ${wheelColor ? BG[wheelColor] : ""}`}`}>
              {shown}
            </div>
            {stage === "spin" && <p className="mt-5 animate-pulse text-white/70">No more bets…</p>}
            {stage === "result" && res && (
              <div className="mt-5 anim-pop">
                <h3 className="font-display text-3xl font-black">{res.win ? "You win!" : "House wins"}</h3>
                <div className={`num mt-1 text-4xl font-black ${res.net >= 0 ? "text-emerald-300" : "text-red-300"}`}>{money(res.net, { sign: true })}</div>
                {res.win && <p className="text-sm text-white/60">Won {money(res.gross - res.wager)} · taxed {money(res.tax)}</p>}
                <p className="mt-1 text-sm text-white/60">Cash is now {money(liveCash)}</p>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <button className="btn btn-ghost !border-white/30 !text-white" onClick={onClose}>Cash out</button>
                  <button className="btn btn-light" disabled={res.left <= 0} onClick={() => { setStage("pick"); setRes(null); }}>{res.left > 0 ? `Bet again (${res.left} left)` : "No bets left"}</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
