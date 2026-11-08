"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { rpc } from "@/lib/supabase";
import { rememberGame, saveAdminPass } from "@/lib/storage";
import { useAct, Toast } from "@/lib/useAct";
import { Logo } from "@/components/Logo";
import type { GameState } from "@/lib/types";

export default function AdminHome() {
  const router = useRouter();
  const { busy, msg, run } = useAct();
  const [name, setName] = useState("Real Estate Shark Tank");
  const [build, setBuild] = useState(90);
  const [roundSecs, setRoundSecs] = useState(180);
  const [rounds, setRounds] = useState(3);
  const [cash, setCash] = useState(1_000_000);
  const [scarcity, setScarcity] = useState(false);
  const [code, setCode] = useState("");
  const [pass, setPass] = useState("");

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const g = await rpc<{ code: string; admin_pass: string }>("create_game", {
        p_name: name, p_solo: false,
        p_settings: { build_seconds: build, round_seconds: roundSecs, total_rounds: rounds, starting_cash: cash, scarcity },
      });
      saveAdminPass(g.code, g.admin_pass);
      rememberGame(g.code, name);
      router.push(`/admin/${g.code}`);
    });
  };

  const resume = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const c = code.trim().toUpperCase();
      const s = await rpc<GameState>("game_state", { p_code: c, p_admin: pass.trim().toUpperCase() });
      if (s.error === "not_found") throw new Error("No game with that code");
      if (s.error === "bad_admin") throw new Error("Wrong admin passcode");
      saveAdminPass(c, pass);
      rememberGame(c, s.game.name);
      router.push(`/admin/${c}`);
    });
  };

  return (
    <main className="flex-1 bg-steel-pale">
      <Toast msg={msg} />
      <header className="skyline-bg text-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4">
          <span className="rounded-xl bg-white p-1.5"><Logo className="h-10" /></span>
          <Link href="/" className="text-sm font-bold text-white/60">← Home</Link>
        </div>
      </header>
      <div className="mx-auto grid max-w-4xl gap-6 px-5 py-8 md:grid-cols-[1.4fr_1fr]">
        <form onSubmit={create} noValidate className="card space-y-4 p-6">
          <h1 className="font-display text-2xl font-black">Set up a new game</h1>
          <p className="text-sm text-steel">Everything here can be changed later from the admin console, even mid-game.</p>
          <Field label="Game name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Build time (sec)"><Num v={build} set={setBuild} min={10} max={3600} step={15} /></Field>
            <Field label="Round time (sec)"><Num v={roundSecs} set={setRoundSecs} min={10} max={3600} step={15} /></Field>
            <Field label="Market rounds"><Num v={rounds} set={setRounds} min={1} max={10} step={1} /></Field>
            <Field label="Starting cash ($)"><Num v={cash} set={setCash} min={1000} max={100_000_000} step={50_000} /></Field>
          </div>
          <label className="flex items-start gap-3 rounded-xl bg-steel-pale p-3">
            <input type="checkbox" checked={scarcity} onChange={(e) => setScarcity(e.target.checked)} className="mt-1 h-5 w-5 accent-navy" />
            <span><b>Limited stock</b><span className="block text-sm text-steel">Only some copies of each property exist. First to click gets it.</span></span>
          </label>
          <button className="btn btn-navy w-full !py-3.5 text-lg" disabled={busy}>{busy ? "Creating…" : "Create game room"}</button>
        </form>

        <form onSubmit={resume} className="card h-fit space-y-4 p-6">
          <h2 className="font-display text-xl font-black">Control an existing game</h2>
          <p className="text-sm text-steel">On another device? Enter the room code and the admin passcode shown on the first device.</p>
          <Field label="Room code"><input className="input font-display text-2xl font-black tracking-[0.3em]" value={code} maxLength={6} onChange={(e) => setCode(e.target.value.toUpperCase())} /></Field>
          <Field label="Admin passcode"><input className="input font-mono text-lg font-bold tracking-widest" value={pass} maxLength={10} onChange={(e) => setPass(e.target.value.toUpperCase())} /></Field>
          <button className="btn btn-ink w-full" disabled={busy || code.length < 3 || pass.length < 4}>Open admin console</button>
        </form>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="label">{label}</span><div className="mt-1">{children}</div></label>;
}

function Num({ v, set, min, max }: { v: number; set: (n: number) => void; min: number; max: number; step: number }) {
  return <input type="number" inputMode="numeric" className="input num" value={v} onChange={(e) => set(Number(e.target.value) || 0)} onBlur={() => set(Math.min(max, Math.max(min, v)))} />;
}
