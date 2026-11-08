"use client";
import { useState } from "react";
import { rpc } from "@/lib/supabase";
import { savePlayerToken } from "@/lib/storage";
import { PRESET_EMOJIS } from "@/lib/format";
import { useAct, Toast } from "@/lib/useAct";
import { EmojiPicker } from "./EmojiPicker";
import { Logo } from "./Logo";

export function JoinForm({ code, gameName, onJoined }: { code: string; gameName: string; onJoined: (token: string) => void }) {
  const [nick, setNick] = useState("");
  const [emoji, setEmoji] = useState(() => PRESET_EMOJIS[Math.floor(Math.random() * 12)]);
  const { busy, msg, run } = useAct();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await run(async () => {
      const r = await rpc<{ token: string }>("join_game", { p_code: code, p_nickname: nick, p_emoji: emoji });
      savePlayerToken(code, r.token);
      onJoined(r.token);
    });
  };

  return (
    <main className="flex-1 skyline-bg text-white">
      <Toast msg={msg} />
      <form onSubmit={submit} className="mx-auto min-h-dvh max-w-md px-5 py-8">
        <div className="flex items-center justify-between">
          <span className="rounded-2xl bg-white p-2"><Logo className="h-12" /></span>
          <div className="text-right">
            <div className="label !text-white/50">Room</div>
            <div className="font-display text-3xl font-black tracking-[0.25em]">{code}</div>
          </div>
        </div>
        <h1 className="font-display mt-8 text-3xl font-black">Join {gameName}</h1>
        <p className="text-white/60">You will start with $1,000,000. Pick a name and a face.</p>

        <div className="mt-6 flex items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white text-5xl">{emoji}</div>
          <label className="flex-1">
            <span className="label !text-white/60">Nickname</span>
            <input
              className="input mt-1 !text-lg !font-bold"
              value={nick}
              onChange={(e) => setNick(e.target.value.slice(0, 20))}
              placeholder="Your name"
              autoFocus
              autoComplete="off"
              maxLength={20}
            />
          </label>
        </div>

        <div className="mt-6 rounded-2xl bg-white/10 p-4">
          <div className="label mb-2 !text-white/60">Profile emoji</div>
          <EmojiPicker value={emoji} onChange={setEmoji} dark />
        </div>

        <button className="btn btn-light mt-6 w-full !py-4 text-lg" disabled={busy || !nick.trim()}>
          {busy ? "Joining…" : "Enter the market"}
        </button>
      </form>
    </main>
  );
}
