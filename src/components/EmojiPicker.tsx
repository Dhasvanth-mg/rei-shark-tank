"use client";
import { useState } from "react";
import { PRESET_EMOJIS, pickEmoji } from "@/lib/format";

/** Pick a preset emoji or type/paste/keyboard-pick any emoji of your own. */
export function EmojiPicker({ value, onChange, dark = false }: { value: string; onChange: (e: string) => void; dark?: boolean }) {
  const [custom, setCustom] = useState("");
  const [bad, setBad] = useState(false);

  const onCustom = (v: string) => {
    setCustom(v);
    if (!v.trim()) { setBad(false); return; }
    const e = pickEmoji(v);
    setBad(!e);
    if (e) onChange(e);
  };

  return (
    <div>
      <div className="grid grid-cols-6 sm:grid-cols-9 gap-1.5">
        {PRESET_EMOJIS.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => { onChange(e); setCustom(""); setBad(false); }}
            aria-label={`Use ${e}`}
            aria-pressed={value === e}
            className={`aspect-square rounded-xl text-2xl flex items-center justify-center transition active:scale-90 ${
              value === e
                ? "bg-navy text-white ring-2 ring-navy ring-offset-2 scale-105"
                : dark ? "bg-white/10 hover:bg-white/20" : "bg-steel-pale hover:bg-steel-light"
            }`}
          >
            {e}
          </button>
        ))}
      </div>
      <label className="mt-3 flex items-center gap-2">
        <span className="label whitespace-nowrap">Or your own</span>
        <input
          value={custom}
          onChange={(e) => onCustom(e.target.value)}
          placeholder="Tap and use your emoji keyboard 😀"
          className="input !py-2"
          aria-invalid={bad}
        />
      </label>
      {bad && <p className="text-xs text-down mt-1">That does not look like an emoji. Try another.</p>}
    </div>
  );
}

export function Avatar({ emoji, size = 40, className = "" }: { emoji: string; size?: number; className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-steel-pale ring-1 ring-steel-light ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.58, lineHeight: 1 }}
      aria-hidden
    >
      {emoji}
    </span>
  );
}
