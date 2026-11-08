import type { GameEvent, Property, RoundLog } from "@/lib/types";
import { arrow, money, pct, typeMeta } from "@/lib/format";

const tone = (lvl: number, invert = false) => {
  const good = invert ? lvl < 0 : lvl > 0;
  const bad = invert ? lvl > 0 : lvl < 0;
  return good ? "text-up" : bad ? "text-down" : "text-steel";
};

/** Announced event: headline plus qualitative direction per property type (magnitudes stay secret until settlement). */
export function EventCard({ event, big = false, dark = false }: { event: GameEvent; big?: boolean; dark?: boolean }) {
  const hints = event.hints.filter((h) => h.v || h.r || h.m);
  return (
    <div className={`rounded-2xl p-5 anim-pop ${dark ? "bg-white/10 text-white" : "bg-navy-ink text-white"} ${big ? "p-8" : ""}`}>
      <div className="flex items-start gap-4">
        <div className={big ? "text-7xl" : "text-5xl"}>{event.emoji}</div>
        <div>
          <div className="label !text-white/60">Market event</div>
          <h3 className={`font-display font-black leading-tight ${big ? "text-5xl" : "text-2xl"}`}>{event.title}</h3>
          <p className={`mt-1 text-white/80 ${big ? "text-2xl" : "text-sm"}`}>{event.headline}</p>
        </div>
      </div>
      {event.description && <p className={`mt-3 text-white/60 ${big ? "text-xl" : "text-sm"}`}>{event.description}</p>}
      <div className={`mt-4 grid gap-2 ${big ? "grid-cols-3" : "grid-cols-2"}`}>
        {hints.map((h) => (
          <div key={h.type} className={`rounded-xl bg-white px-3 py-2 text-ink ${big ? "text-lg" : "text-sm"}`}>
            <div className="font-extrabold">{typeMeta(h.type).label}</div>
            <div className="flex gap-3 num font-bold">
              {h.v !== 0 && <span className={tone(h.v)} title="Value">Value {arrow(h.v)}</span>}
              {h.r !== 0 && <span className={tone(h.r)} title="Rent">Rent {arrow(h.r)}</span>}
              {h.m !== 0 && <span className={tone(h.m, true)} title="Maintenance">Repairs {h.m > 0 ? "▲" : "▼"}</span>}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-white/50">Exact impact is revealed when the round ends. Sell, hold or reinvest before then.</p>
    </div>
  );
}

export function RoundRecap({ log, properties, big = false }: { log: RoundLog; properties: Property[]; big?: boolean }) {
  const byId = new Map(properties.map((p) => [p.property_id, p]));
  const rows = [...log.changes].sort((a, b) => b.value_pct - a.value_pct);
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className={big ? "text-4xl" : "text-2xl"}>{log.event.emoji}</span>
        <div>
          <div className="label">Round {log.round} impact</div>
          <div className={`font-display font-black ${big ? "text-3xl" : "text-lg"}`}>{log.event.title}</div>
        </div>
      </div>
      <ul className={`divide-y divide-steel-light ${big ? "text-lg" : "text-sm"}`}>
        {rows.map((c) => {
          const p = byId.get(c.property_id);
          if (!p) return null;
          return (
            <li key={c.property_id} className="flex items-center justify-between py-1.5 gap-3">
              <span className="truncate font-bold">{p.name}</span>
              <span className="num text-right whitespace-nowrap">
                <span className={`font-extrabold ${c.value_pct >= 0 ? "text-up" : "text-down"}`}>{pct(c.value_pct)}</span>
                <span className="text-steel ml-2">{money(c.new_value, { compact: true })}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
