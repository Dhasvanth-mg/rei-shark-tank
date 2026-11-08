"use client";
import type { Game, Property } from "@/lib/types";
import { RISK_META, money, pct, typeMeta } from "@/lib/format";
import { PropertyImage } from "./PropertyArt";

interface Props {
  p: Property;
  game: Game;
  owned?: { purchase_price: number } | null;
  tradingOpen: boolean;
  cash: number;
  busy: boolean;
  onBuy: () => void;
  onSell: () => void;
}

export function PropertyCard({ p, game, owned, tradingOpen, cash, busy, onBuy, onSell }: Props) {
  const fee = game.phase === "round" ? Math.round(p.current_value * game.fee_rate) : 0;
  const cost = p.current_value + fee;
  const proceeds = p.current_value - fee;
  const stockLeft = p.supply === null ? null : Math.max(0, p.supply - p.owned);
  const soldOut = stockLeft === 0 && !owned;
  const annualRent = p.monthly_rent * game.rent_months;
  const yieldPct = p.current_value ? (annualRent / p.current_value) * 100 : 0;
  const change = ((p.current_value - p.base_price) / p.base_price) * 100;
  const risk = RISK_META[p.risk];
  const gain = owned ? p.current_value - owned.purchase_price : 0;

  return (
    <article className={`card overflow-hidden anim-rise ${owned ? "ring-2 ring-navy" : ""}`}>
      <div className="relative h-36">
        <PropertyImage src={p.image_url} type={p.type} seed={p.property_id} className="absolute inset-0 h-full w-full" />
        <div className="absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-black/45 to-transparent" />
        <div className="absolute left-3 top-3 flex gap-1.5">
          <span className="rounded-full bg-white/95 px-2.5 py-0.5 text-[0.7rem] font-extrabold text-navy-deep">{p.label}</span>
          <span className={`rounded-full px-2.5 py-0.5 text-[0.7rem] font-extrabold ${risk.cls}`}>{risk.label}</span>
        </div>
        {owned && <span className="absolute right-3 top-3 rounded-full bg-navy px-2.5 py-0.5 text-[0.7rem] font-extrabold text-white">OWNED</span>}
        {stockLeft !== null && !owned && (
          <span className={`absolute right-3 top-3 rounded-full px-2.5 py-0.5 text-[0.7rem] font-extrabold ${stockLeft <= 1 ? "bg-down text-white" : "bg-black/70 text-white"}`}>
            {stockLeft === 0 ? "SOLD OUT" : `${stockLeft} left`}
          </span>
        )}
      </div>
      <div className="p-4">
        <h3 className="font-display text-lg font-black leading-tight">{p.name}</h3>
        <p className="text-xs text-steel">{p.location} · {typeMeta(p.type).label}</p>
        <p className="mt-2 text-sm text-ink/80">{p.description}</p>
        {p.highlight && <p className="mt-1 text-xs font-bold text-navy">{p.highlight}</p>}

        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-steel-pale py-2">
            <dt className="label !text-[0.6rem]">Price</dt>
            <dd className="num font-black">{money(p.current_value, { compact: true })}</dd>
            {Math.abs(change) >= 0.1 && <dd className={`num text-[0.7rem] font-bold ${change >= 0 ? "text-up" : "text-down"}`}>{pct(change)}</dd>}
          </div>
          <div className="rounded-lg bg-steel-pale py-2">
            <dt className="label !text-[0.6rem]">Rent / mo</dt>
            <dd className="num font-black">{p.monthly_rent ? money(p.monthly_rent) : "None"}</dd>
          </div>
          <div className="rounded-lg bg-steel-pale py-2">
            <dt className="label !text-[0.6rem]">Gross yield</dt>
            <dd className="num font-black">{yieldPct.toFixed(1)}%</dd>
          </div>
        </dl>

        {owned ? (
          <div className="mt-3">
            <div className="flex justify-between text-xs">
              <span className="text-steel">Bought at {money(owned.purchase_price, { compact: true })}</span>
              <span className={`num font-bold ${gain >= 0 ? "text-up" : "text-down"}`}>{money(gain, { sign: true })}</span>
            </div>
            <button className="btn btn-ghost mt-2 w-full" disabled={!tradingOpen || busy} onClick={onSell}>
              Sell for {money(proceeds)}{fee ? <span className="text-xs font-semibold text-steel">(after {money(fee)} fee)</span> : null}
            </button>
          </div>
        ) : (
          <button className="btn btn-navy mt-3 w-full" disabled={!tradingOpen || busy || soldOut || cost > cash} onClick={onBuy}>
            {soldOut ? "Sold out" : cost > cash && tradingOpen ? `Need ${money(cost - cash, { compact: true })} more` : `Buy for ${money(cost)}`}
            {fee > 0 && cost <= cash && <span className="text-xs font-semibold opacity-70">(incl. {money(fee)} fee)</span>}
          </button>
        )}
      </div>
    </article>
  );
}
