"use client";
import type { PlayerRow, RoundResult } from "@/lib/types";
import { money } from "@/lib/format";
import { Avatar } from "./EmojiPicker";

interface Props {
  players: PlayerRow[];
  results: RoundResult[];
  startingCash: number;
  meId?: string;
  limit?: number;
  big?: boolean;
  hideScores?: boolean;
}

/** Net-worth leaderboard with change since the previous settled round. */
export function Leaderboard({ players, results, startingCash, meId, limit, big = false, hideScores = false }: Props) {
  const lastRound = results.reduce((m, r) => Math.max(m, r.round), -1);
  const prev = new Map(results.filter((r) => r.round === lastRound - 1).map((r) => [r.player_id, r]));
  const rows = limit ? players.slice(0, limit) : players;
  const max = Math.max(...players.map((p) => p.net_worth), startingCash);
  const min = Math.min(...players.map((p) => p.net_worth), startingCash);
  const span = Math.max(1, max - min * 0.9);

  if (!players.length) return <p className="text-steel text-center py-6">No investors yet.</p>;

  return (
    <ol className="space-y-2">
      {rows.map((p) => {
        const delta = p.net_worth - startingCash;
        const before = prev.get(p.id);
        const moved = before ? before.rank - p.rank : 0;
        const width = hideScores ? 0 : Math.max(4, ((p.net_worth - min * 0.9) / span) * 100);
        return (
          <li
            key={p.id}
            className={`relative overflow-hidden rounded-xl border text-ink ${p.id === meId ? "border-navy bg-navy/5" : "border-steel-light bg-white"} ${big ? "px-5 py-3" : "px-3 py-2"} anim-rise`}
          >
            <div className="absolute inset-y-0 left-0 bg-steel-pale -z-0" style={{ width: `${width}%` }} />
            <div className="relative flex items-center gap-3">
              <span className={`font-display font-black text-navy num text-center ${big ? "w-12 text-3xl" : "w-8 text-xl"}`}>
                {hideScores ? "?" : p.rank}
              </span>
              <Avatar emoji={p.emoji} size={big ? 52 : 38} />
              <div className="min-w-0 flex-1">
                <div className={`truncate font-extrabold ${big ? "text-2xl" : "text-base"}`}>
                  {p.nickname} {p.id === meId && <span className="text-xs font-bold text-navy">(you)</span>}
                  {p.is_bot && <span className="ml-1 text-[0.65rem] font-bold text-steel align-middle">BOT</span>}
                </div>
                <div className={`text-steel ${big ? "text-base" : "text-xs"}`}>{p.props} {p.props === 1 ? "property" : "properties"}</div>
              </div>
              {!hideScores && (
                <div className="text-right">
                  <div className={`font-black num ${big ? "text-3xl" : "text-lg"}`}>{money(p.net_worth)}</div>
                  <div className={`num font-bold ${delta >= 0 ? "text-up" : "text-down"} ${big ? "text-base" : "text-xs"}`}>
                    {delta >= 0 ? "▲" : "▼"} {money(Math.abs(delta))}
                    {moved !== 0 && <span className="ml-2 text-steel">{moved > 0 ? `↑${moved}` : `↓${-moved}`}</span>}
                  </div>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
