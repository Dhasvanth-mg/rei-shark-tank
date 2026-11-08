"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useMemo, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { Logo } from "@/components/Logo";
import { adminPass, recentRaw, subscribe } from "@/lib/storage";

function Home() {
  const router = useRouter();
  const params = useSearchParams();
  const [code, setCode] = useState((params.get("code") ?? "").toUpperCase());
  const raw = useSyncExternalStore(subscribe, recentRaw, () => "[]");
  const recent = useMemo(() => {
    try { return (JSON.parse(raw) as { code: string; name: string }[]).filter((g) => adminPass(g.code)); } catch { return []; }
  }, [raw]);

  const join = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim().length >= 3) router.push(`/play/${code.trim().toUpperCase()}`);
  };

  return (
    <main className="flex-1 skyline-bg text-white">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col px-5 py-8">
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="rounded-3xl bg-white p-5 shadow-2xl anim-pop">
            <Logo className="h-36" />
          </div>
          <h1 className="font-display mt-7 text-4xl font-black leading-[1.05]">Real Estate<br />Shark Tank</h1>
          <p className="mt-3 text-white/70">Start with $1,000,000. Build a portfolio. Survive the market. Out-earn every investor in the room.</p>

          <form onSubmit={join} className="mt-8 w-full space-y-3">
            <label className="block text-left">
              <span className="label !text-white/60">Room code</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6))}
                placeholder="ABCD"
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                className="input mt-1 text-center font-display text-4xl font-black tracking-[0.4em] !py-4"
              />
            </label>
            <button className="btn btn-light w-full !py-4 text-lg" disabled={code.length < 3}>Join the game</button>
          </form>

          <div className="mt-6 w-full">
            <Link href="/admin" className="btn w-full border border-white/30 bg-white/10 hover:bg-white/20">Host a game</Link>
          </div>

          {recent.length > 0 && (
            <div className="mt-6 w-full text-left">
              <div className="label !text-white/50">Your hosted games</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {recent.map((g) => (
                  <Link key={g.code} href={`/admin/${g.code}`} className="rounded-full bg-white/10 px-3 py-1.5 text-sm font-bold hover:bg-white/20">
                    {g.code} <span className="text-white/50">{g.name}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
        <p className="mt-8 text-center text-[0.7rem] tracking-[0.3em] text-white/40">RHO EPSILON IOTA · REAL ESTATE INVESTORS</p>
        <p className="mt-1 text-center text-[0.65rem] text-white/30">Illustrative properties and fictional financial figures for gameplay.</p>
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Home />
    </Suspense>
  );
}
