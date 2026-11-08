"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** Runs an async action with a busy flag and an auto-dismissing message. */
export function useAct() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flash = useCallback((text: string, bad = false) => {
    setMsg({ text, bad });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), bad ? 4500 : 2200);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  const run = useCallback(
    async (fn: () => Promise<unknown>, ok?: string) => {
      setBusy(true);
      try {
        await fn();
        if (ok) flash(ok);
        return true;
      } catch (e) {
        flash((e as Error).message || "Something went wrong", true);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [flash],
  );

  return { busy, msg, run, flash };
}

export function Toast({ msg }: { msg: { text: string; bad: boolean } | null }) {
  if (!msg) return null;
  return (
    <div
      role="status"
      className={`fixed left-1/2 top-4 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-xl px-4 py-3 text-sm font-bold shadow-xl anim-pop ${
        msg.bad ? "bg-down text-white" : "bg-ink text-white"
      }`}
    >
      {msg.text}
    </div>
  );
}
