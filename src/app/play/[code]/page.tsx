"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { rpc } from "@/lib/supabase";
import { useGame, useCountdown } from "@/lib/useGame";
import { clearPlayerToken, playerToken, subscribe } from "@/lib/storage";
import { money, PHASE_LABEL } from "@/lib/format";
import { useAct, Toast } from "@/lib/useAct";
import { JoinForm } from "@/components/JoinForm";
import { Avatar, EmojiPicker } from "@/components/EmojiPicker";
import { PropertyCard } from "@/components/PropertyCard";
import { Leaderboard } from "@/components/Leaderboard";
import { EventCard, RoundRecap } from "@/components/EventCard";
import { Timer } from "@/components/Timer";
import { GambleModal } from "@/components/GambleModal";
import type { GameState } from "@/lib/types";

type Tab = "market" | "portfolio" | "ranks";

export default function PlayPage() {
  const { code: raw } = useParams<{ code: string }>();
  const code = raw.toUpperCase();
  const token = useSyncExternalStore(subscribe, () => playerToken(code), () => undefined);

  if (token === undefined) return <Splash text="Loading…" />;
  if (!token) return <Gate code={code} />;
  return <Player code={code} token={token} />;
}

function Splash({ text }: { text: string }) {
  return <main className="flex-1 skyline-bg flex items-center justify-center text-white/70">{text}</main>;
}

function Gate({ code }: { code: string }) {
  const { state, error } = useGame(code);
  if (error === "not_found") {
    return (
      <main className="flex-1 skyline-bg flex flex-col items-center justify-center gap-4 p-6 text-center text-white">
        <h1 className="font-display text-3xl font-black">Room {code} not found</h1>
        <p className="text-white/60">Double-check the code with your host.</p>
        <Link href="/" className="btn btn-light">Back</Link>
      </main>
    );
  }
  if (!state) return <Splash text="Finding room…" />;
  return <JoinForm code={code} gameName={state.game.name} onJoined={() => {}} />;
}

function Player({ code, token }: { code: string; token: string }) {
  const { state, error, refresh, offset } = useGame(code, { token });
  const { busy, msg, run, flash } = useAct();
  const [tab, setTab] = useState<Tab>("market");
  const [editing, setEditing] = useState(false);
  const [gambling, setGambling] = useState(false);
  const secs = useCountdown(state?.game, offset);

  if (!state && error) return <Splash text={error} />;
  if (!state) return <Splash text="Loading…" />;
  if (state.kicked || !state.me) {
    return (
      <main className="flex-1 skyline-bg flex flex-col items-center justify-center gap-4 p-6 text-center text-white">
        <div className="text-6xl">👋</div>
        <h1 className="font-display text-3xl font-black">You were removed from this game</h1>
        <p className="text-white/60">The host took you out of the room. You can rejoin with a new name.</p>
        <button className="btn btn-light" onClick={() => clearPlayerToken(code)}>Rejoin</button>
      </main>
    );
  }

  const { game, me, properties, event } = state;
  const myRank = state.players.find((p) => p.id === me.id)?.rank ?? 0;
  const holdings = new Map(me.holdings.map((h) => [h.property_id, h]));
  const propValue = me.net_worth - me.cash + me.debt;
  const open = (game.phase === "building" || game.phase === "round") && !game.trading_locked && !game.paused && (secs === null || secs > 0);
  const lastLog = state.round_log[state.round_log.length - 1];

  const buy = (id: string, name: string) => run(async () => { await rpc("buy_property", { p_code: code, p_token: token, p_property: id }); await refresh(); }, `Bought ${name}`);
  const sell = (id: string, name: string) => run(async () => { await rpc("sell_property", { p_code: code, p_token: token, p_property: id }); await refresh(); }, `Sold ${name}`);

  return (
    <main className="flex-1 pb-28">
      <Toast msg={msg} />
      <header className="skyline-bg sticky top-0 z-20 text-white shadow-lg">
        <div className="mx-auto max-w-2xl px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <button onClick={() => setEditing(true)} className="flex min-w-0 items-center gap-2 text-left" aria-label="Edit profile">
              <Avatar emoji={me.emoji} size={40} className="!bg-white" />
              <div className="min-w-0">
                <div className="truncate font-extrabold leading-tight">{me.nickname}</div>
                <div className="text-xs text-white/50">Room {code} · tap to edit</div>
              </div>
            </button>
            {secs !== null && (game.phase === "building" || game.phase === "round") ? <Timer seconds={secs} paused={game.paused} /> : (
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold">{game.phase === "round_end" ? `Round ${game.round} done` : PHASE_LABEL[game.phase]}</span>
            )}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Stat label="Net worth" value={money(me.net_worth, { compact: true })} sub={`#${myRank} of ${state.players.length}`} strong />
            <Stat label="Cash" value={money(me.cash, { compact: true })} />
            <Stat label="Properties" value={money(propValue, { compact: true })} sub={me.debt ? `${money(me.debt, { compact: true })} debt` : `${me.holdings.length} owned`} />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 px-4 pt-4">
        {game.phase === "lobby" && <Panel icon="⏳" title="Waiting for the host" text="Hang tight. The marketplace opens when the host starts the game." />}
        {game.phase === "building" && (
          <Panel icon="🏗️" title="Build your portfolio" text={`Spend your ${money(game.starting_cash)} on properties. ${secs === 0 ? "Time is up. Waiting for the host to start Round 1." : "No fees during this phase."}`} />
        )}
        {game.phase === "round" && event && <EventCard event={event} />}
        {game.phase === "round" && game.trading_locked && <Panel icon="🔒" title="Trading locked" text="The host paused trading for a moment." />}
        {game.phase === "round_end" && lastLog && (
          <>
            <Panel icon="📊" title={`Round ${lastLog.round} complete`} text={`You ranked #${myRank}. Rent, repairs and interest have been settled. ${game.round < game.total_rounds ? "Next event is coming up." : "Final results are next."}`} />
            <RoundRecap log={lastLog} properties={properties} />
          </>
        )}
        {game.phase === "finished" && <FinalCard state={state} />}

        {game.phase === "round" && game.gamble_enabled && (
          <button
            onClick={() => setGambling(true)}
            disabled={!open || me.cash < 1000}
            className="flex w-full items-center gap-3 rounded-2xl bg-ink p-4 text-left text-white shadow-lg transition active:scale-[0.99] disabled:opacity-50"
          >
            <span className="text-4xl">🎰</span>
            <span className="flex-1">
              <span className="font-display block text-lg font-black">All on red?</span>
              <span className="block text-sm text-white/60">Put all {money(me.cash, { compact: true })} of your cash on red or black. Double it, or lose it all.</span>
            </span>
            <span className="text-2xl">›</span>
          </button>
        )}

        {tab === "market" && (
          <section aria-label="Marketplace" className="grid gap-4 sm:grid-cols-2">
            {properties.filter((p) => p.enabled || holdings.has(p.property_id)).map((p) => (
              <PropertyCard
                key={p.property_id} p={p} game={game} owned={holdings.get(p.property_id) ?? null}
                tradingOpen={open} cash={me.cash} busy={busy}
                onBuy={() => buy(p.property_id, p.name)} onSell={() => sell(p.property_id, p.name)}
              />
            ))}
          </section>
        )}

        {tab === "portfolio" && (
          <section className="space-y-4">
            <div className="card p-4">
              <div className="label">Your results so far</div>
              <dl className="mt-2 grid grid-cols-2 gap-3 text-sm">
                <Row k="Starting cash" v={money(game.starting_cash)} />
                <Row k="Rent collected" v={money(me.rent_total)} good />
                <Row k="Expenses and fees" v={money(-me.expense_total)} bad />
                <Row k="Outstanding debt" v={money(-me.debt)} bad={me.debt > 0} />
              </dl>
              <p className="mt-3 text-xs text-steel">Net worth = cash (rent collected, minus expenses) + property market values − debt.</p>
            </div>
            <LoanCard game={game} me={me} open={open && game.phase === "round"} busy={busy} onBorrow={(n) => run(async () => { await rpc("borrow", { p_code: code, p_token: token, p_amount: n }); await refresh(); }, `Borrowed ${money(n)}`)} onRepay={(n) => run(async () => { await rpc("repay", { p_code: code, p_token: token, p_amount: n }); await refresh(); }, "Loan repaid")} />
            {me.holdings.length === 0 ? (
              <div className="card p-8 text-center text-steel">You do not own anything yet. Head to the Market tab.</div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {properties.filter((p) => holdings.has(p.property_id)).map((p) => (
                  <PropertyCard key={p.property_id} p={p} game={game} owned={holdings.get(p.property_id)!} tradingOpen={open} cash={me.cash} busy={busy}
                    onBuy={() => {}} onSell={() => sell(p.property_id, p.name)} />
                ))}
              </div>
            )}
          </section>
        )}

        {tab === "ranks" && (
          <section>
            <h2 className="font-display mb-3 text-xl font-black">Leaderboard</h2>
            <Leaderboard players={state.players} results={state.results} startingCash={game.starting_cash} meId={me.id} hideScores={game.leaderboard_hidden} />
          </section>
        )}
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-steel-light bg-white/95 backdrop-blur" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="mx-auto grid max-w-2xl grid-cols-3">
          {([["market", "Market", "🏙️"], ["portfolio", "Portfolio", "💼"], ["ranks", "Leaderboard", "🏆"]] as const).map(([k, l, i]) => (
            <button key={k} onClick={() => setTab(k)} aria-current={tab === k} className={`flex flex-col items-center py-2.5 text-xs font-extrabold ${tab === k ? "text-navy" : "text-steel"}`}>
              <span className="text-xl">{i}</span>{l}
              {tab === k && <span className="mt-0.5 h-0.5 w-6 rounded bg-navy" />}
            </button>
          ))}
        </div>
      </nav>

      {gambling && <GambleModal code={code} token={token} cash={me.cash} onClose={() => setGambling(false)} onSettled={() => void refresh()} />}

      {editing && (
        <ProfileEditor
          code={code} token={token} nick={me.nickname} emoji={me.emoji}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); void refresh(); flash("Profile updated"); }}
        />
      )}
    </main>
  );
}

function Stat({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl px-2 py-1.5 ${strong ? "bg-white text-ink" : "bg-white/10"}`}>
      <div className={`label !text-[0.6rem] ${strong ? "" : "!text-white/50"}`}>{label}</div>
      <div className="num text-lg font-black leading-tight">{value}</div>
      {sub && <div className={`text-[0.65rem] ${strong ? "text-steel" : "text-white/50"}`}>{sub}</div>}
    </div>
  );
}

function Row({ k, v, good, bad }: { k: string; v: string; good?: boolean; bad?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-steel">{k}</dt>
      <dd className={`num font-black ${good ? "text-up" : bad ? "text-down" : ""}`}>{v}</dd>
    </div>
  );
}

function Panel({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <div className="card flex items-start gap-3 p-4 anim-pop">
      <span className="text-3xl">{icon}</span>
      <div>
        <h2 className="font-display text-lg font-black">{title}</h2>
        <p className="text-sm text-ink/70">{text}</p>
      </div>
    </div>
  );
}

function LoanCard({ game, me, open, busy, onBorrow, onRepay }: { game: GameState["game"]; me: NonNullable<GameState["me"]>; open: boolean; busy: boolean; onBorrow: (n: number) => void; onRepay: (n: number) => void }) {
  const room = Math.max(0, game.max_debt - me.debt);
  const step = 50000;
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="label">Bank loan</div>
          <div className="text-sm text-ink/70">
            The first <b>{money(game.loan_cheap_limit)}</b> costs <b>{(game.loan_rate * 100).toFixed(1)}%</b> per round. Every dollar beyond that costs <b className="text-down">{(game.loan_penalty_rate * 100).toFixed(0)}%</b> per round.
          </div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button className="btn btn-navy" disabled={!open || busy || room <= 0} onClick={() => onBorrow(Math.min(step, room))}>Borrow {money(Math.min(step, room), { compact: true })}</button>
        <button className="btn btn-ghost" disabled={!open || busy || me.debt <= 0 || me.cash <= 0} onClick={() => onRepay(Math.min(step, me.debt))}>Repay {money(Math.min(step, me.debt || step), { compact: true })}</button>
      </div>
      <p className="mt-2 text-xs text-steel">
        You owe {money(me.debt)}{me.debt >= game.loan_cheap_limit ? <b className="text-down"> · the next dollar costs {(game.loan_penalty_rate * 100).toFixed(0)}% per round</b> : <> · {money(Math.max(0, game.loan_cheap_limit - me.debt))} of cheap credit left</>}. Hard limit {money(game.max_debt)}. Loans open during market rounds.
      </p>
    </div>
  );
}

function FinalCard({ state }: { state: GameState }) {
  const me = state.me!;
  const winner = state.players[0];
  const myRank = state.players.find((p) => p.id === me.id)?.rank ?? 0;
  const won = myRank === 1;
  useEffect(() => {
    if (!won) return;
    void import("canvas-confetti").then(({ default: confetti }) => {
      confetti({ particleCount: 140, spread: 80, origin: { y: 0.3 }, colors: ["#1f3f77", "#8e9aa5", "#ffffff", "#0b0c0e"] });
    });
  }, [won]);
  return (
    <div className={`card overflow-hidden text-center anim-pop`}>
      <div className={`${won ? "bg-navy" : "skyline-bg"} px-6 py-8 text-white`}>
        <div className="text-6xl">{won ? "🏆" : myRank <= 3 ? "🥈" : "🏙️"}</div>
        <h2 className="font-display mt-2 text-3xl font-black">{won ? "You won!" : `You finished #${myRank}`}</h2>
        <p className="text-white/70">Final net worth</p>
        <div className="num text-4xl font-black">{money(me.net_worth)}</div>
      </div>
      <div className="p-4 text-sm text-ink/70">
        {won ? "Top investor in the room. Well played." : <>Winner: <b>{winner.emoji} {winner.nickname}</b> with {money(winner.net_worth)}.</>}
      </div>
    </div>
  );
}

function ProfileEditor({ code, token, nick, emoji, onClose, onSaved }: { code: string; token: string; nick: string; emoji: string; onClose: () => void; onSaved: () => void }) {
  const [n, setN] = useState(nick);
  const [e, setE] = useState(emoji);
  const { busy, msg, run } = useAct();
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <Toast msg={msg} />
      <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl" onClick={(ev) => ev.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-black">Your profile</h2>
          <button onClick={onClose} className="text-2xl text-steel" aria-label="Close">×</button>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Avatar emoji={e} size={64} />
          <input className="input !font-bold" value={n} maxLength={20} onChange={(ev) => setN(ev.target.value)} />
        </div>
        <div className="mt-4"><EmojiPicker value={e} onChange={setE} /></div>
        <button className="btn btn-navy mt-5 w-full" disabled={busy || !n.trim()} onClick={() => run(async () => { await rpc("update_profile", { p_code: code, p_token: token, p_nickname: n, p_emoji: e }); onSaved(); })}>Save</button>
      </div>
    </div>
  );
}

