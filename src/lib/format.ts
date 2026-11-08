export const money = (n: number, opts: { sign?: boolean; compact?: boolean } = {}) => {
  const abs = Math.abs(Math.round(n));
  let s: string;
  if (opts.compact && abs >= 1_000_000) s = `$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  else if (opts.compact && abs >= 10_000) s = `$${Math.round(abs / 1000)}K`;
  else s = `$${abs.toLocaleString("en-US")}`;
  if (n < 0) return `-${s}`;
  return opts.sign && n > 0 ? `+${s}` : s;
};
export const pct = (n: number, d = 1) => `${n > 0 ? "+" : ""}${n.toFixed(d)}%`;

export const PRESET_EMOJIS = [
  "🦈", "🐺", "🦁", "🐯", "🦅", "🐉", "🦉", "🐻", "🦊", "🐗", "🦍", "🐍",
  "🔥", "💎", "👑", "🚀", "🏆", "💰", "🎩", "🕶️", "🏙️", "🏠", "🏗️", "🔑",
  "😎", "🤑", "😈", "🤠", "🥷", "🧠", "💪", "🍀", "⚡", "🌴", "🎯", "🃏",
];

/** First grapheme if it looks like an emoji, otherwise null. */
export function pickEmoji(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const seg =
    typeof Intl !== "undefined" && "Segmenter" in Intl
      ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)].map((x) => x.segment)
      : Array.from(s);
  const first = seg[0];
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(first) ? first : null;
}

export const TYPE_META: Record<string, { label: string; color: string; art: string }> = {
  student: { label: "Student", color: "#1f3f77", art: "tower" },
  residential: { label: "Residential", color: "#2b5aa8", art: "house" },
  luxury: { label: "Luxury", color: "#0b0c0e", art: "tower" },
  retail: { label: "Retail", color: "#5d6b78", art: "shop" },
  office: { label: "Office", color: "#3b4a5a", art: "tower" },
  industrial: { label: "Industrial", color: "#7a8691", art: "warehouse" },
  vacation: { label: "Vacation", color: "#2b7bb0", art: "house" },
  land: { label: "Land", color: "#4d6b52", art: "land" },
  fixer: { label: "Fixer-upper", color: "#8a5a3b", art: "house" },
};
export const typeMeta = (t: string) => TYPE_META[t] ?? { label: t, color: "#5d6b78", art: "house" };

export const RISK_META = {
  low: { label: "Low risk", cls: "bg-emerald-100 text-emerald-800" },
  medium: { label: "Medium risk", cls: "bg-amber-100 text-amber-800" },
  high: { label: "High risk", cls: "bg-red-100 text-red-800" },
} as const;

export const PHASE_LABEL: Record<string, string> = {
  lobby: "Lobby",
  building: "Build your portfolio",
  round: "Market round",
  round_end: "Round results",
  finished: "Final results",
};

const ARROWS = ["▼▼", "▼", "–", "▲", "▲▲"];
export const arrow = (lvl: number) => ARROWS[lvl + 2];
