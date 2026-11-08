"use client";
import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { rpc } from "@/lib/supabase";
import { useGame, useCountdown } from "@/lib/useGame";
import { adminPass, clearAdminPass, currentOrigin, noopSubscribe, rememberGame, saveAdminPass, subscribe } from "@/lib/storage";
import { money, PHASE_LABEL, TYPE_META } from "@/lib/format";
import { useAct, Toast } from "@/lib/useAct";
import { Logo } from "@/components/Logo";
import { Timer } from "@/components/Timer";
import { Leaderboard } from "@/components/Leaderboard";
import { EventCard, RoundRecap } from "@/components/EventCard";
import { Avatar, EmojiPicker } from "@/components/EmojiPicker";
import type { EventDef, GameState, PlayerRow, Property } from "@/lib/types";
import { GENERATOR_TYPES, randomProperty } from "@/lib/generator";
import { PropertyImage } from "@/components/PropertyArt";

type Tab = "control" | "players" | "properties" | "events" | "settings";
type Run = ReturnType<typeof useAct>["run"];
type Call = (fn: string, args?: Record<string, unknown>, ok?: string) => Promise<boolean>;

export default function AdminPage() {
  const { code: raw } = useParams<{ code: string }>();
  const code = raw.toUpperCase();
  const pass = useSyncExternalStore(subscribe, () => adminPass(code), () => undefined);
  if (pass === undefined) return <main className="flex-1 skyline-bg" />;
  if (!pass) return <PassGate code={code} />;
  return <Console code={code} pass={pass} onLogout={() => clearAdminPass(code)} />;
}

function PassGate({ code }: { code: string }) {
  const [p, setP] = useState("");
  const { busy, msg, run } = useAct();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const s = await rpc<GameState>("game_state", { p_code: code, p_admin: p.trim().toUpperCase() });
      if (s.error === "not_found") throw new Error("Room not found");
      if (s.error === "bad_admin") throw new Error("Wrong passcode");
      saveAdminPass(code, p);
      rememberGame(code, s.game.name);
    });
  };
  return (
    <main className="flex-1 skyline-bg text-white">
      <Toast msg={msg} />
      <form onSubmit={submit} className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-5">
        <span className="w-fit rounded-xl bg-white p-2"><Logo className="h-12" /></span>
        <h1 className="font-display text-3xl font-black">Admin for room {code}</h1>
        <p className="text-white/60">Enter the admin passcode shown when the game was created.</p>
        <input className="input text-center font-mono text-2xl font-black tracking-[0.3em]" value={p} onChange={(e) => setP(e.target.value.toUpperCase())} maxLength={10} autoFocus placeholder="PASSCODE" />
        <button className="btn btn-light !py-3.5" disabled={busy || p.length < 4}>Unlock</button>
        <Link href="/admin" className="text-center text-sm text-white/50">← Back</Link>
      </form>
    </main>
  );
}

function Console({ code, pass, onLogout }: { code: string; pass: string; onLogout: () => void }) {
  const { state, error, refresh, offset } = useGame(code, { admin: pass, pollMs: 3000 });
  const { busy, msg, run, flash } = useAct();
  const [tab, setTab] = useState<Tab>("control");
  const [showPass, setShowPass] = useState(false);
  const secs = useCountdown(state?.game, offset);
  const origin = useSyncExternalStore(noopSubscribe, currentOrigin, () => "");

  const call: Call = (fn, args = {}, ok) => run(async () => { await rpc(fn, { p_code: code, p_pass: pass, ...args }); await refresh(); }, ok);

  if (error === "bad_admin") return <PassGate code={code} />;
  if (error === "not_found") return <main className="flex-1 grid place-items-center p-8">Room not found. <Link href="/admin" className="ml-2 underline">Back</Link></main>;
  if (!state) return <main className="flex-1 skyline-bg grid place-items-center text-white/70">Loading console…</main>;

  const { game } = state;
  const joinUrl = `${origin}/play/${code}`;
  const tabs: [Tab, string][] = [["control", "Control"], ["players", `Players (${state.players.length})`], ["properties", "Properties"], ["events", "Events"], ["settings", "Settings"]];

  return (
    <main className="flex-1 bg-steel-pale pb-16">
      <Toast msg={msg} />
      <header className="skyline-bg sticky top-0 z-30 text-white shadow-lg">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
          <span className="rounded-lg bg-white p-1"><Logo className="h-9" /></span>
          <div>
            <div className="label !text-white/50">Admin · {game.name}</div>
            <div className="flex items-baseline gap-3">
              <span className="font-display text-2xl font-black tracking-[0.2em]">{code}</span>
              <button className="text-xs font-bold text-white/60 underline" onClick={() => setShowPass((s) => !s)}>{showPass ? <span className="font-mono tracking-widest text-white">{pass}</span> : "show passcode"}</button>
            </div>
          </div>
          <span className="rounded-full bg-white/10 px-3 py-1 text-sm font-bold">{PHASE_LABEL[game.phase]}{game.round > 0 && game.phase !== "finished" ? ` · Round ${game.round}/${game.total_rounds}` : ""}</span>
          {secs !== null && (game.phase === "building" || game.phase === "round") && <Timer seconds={secs} paused={game.paused} />}
          <div className="ml-auto flex flex-wrap gap-2">
            <a href={`/screen/${code}`} target="_blank" rel="noreferrer" className="btn btn-light !py-2 text-sm">📺 Open presentation screen</a>
            <button className="btn btn-ghost !border-white/30 !py-2 text-sm !text-white" onClick={() => { void navigator.clipboard?.writeText(joinUrl); flash("Join link copied"); }}>Copy join link</button>
            <button className="btn btn-ghost !border-white/30 !py-2 text-sm !text-white" onClick={onLogout}>Lock</button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4">
          {tabs.map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`whitespace-nowrap rounded-t-xl px-4 py-2 text-sm font-extrabold ${tab === k ? "bg-steel-pale text-navy-deep" : "text-white/70 hover:text-white"}`}>{l}</button>
          ))}
        </nav>
      </header>

      <div className="mx-auto max-w-6xl px-4 pt-5">
        {tab === "control" && <ControlTab state={state} call={call} busy={busy} secs={secs} joinUrl={joinUrl} />}
        {tab === "players" && <PlayersTab state={state} call={call} run={run} busy={busy} />}
        {tab === "properties" && <PropertiesTab state={state} call={call} busy={busy} />}
        {tab === "events" && <EventsTab state={state} call={call} busy={busy} />}
        {tab === "settings" && <SettingsTab state={state} call={call} busy={busy} code={code} />}
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ Control */

function ControlTab({ state, call, busy, secs, joinUrl }: { state: GameState; call: Call; busy: boolean; secs: number | null; joinUrl: string }) {
  const g = state.game;
  const events = state.admin.events ?? [];
  const plan = state.admin.event_plan ?? {};
  const next = g.round + 1;
  const planned = plan[String(next)];
  const [pick, setPick] = useState("");
  const chosen = pick || planned || "random";
  const lastLog = state.round_log[state.round_log.length - 1];
  const canStartRound = g.phase === "building" || g.phase === "round_end";
  const hasMore = g.round < g.total_rounds;

  return (
    <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
      <div className="space-y-5">
        <section className="card space-y-4 p-5">
          <h2 className="font-display text-xl font-black">Game flow</h2>

          {g.phase === "lobby" && (
            <>
              <p className="text-ink/70">{state.players.length} investors have joined. Share the room code or open the presentation screen so they can scan the QR code.</p>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-navy !px-6 !py-3.5 text-lg" disabled={busy} onClick={() => call("admin_start_building")}>▶ Start build phase ({g.build_seconds}s)</button>
                <button className="btn btn-ghost" disabled={busy} onClick={() => call("admin_add_bots", { p_count: 3 }, "Added 3 bots")}>+ 3 test bots</button>
                {state.players.some((p) => p.is_bot) && <button className="btn btn-ghost" disabled={busy} onClick={() => call("admin_clear_bots", {}, "Bots removed")}>Remove bots</button>}
              </div>
              <p className="break-all text-xs text-steel">Join link: {joinUrl}</p>
            </>
          )}

          {(g.phase === "building" || g.phase === "round") && (
            <TimerControls g={g} secs={secs} call={call} busy={busy} />
          )}

          {canStartRound && hasMore && (
            <div className="rounded-xl bg-steel-pale p-4">
              <div className="label">Round {next} market event</div>
              <select className="input mt-2 font-bold" value={chosen} onChange={(e) => setPick(e.target.value)}>
                <option value="random">🎲 Surprise me (random)</option>
                {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.emoji} {ev.title}{ev.custom ? " (custom)" : ""}{plan[String(next)] === ev.id ? " ★ planned" : ""}</option>)}
              </select>
              <button className="btn btn-navy mt-3 w-full !py-3.5 text-lg" disabled={busy} onClick={() => { void call("admin_start_round", { p_event: chosen }); setPick(""); }}>
                ▶ {g.phase === "building" ? "End build and start" : "Start"} Round {next}
              </button>
            </div>
          )}

          {g.phase === "round" && (
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-ink" disabled={busy} onClick={() => call("admin_timer", { p_action: "end" }, "Round settled")}>⏹ End round and settle now</button>
              <button className="btn btn-ghost" disabled={busy} onClick={() => call("admin_update_settings", { p_settings: { trading_locked: !g.trading_locked } })}>{g.trading_locked ? "🔓 Unlock trading" : "🔒 Lock trading"}</button>
            </div>
          )}

          {g.phase === "round_end" && !hasMore && (
            <button className="btn btn-navy !py-3.5 text-lg" disabled={busy} onClick={() => call("admin_finish")}>🏆 Reveal the winner</button>
          )}
          {g.phase !== "finished" && g.phase !== "lobby" && (
            <button className="btn btn-ghost text-sm" disabled={busy} onClick={() => { if (confirm("End the game now and announce the winner?")) void call("admin_finish"); }}>End game early</button>
          )}
          {g.phase === "finished" && (
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-navy" disabled={busy} onClick={() => { if (confirm("Reset everyone to the lobby with fresh cash?")) void call("admin_reset_game", {}, "Game reset"); }}>↺ Play again (same players)</button>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm font-bold">
            <input type="checkbox" className="h-4 w-4 accent-navy" checked={g.leaderboard_hidden} onChange={(e) => call("admin_update_settings", { p_settings: { leaderboard_hidden: e.target.checked } })} />
            Hide scores on screens (for suspense before a reveal)
          </label>
        </section>

        {state.event && g.phase === "round" && <EventCard event={state.event} />}
        {g.phase === "round" && state.admin.events && (
          <p className="text-xs text-steel">Players see directions only. Magnitudes are rolled randomly (within each event&apos;s range) when the round settles, identical for every player.</p>
        )}
        {lastLog && g.phase !== "round" && <RoundRecap log={lastLog} properties={state.properties} />}
      </div>

      <section className="card h-fit p-5">
        <h2 className="font-display mb-3 text-xl font-black">Live leaderboard</h2>
        <Leaderboard players={state.players} results={state.results} startingCash={g.starting_cash} />
      </section>
    </div>
  );
}

function TimerControls({ g, secs, call, busy }: { g: GameState["game"]; secs: number | null; call: Call; busy: boolean }) {
  return (
    <div className="rounded-xl bg-steel-pale p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <div className="label">{g.phase === "building" ? "Build timer" : `Round ${g.round} timer`}</div>
          {secs !== null ? <Timer seconds={secs} paused={g.paused} /> : <span className="font-bold">Untimed</span>}
        </div>
        {g.paused
          ? <button className="btn btn-navy" disabled={busy} onClick={() => call("admin_timer", { p_action: "resume" })}>▶ Resume</button>
          : <button className="btn btn-ghost" disabled={busy} onClick={() => call("admin_timer", { p_action: "pause" })}>⏸ Pause</button>}
        <button className="btn btn-ghost" disabled={busy} onClick={() => call("admin_timer", { p_action: "add", p_seconds: -30 })}>−30s</button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => call("admin_timer", { p_action: "add", p_seconds: 30 })}>+30s</button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => call("admin_timer", { p_action: "add", p_seconds: 60 })}>+1m</button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => call("admin_timer", { p_action: "restart" })}>↻ Restart</button>
        {g.phase === "building" && <button className="btn btn-ink" disabled={busy} onClick={() => call("admin_timer", { p_action: "end" })}>Close marketplace</button>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Players */

function PlayersTab({ state, call, run, busy }: { state: GameState; call: Call; run: Run; busy: boolean }) {
  const [editing, setEditing] = useState<PlayerRow | null>(null);
  const live = editing ? state.players.find((p) => p.id === editing.id) ?? null : null;
  void run;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-xl font-black">{state.players.length} investors</h2>
        <div className="flex gap-2">
          <button className="btn btn-ghost text-sm" disabled={busy} onClick={() => call("admin_add_bots", { p_count: 3 }, "Added 3 bots")}>+ 3 bots</button>
          <button className="btn btn-ghost text-sm" disabled={busy || !state.players.some((p) => p.is_bot)} onClick={() => call("admin_clear_bots", {}, "Bots removed")}>Remove bots</button>
        </div>
      </div>
      {state.players.length === 0 && <div className="card p-10 text-center text-steel">Nobody has joined yet.</div>}
      <div className="grid gap-3 md:grid-cols-2">
        {state.players.map((p) => (
          <div key={p.id} className="card flex items-center gap-3 p-3">
            <Avatar emoji={p.emoji} size={48} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-extrabold">{p.nickname}{p.is_bot && <span className="ml-1 text-[0.65rem] text-steel">BOT</span>}</div>
              <div className="num text-xs text-steel">#{p.rank} · {money(p.net_worth)} · cash {money(p.cash, { compact: true })}{p.debt ? ` · debt ${money(p.debt, { compact: true })}` : ""} · {p.props} props</div>
            </div>
            <button className="btn btn-ghost !px-3 !py-1.5 text-sm" onClick={() => setEditing(p)}>Edit</button>
            <button className="btn btn-danger !px-3 !py-1.5 text-sm" disabled={busy} onClick={() => { if (confirm(`Kick ${p.nickname} from the game?`)) void call("admin_kick_player", { p_player: p.id }, `${p.nickname} removed`); }}>Kick</button>
          </div>
        ))}
      </div>
      {live && <PlayerEditor key={live.id} player={live} state={state} call={call} busy={busy} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PlayerEditor({ player, state, call, busy, onClose }: { player: PlayerRow; state: GameState; call: Call; busy: boolean; onClose: () => void }) {
  const [nick, setNick] = useState(player.nickname);
  const [emoji, setEmoji] = useState(player.emoji);
  const [cash, setCash] = useState(String(player.cash));
  const [debt, setDebt] = useState(String(player.debt));
  const [delta, setDelta] = useState("");
  const owned = new Set((state.admin.holdings ?? []).filter((h) => h.player_id === player.id).map((h) => h.property_id));

  const save = async () => {
    const patch: Record<string, unknown> = { nickname: nick, emoji };
    if (Number(cash) !== player.cash) patch.cash = Number(cash);
    if (Number(debt) !== player.debt) patch.debt = Number(debt);
    if (await call("admin_update_player", { p_player: player.id, p_patch: patch }, "Player updated")) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={onClose}>
      <div className="my-6 w-full max-w-2xl rounded-3xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl font-black">Edit investor</h2>
          <button className="text-3xl text-steel" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="mt-4 flex items-center gap-4">
          <Avatar emoji={emoji} size={72} />
          <label className="flex-1"><span className="label">Nickname</span><input className="input mt-1 !font-bold" value={nick} maxLength={20} onChange={(e) => setNick(e.target.value)} /></label>
        </div>
        <div className="mt-4"><EmojiPicker value={emoji} onChange={setEmoji} /></div>

        <div className="mt-5 grid grid-cols-2 gap-4">
          <label><span className="label">Cash ($)</span><input className="input num mt-1" type="number" value={cash} onChange={(e) => setCash(e.target.value)} /></label>
          <label><span className="label">Debt ($)</span><input className="input num mt-1" type="number" value={debt} onChange={(e) => setDebt(e.target.value)} /></label>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex-1"><span className="label">Quick adjust (bonus or penalty)</span><input className="input num mt-1" type="number" placeholder="e.g. 25000 or -10000" value={delta} onChange={(e) => setDelta(e.target.value)} /></label>
          <button className="btn btn-ink" disabled={busy || !Number(delta)} onClick={async () => { if (await call("admin_update_player", { p_player: player.id, p_patch: { cash_delta: Number(delta) } }, "Cash adjusted")) { setDelta(""); onClose(); } }}>Apply</button>
        </div>

        <div className="mt-5">
          <div className="label">Portfolio (tap to give or remove)</div>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {state.properties.map((p) => {
              const has = owned.has(p.property_id);
              return (
                <button key={p.property_id} disabled={busy} onClick={() => call("admin_player_property", { p_player: player.id, p_property: p.property_id, p_action: has ? "remove" : "grant" })}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm font-bold ${has ? "border-navy bg-navy/10" : "border-steel-light"}`}>
                  <span className="truncate">{p.name}</span><span>{has ? "✓ owned" : "+ grant"}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-steel">Granting is free at the current price. Removing does not refund cash. Use Cash above to compensate.</p>
        </div>

        <div className="mt-6 flex flex-wrap justify-between gap-2">
          <button className="btn btn-ghost" disabled={busy} onClick={() => { if (confirm("Wipe this investor's portfolio and reset cash to the starting amount?")) void call("admin_reset_player", { p_player: player.id }, "Investor reset"); }}>Reset investor</button>
          <div className="flex gap-2">
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-navy" disabled={busy || !nick.trim()} onClick={save}>Save changes</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Properties */

function PropertiesTab({ state, call, busy }: { state: GameState; call: Call; busy: boolean }) {
  const [adding, setAdding] = useState(false);
  const generate = async (n: number) => {
    const types = [...GENERATOR_TYPES].sort(() => Math.random() - 0.5);
    for (let i = 0; i < n; i++) {
      const ok = await call("admin_add_property", { p_def: randomProperty(n > 1 ? types[i % types.length] : undefined) });
      if (!ok) return;
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-black">Marketplace</h2>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-ink text-sm" disabled={busy} onClick={() => generate(5)}>🎲 Generate 5 random</button>
          <button className="btn btn-ghost text-sm" disabled={busy} onClick={() => generate(1)}>🎲 +1</button>
          <button className="btn btn-navy text-sm" onClick={() => setAdding((a) => !a)}>{adding ? "Close" : "+ Add property"}</button>
        </div>
      </div>
      <p className="text-sm text-steel">Edit anything, any time. Price changes revalue every owner&apos;s portfolio instantly. Leave stock blank for unlimited.</p>
      {adding && <NewProperty call={call} busy={busy} onDone={() => setAdding(false)} />}
      <div className="grid gap-4 lg:grid-cols-2">
        {state.properties.map((p) => <PropertyEditor key={p.property_id} p={p} call={call} busy={busy} />)}
      </div>
    </div>
  );
}

function PropertyEditor({ p, call, busy }: { p: Property; call: Call; busy: boolean }) {
  const [f, setF] = useState({
    name: p.name, location: p.location, description: p.description, current_value: String(p.current_value),
    monthly_rent: String(p.monthly_rent), maintenance: String(+(p.maintenance_rate * 100).toFixed(2)), risk: p.risk,
    supply: p.supply === null ? "" : String(p.supply), type: p.type, image_url: p.image_url ?? "",
  });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const save = () => call("admin_update_property", {
    p_property: p.property_id,
    p_patch: {
      name: f.name, location: f.location, description: f.description, risk: f.risk, type: f.type,
      current_value: Number(f.current_value), monthly_rent: Number(f.monthly_rent),
      maintenance_rate: Number(f.maintenance) / 100, supply: f.supply === "" ? "" : Number(f.supply), image_url: f.image_url,
    },
  }, `${f.name} saved`);
  return (
    <div className={`card space-y-3 p-4 ${p.enabled ? "" : "opacity-60"}`}>
      <div className="flex items-center gap-2">
        <input className="input !font-extrabold" value={f.name} onChange={(e) => set("name", e.target.value)} />
        <label className="flex items-center gap-1 whitespace-nowrap text-sm font-bold"><input type="checkbox" className="h-4 w-4 accent-navy" checked={p.enabled} onChange={(e) => call("admin_update_property", { p_property: p.property_id, p_patch: { enabled: e.target.checked } })} />On market</label>
      </div>
      <PropertyImage src={f.image_url || null} type={f.type} seed={p.property_id} className="h-28 w-full rounded-xl" />
      <input className="input !text-sm" placeholder="Photo URL (optional, paste any image link)" value={f.image_url} onChange={(e) => set("image_url", e.target.value)} />
      <input className="input !text-sm" value={f.location} onChange={(e) => set("location", e.target.value)} />
      <textarea className="input !text-sm" rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Mini label="Price ($)"><input className="input num" type="number" value={f.current_value} onChange={(e) => set("current_value", e.target.value)} /></Mini>
        <Mini label="Rent / month ($)"><input className="input num" type="number" value={f.monthly_rent} onChange={(e) => set("monthly_rent", e.target.value)} /></Mini>
        <Mini label="Upkeep % / yr"><input className="input num" type="number" step="0.1" value={f.maintenance} onChange={(e) => set("maintenance", e.target.value)} /></Mini>
        <Mini label="Risk"><select className="input" value={f.risk} onChange={(e) => set("risk", e.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></Mini>
        <Mini label="Type (events)"><select className="input" value={f.type} onChange={(e) => set("type", e.target.value)}>{Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Mini>
        <Mini label={`Stock (${p.owned} owned)`}><input className="input num" type="number" min={0} placeholder="∞" value={f.supply} onChange={(e) => set("supply", e.target.value)} /></Mini>
      </div>
      <button className="btn btn-navy w-full" disabled={busy} onClick={save}>Save</button>
    </div>
  );
}

function NewProperty({ call, busy, onDone }: { call: Call; busy: boolean; onDone: () => void }) {
  const [f, setF] = useState({ name: "", label: "Custom", location: "", description: "", price: "300000", rent: "2500", risk: "medium", type: "residential", maintenance_rate: "1.5" });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  return (
    <div className="card grid gap-3 p-4 sm:grid-cols-2">
      <Mini label="Name"><input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} /></Mini>
      <Mini label="Location"><input className="input" value={f.location} onChange={(e) => set("location", e.target.value)} /></Mini>
      <Mini label="Label (e.g. Condo)"><input className="input" value={f.label} onChange={(e) => set("label", e.target.value)} /></Mini>
      <Mini label="Type (events)"><select className="input" value={f.type} onChange={(e) => set("type", e.target.value)}>{Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Mini>
      <Mini label="Price ($)"><input className="input num" type="number" value={f.price} onChange={(e) => set("price", e.target.value)} /></Mini>
      <Mini label="Rent / month ($)"><input className="input num" type="number" value={f.rent} onChange={(e) => set("rent", e.target.value)} /></Mini>
      <Mini label="Risk"><select className="input" value={f.risk} onChange={(e) => set("risk", e.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></Mini>
      <Mini label="Upkeep % / yr"><input className="input num" type="number" step="0.1" value={f.maintenance_rate} onChange={(e) => set("maintenance_rate", e.target.value)} /></Mini>
      <div className="sm:col-span-2"><Mini label="Description"><input className="input" value={f.description} onChange={(e) => set("description", e.target.value)} /></Mini></div>
      <button className="btn btn-navy sm:col-span-2" disabled={busy || !f.name.trim()} onClick={async () => {
        if (await call("admin_add_property", { p_def: { ...f, price: Number(f.price), rent: Number(f.rent), maintenance_rate: Number(f.maintenance_rate) / 100 } }, "Property added")) onDone();
      }}>Add to marketplace</button>
    </div>
  );
}

function Mini({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="label !text-[0.62rem]">{label}</span><div className="mt-1">{children}</div></label>;
}

/* ------------------------------------------------------------------- Events */

const EFFECT_TYPES = Object.keys(TYPE_META);

function EventsTab({ state, call, busy }: { state: GameState; call: Call; busy: boolean }) {
  const events = state.admin.events ?? [];
  const plan = state.admin.event_plan ?? {};
  const g = state.game;
  const rounds = Array.from({ length: g.total_rounds }, (_, i) => i + 1);
  const setPlan = (round: number, id: string) => {
    const next = { ...plan };
    if (id === "random") delete next[String(round)]; else next[String(round)] = id;
    return call("admin_update_settings", { p_settings: { event_plan: next } }, `Round ${round} event set`);
  };
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="card space-y-3 p-5">
        <h2 className="font-display text-xl font-black">Event schedule</h2>
        <p className="text-sm text-steel">Pre-pick the event for each round, or leave it random. You can still override when starting a round. Players never see the plan.</p>
        {rounds.map((r) => (
          <label key={r} className="block">
            <span className="label">Round {r}{r <= g.round ? " (played)" : ""}</span>
            <select className="input mt-1 font-bold" disabled={busy || r <= g.round} value={plan[String(r)] ?? "random"} onChange={(e) => setPlan(r, e.target.value)}>
              <option value="random">🎲 Random</option>
              {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.emoji} {ev.title}</option>)}
            </select>
          </label>
        ))}
      </section>
      <CustomEvent call={call} busy={busy} />
      <section className="card p-5 lg:col-span-2">
        <h2 className="font-display mb-3 text-xl font-black">Event library</h2>
        <div className="grid gap-2 md:grid-cols-2">
          {events.map((ev) => <EventRow key={ev.id} ev={ev} call={call} busy={busy} />)}
        </div>
      </section>
    </div>
  );
}

function EventRow({ ev, call, busy }: { ev: EventDef; call: Call; busy: boolean }) {
  const fx = Object.entries(ev.effects).filter(([k]) => k !== "all");
  const summary = fx.slice(0, 4).map(([k, v]) => `${TYPE_META[k]?.label ?? k} ${v.v ? `${v.v[0]}…${v.v[1]}%` : ""}`).join(" · ");
  return (
    <div className="flex items-start gap-3 rounded-xl border border-steel-light p-3">
      <span className="text-3xl">{ev.emoji}</span>
      <div className="min-w-0 flex-1">
        <div className="font-extrabold">{ev.title}{ev.custom && <span className="ml-2 rounded bg-navy px-1.5 py-0.5 text-[0.6rem] text-white">CUSTOM</span>}</div>
        <div className="text-xs text-steel">{ev.headline}</div>
        <div className="mt-1 truncate text-[0.7rem] text-ink/50">{summary}{ev.effects.all?.v ? ` · All ${ev.effects.all.v[0]}…${ev.effects.all.v[1]}%` : ""}</div>
      </div>
      {ev.custom && <button className="text-sm font-bold text-down" disabled={busy} onClick={() => call("admin_delete_event", { p_event: ev.id }, "Event deleted")}>Delete</button>}
    </div>
  );
}

function CustomEvent({ call, busy }: { call: Call; busy: boolean }) {
  const [f, setF] = useState({ title: "", emoji: "⚡", headline: "", description: "" });
  const [fx, setFx] = useState<Record<string, { v: string; r: string; m: string }>>({});
  const upd = (t: string, k: "v" | "r" | "m", val: string) => setFx((s) => { const cur = s[t] ?? { v: "", r: "", m: "" }; return { ...s, [t]: { ...cur, [k]: val } }; });
  const build = () => {
    const effects: Record<string, Record<string, [number, number]>> = {};
    for (const [t, e] of Object.entries(fx)) {
      const o: Record<string, [number, number]> = {};
      (["v", "r", "m"] as const).forEach((k) => { const n = Number(e[k]); if (e[k] !== "" && n) o[k] = [n, n]; });
      if (Object.keys(o).length) effects[t] = o;
    }
    return effects;
  };
  return (
    <section className="card space-y-3 p-5">
      <h2 className="font-display text-xl font-black">Create a custom event</h2>
      <p className="text-sm text-steel">Fixed percentages per property type. Random noise still applies to each property based on its risk.</p>
      <div className="grid grid-cols-[4rem_1fr] gap-3">
        <input className="input text-center text-2xl" value={f.emoji} maxLength={4} onChange={(e) => setF({ ...f, emoji: e.target.value })} />
        <input className="input !font-bold" placeholder="Event title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      </div>
      <input className="input" placeholder="Headline players see" value={f.headline} onChange={(e) => setF({ ...f, headline: e.target.value })} />
      <input className="input" placeholder="Flavor text (optional)" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left"><th className="label py-1">Type</th><th className="label">Value %</th><th className="label">Rent %</th><th className="label">Repairs %</th></tr></thead>
          <tbody>
            {EFFECT_TYPES.map((t) => (
              <tr key={t}>
                <td className="py-1 pr-2 font-bold">{TYPE_META[t].label}</td>
                {(["v", "r", "m"] as const).map((k) => (
                  <td key={k} className="pr-2"><input className="input num !px-2 !py-1.5" type="number" placeholder="0" value={fx[t]?.[k] ?? ""} onChange={(e) => upd(t, k, e.target.value)} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn btn-navy w-full" disabled={busy || !f.title.trim() || Object.keys(build()).length === 0}
        onClick={async () => { if (await call("admin_create_event", { p_event: { ...f, effects: build() } }, "Event created")) { setF({ title: "", emoji: "⚡", headline: "", description: "" }); setFx({}); } }}>
        Save event
      </button>
    </section>
  );
}

/* ----------------------------------------------------------------- Settings */

function SettingsTab({ state, call, busy, code }: { state: GameState; call: Call; busy: boolean; code: string }) {
  const router = useRouter();
  const g = state.game;
  const [f, setF] = useState({
    name: g.name, total_rounds: String(g.total_rounds), build_seconds: String(g.build_seconds), round_seconds: String(g.round_seconds),
    starting_cash: String(g.starting_cash), fee_rate: String(+(g.fee_rate * 100).toFixed(2)), loan_rate: String(+(g.loan_rate * 100).toFixed(2)),
    max_debt: String(g.max_debt), volatility: String(g.volatility), rent_months: String(g.rent_months),
  });
  const [scarcity, setScarcity] = useState(g.scarcity);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const save = () => call("admin_update_settings", { p_settings: {
    name: f.name, total_rounds: Number(f.total_rounds), build_seconds: Number(f.build_seconds), round_seconds: Number(f.round_seconds),
    starting_cash: Number(f.starting_cash), fee_rate: Number(f.fee_rate) / 100, loan_rate: Number(f.loan_rate) / 100,
    max_debt: Number(f.max_debt), volatility: Number(f.volatility), rent_months: Number(f.rent_months), scarcity,
  } }, "Settings saved");
  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <section className="card space-y-4 p-5">
        <h2 className="font-display text-xl font-black">Game and scoring rules</h2>
        <p className="text-sm text-steel">Changes apply immediately. Starting cash applies to everyone while in the lobby; later it only affects new joiners.</p>
        <Mini label="Game name"><input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} /></Mini>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Mini label="Market rounds"><input className="input num" type="number" value={f.total_rounds} onChange={(e) => set("total_rounds", e.target.value)} /></Mini>
          <Mini label="Build time (s)"><input className="input num" type="number" value={f.build_seconds} onChange={(e) => set("build_seconds", e.target.value)} /></Mini>
          <Mini label="Round time (s)"><input className="input num" type="number" value={f.round_seconds} onChange={(e) => set("round_seconds", e.target.value)} /></Mini>
          <Mini label="Starting cash ($)"><input className="input num" type="number" value={f.starting_cash} onChange={(e) => set("starting_cash", e.target.value)} /></Mini>
          <Mini label="Trade fee %"><input className="input num" type="number" step="0.5" value={f.fee_rate} onChange={(e) => set("fee_rate", e.target.value)} /></Mini>
          <Mini label="Loan interest % / round"><input className="input num" type="number" step="0.5" value={f.loan_rate} onChange={(e) => set("loan_rate", e.target.value)} /></Mini>
          <Mini label="Max loan ($)"><input className="input num" type="number" value={f.max_debt} onChange={(e) => set("max_debt", e.target.value)} /></Mini>
          <Mini label="Chaos (0–5×)"><input className="input num" type="number" step="0.25" value={f.volatility} onChange={(e) => set("volatility", e.target.value)} /></Mini>
          <Mini label="Months of rent / round"><input className="input num" type="number" value={f.rent_months} onChange={(e) => set("rent_months", e.target.value)} /></Mini>
        </div>
        <label className="flex items-start gap-3 rounded-xl bg-steel-pale p-3">
          <input type="checkbox" className="mt-1 h-5 w-5 accent-navy" checked={scarcity} onChange={(e) => setScarcity(e.target.checked)} />
          <span><b>Limited stock</b><span className="block text-sm text-steel">Sets stock when the build phase starts (about 60% of players per property).</span></span>
        </label>
        <button className="btn btn-navy w-full !py-3" disabled={busy} onClick={save}>Save settings</button>
        <p className="text-xs text-steel">Net worth = cash + property market values − debt, where cash already includes rent collected minus repairs, fees and interest.</p>
      </section>
      <section className="card h-fit space-y-3 p-5">
        <h2 className="font-display text-xl font-black">Danger zone</h2>
        <button className="btn btn-ghost w-full" disabled={busy} onClick={() => { if (confirm("Reset the whole game back to the lobby? Portfolios and history are wiped, players stay.")) void call("admin_reset_game", {}, "Game reset"); }}>↺ Reset to lobby</button>
        <button className="btn btn-danger w-full" disabled={busy} onClick={() => { if (confirm(`Permanently delete room ${code} and all its data?`)) void call("admin_delete_game").then(() => { clearAdminPass(code); router.push("/admin"); }); }}>Delete this game</button>
      </section>
    </div>
  );
}
