"use client";

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function Timer({ seconds, paused = false, big = false, label }: { seconds: number | null; paused?: boolean; big?: boolean; label?: string }) {
  if (seconds === null) return null;
  const urgent = !paused && seconds <= 10;
  return (
    <div
      className={`inline-flex flex-col items-center rounded-2xl ${urgent ? "bg-down text-white timer-urgent" : "bg-navy-ink text-white"} ${
        big ? "px-10 py-5" : "px-4 py-2"
      }`}
      role="timer"
      aria-live="off"
    >
      {label && <span className="label !text-white/60">{label}</span>}
      <span className={`font-display font-black num ${big ? "text-7xl" : "text-3xl"}`}>{mmss(seconds)}</span>
      {paused && <span className="text-xs font-bold tracking-widest text-amber-300">PAUSED</span>}
    </div>
  );
}
