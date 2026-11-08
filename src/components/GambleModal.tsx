"use client";
import { useEffect, useRef, useState } from "react";
import { rpc } from "@/lib/supabase";
import { money } from "@/lib/format";

type Kind = "color" | "number" | "dice" | "blackjack";
interface Play {
  game: Kind; pick: string; spin: number | null; roll: number | null; color: "red" | "black" | "green" | null;
  win: boolean; push: boolean; wager: number; gross: number; tax: number; net: number; left: number;
}
interface Bj {
  wager: number; player: number[]; player_total: number; soft: boolean; dealer: (number | null)[]; dealer_total: number | null;
  done: boolean; gross: number | null; tax: number | null; net: number | null; can_double: boolean; outcome: string | null; left?: number;
}

const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = (n: number) => (n === 0 ? "green" : REDS.has(n) ? "red" : "black");
const BG = { red: "bg-red-600", black: "bg-neutral-900 ring-1 ring-white/30", green: "bg-emerald-600" } as const;
const DICE = [
  { pick: "2x", label: "2×", odds: "52%", note: "roll 49+" },
  { pick: "3x", label: "3×", odds: "35%", note: "roll 66+" },
  { pick: "10x", label: "10×", odds: "11%", note: "roll 90+" },
];
const STAKES = [{ f: 0.25, label: "¼ cash" }, { f: 0.5, label: "½ cash" }, { f: 1, label: "ALL IN" }];
const OUTCOME: Record<string, string> = {
  blackjack: "Blackjack! Pays 3:2", win: "You beat the dealer", dealer_bust: "Dealer busts", charlie: "Five-card Charlie!",
  push: "Push. Stake returned", lose: "Dealer wins", bust: "Bust",
};
const SUITS = ["♠", "♥", "♦", "♣"];
const label = (r: number) => (r === 1 ? "A" : r === 11 ? "J" : r === 12 ? "Q" : r === 13 ? "K" : String(r));

function Card({ rank, hidden, i }: { rank: number | null; hidden?: boolean; i: number }) {
  if (hidden || rank === null) return <div className="flex h-20 w-14 items-center justify-center rounded-lg bg-navy text-2xl ring-2 ring-white/40">?</div>;
  const s = SUITS[(rank + i * 3) % 4];
  const red = s === "♥" || s === "♦";
  return (
    <div className={`flex h-20 w-14 flex-col items-center justify-center rounded-lg bg-white text-xl font-black anim-pop ${red ? "text-red-600" : "text-ink"}`}>
      <span>{label(rank)}</span><span className="text-lg leading-none">{s}</span>
    </div>
  );
}

/** Casino: every bet is resolved on the server; the screen only reveals the result. */
export function GambleModal({ code, token, cash, taxRate, limit, onClose, onSettled }: {
  code: string; token: string; cash: number; taxRate: number; limit: number; onClose: () => void; onSettled: () => void;
}) {
  const [kind, setKind] = useState<Kind>("color");
  const [stake, setStake] = useState(1);
  const [color, setColor] = useState<"red" | "black">("red");
  const [num, setNum] = useState(7);
  const [dice, setDice] = useState("2x");
  const [stage, setStage] = useState<"pick" | "spin" | "result" | "bj">("pick");
  const [shown, setShown] = useState(0);
  const [res, setRes] = useState<Play | null>(null);
  const [bj, setBj] = useState<Bj | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Resume a hand left open (closed tab, lost connection).
  useEffect(() => {
    let live = true;
    rpc<Bj | null>("bj_state", { p_code: code, p_token: token }).then((s) => {
      if (live && s) { setBj(s); setKind("blackjack"); setStage("bj"); }
    }).catch(() => {});
    return () => { live = false; };
  }, [code, token]);

  const wager = Math.floor(cash * stake);
  const pick = kind === "color" ? color : kind === "number" ? String(num) : dice;
  const win = (r: { win?: boolean; net?: number | null }) => !!r.win || (r.net ?? 0) > 0;
  const confetti = () => void import("canvas-confetti").then(({ default: c }) => c({ particleCount: 160, spread: 90, origin: { y: 0.5 } }));

  const place = async () => {
    setErr(null);
    if (kind === "blackjack") {
      setBusy(true);
      try {
        const v = await rpc<Bj>("bj_start", { p_code: code, p_token: token, p_fraction: stake });
        setBj(v); setStage("bj"); onSettled();
        if (v.done && (v.net ?? 0) > 0) confetti();
      } catch (e) { setErr((e as Error).message); }
      setBusy(false);
      return;
    }
    try {
      const r = await rpc<Play>("gamble_play", { p_code: code, p_token: token, p_game: kind, p_pick: pick, p_fraction: stake });
      setStage("spin");
      const max = kind === "dice" ? 100 : 36;
      const final = (kind === "dice" ? r.roll : r.spin) ?? 0;
      let delay = 50, step = 0;
      const run = () => {
        step++;
        if (step >= 26) {
          setShown(final); setRes(r); setStage("result"); onSettled();
          if (win(r)) confetti();
          return;
        }
        setShown(kind === "dice" ? 1 + Math.floor(Math.random() * max) : Math.floor(Math.random() * (max + 1)));
        delay *= 1.12;
        timers.current.push(setTimeout(run, delay));
      };
      run();
    } catch (e) { setErr((e as Error).message); }
  };

  const act = async (action: "hit" | "stand" | "double") => {
    setBusy(true); setErr(null);
    try {
      const v = await rpc<Bj>("bj_action", { p_code: code, p_token: token, p_action: action });
      setBj(v); onSettled();
      if (v.done && (v.net ?? 0) > 0) confetti();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
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
            <p className="mt-1 text-sm text-white/60">Cash {money(cash)} · winnings taxed <b className="text-red-300">{Math.round(taxRate * 100)}%</b> · up to {limit} bets per round</p>

            <div className="mt-4 grid grid-cols-4 gap-1.5" role="tablist">
              {([["color", "Red/Black"], ["number", "Lucky #"], ["dice", "Dice"], ["blackjack", "Blackjack"]] as const).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={`rounded-xl py-2.5 text-[0.78rem] font-extrabold ${kind === k ? "bg-white text-navy-deep" : "bg-white/10"}`}>{l}</button>
              ))}
            </div>

            <div className="mt-4">
              {kind === "color" && (
                <>
                  <p className="mb-2 text-sm text-white/70">Pays <b>2×</b>. If the green zero hits, you just get your stake back.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => setColor("red")} aria-pressed={color === "red"} className={`rounded-2xl bg-red-600 py-5 text-xl font-black ${color === "red" ? "ring-4 ring-white" : "opacity-60"}`}>🔴 RED</button>
                    <button onClick={() => setColor("black")} aria-pressed={color === "black"} className={`rounded-2xl bg-neutral-900 py-5 text-xl font-black ring-1 ring-white/30 ${color === "black" ? "!ring-4 !ring-white" : "opacity-60"}`}>⚫ BLACK</button>
                  </div>
                </>
              )}
              {kind === "number" && (
                <>
                  <p className="mb-2 text-sm text-white/70">Pick one number from 0 to 36. Pays <b>40×</b> if it lands.</p>
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
              {kind === "blackjack" && (
                <ul className="space-y-1 rounded-xl bg-white/10 p-3 text-sm text-white/80">
                  <li>Beat the dealer without going over 21.</li>
                  <li>Blackjack pays <b>3:2</b>. Dealer stands on every 17.</li>
                  <li>Double down on your first two cards.</li>
                  <li>Five cards without busting <b>wins automatically</b>.</li>
                </ul>
              )}
            </div>

            <div className="mt-4">
              <div className="label !text-white/60">Stake</div>
              <div className="mt-1 grid grid-cols-3 gap-2">
                {STAKES.map((s) => (
                  <button key={s.f} onClick={() => setStake(s.f)} aria-pressed={stake === s.f} className={`rounded-xl py-2 text-sm font-extrabold ${stake === s.f ? "bg-amber-300 text-ink" : "bg-white/10"}`}>
                    {s.label}<span className="block text-[0.7rem] font-bold opacity-70">{money(Math.floor(cash * s.f), { compact: true })}</span>
                  </button>
                ))}
              </div>
            </div>

            {err && <p className="mt-3 rounded-lg bg-red-600 px-3 py-2 text-sm font-bold">{err}</p>}
            <button className="btn btn-light mt-5 w-full !py-4 text-lg" disabled={wager < 1000 || busy} onClick={() => void place()}>
              {kind === "blackjack" ? `Deal · ${money(wager)}` : `Bet ${money(wager)}`}
            </button>
          </>
        )}

        {stage === "bj" && bj && (
          <div className="text-center">
            <div className="flex items-center justify-between">
              <span className="label !text-white/60">Blackjack</span>
              <span className="num font-black">Bet {money(bj.wager)}</span>
            </div>
            <div className="mt-4">
              <div className="label !text-white/50">Dealer {bj.dealer_total !== null && `· ${bj.dealer_total}`}</div>
              <div className="mt-1 flex flex-wrap justify-center gap-2">
                {bj.dealer.map((r, i) => <Card key={i} rank={r} i={i} />)}
              </div>
            </div>
            <div className="mt-4">
              <div className="label !text-white/50">You · {bj.player_total}{bj.soft && !bj.done ? " (soft)" : ""}</div>
              <div className="mt-1 flex flex-wrap justify-center gap-2">
                {bj.player.map((r, i) => <Card key={i} rank={r} i={i + 5} />)}
              </div>
            </div>
            {err && <p className="mt-3 rounded-lg bg-red-600 px-3 py-2 text-sm font-bold">{err}</p>}
            {!bj.done ? (
              <div className="mt-5 grid grid-cols-3 gap-2">
                <button className="btn btn-light" disabled={busy} onClick={() => void act("hit")}>Hit</button>
                <button className="btn btn-light" disabled={busy} onClick={() => void act("stand")}>Stand</button>
                <button className="btn btn-ghost !border-white/40 !text-white" disabled={busy || !bj.can_double || cash < bj.wager} onClick={() => void act("double")}>Double</button>
              </div>
            ) : (
              <div className="mt-5 anim-pop">
                <h3 className="font-display text-2xl font-black">{OUTCOME[bj.outcome ?? ""] ?? "Hand over"}</h3>
                <div className={`num text-4xl font-black ${(bj.net ?? 0) >= 0 ? "text-emerald-300" : "text-red-300"}`}>{money(bj.net ?? 0, { sign: true })}</div>
                {(bj.tax ?? 0) > 0 && <p className="text-sm text-white/60">After {money(bj.tax ?? 0)} tax on winnings</p>}
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <button className="btn btn-ghost !border-white/30 !text-white" onClick={onClose}>Cash out</button>
                  <button className="btn btn-light" onClick={() => { setStage("pick"); setBj(null); setErr(null); }}>Another hand</button>
                </div>
              </div>
            )}
          </div>
        )}

        {(stage === "spin" || stage === "result") && (
          <div className="text-center">
            <div className="label !text-white/60">{money(res?.wager ?? wager)} on {kind === "dice" ? dice : pick}</div>
            <div className={`mx-auto mt-4 flex h-40 w-40 items-center justify-center border-8 border-amber-300/80 text-7xl font-black num transition-colors ${kind === "dice" ? "rounded-3xl bg-navy" : `rounded-full ${wheelColor ? BG[wheelColor] : ""}`}`}>
              {shown}
            </div>
            {stage === "spin" && <p className="mt-5 animate-pulse text-white/70">No more bets…</p>}
            {stage === "result" && res && (
              <div className="mt-5 anim-pop">
                <h3 className="font-display text-3xl font-black">{res.win ? "You win!" : res.push ? "Zero. Push" : "House wins"}</h3>
                <div className={`num mt-1 text-4xl font-black ${res.net >= 0 ? "text-emerald-300" : "text-red-300"}`}>{money(res.net, { sign: true })}</div>
                {res.push && <p className="text-sm text-white/60">Green zero: your stake comes back</p>}
                {res.win && <p className="text-sm text-white/60">Won {money(res.gross - res.wager)} · taxed {money(res.tax)}</p>}
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
