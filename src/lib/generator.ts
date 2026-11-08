import { TYPE_META } from "./format";

const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const between = (lo: number, hi: number, round = 1000) => Math.round((lo + Math.random() * (hi - lo)) / round) * round;

// Entirely fictional places so no real listing is implied.
const PLACES = [
  "Maple Hollow", "Brookfield Heights", "Cedar Point", "Willow Bend", "Granite Falls", "Harborview", "Pinecrest", "Lakemont",
  "Redwood Commons", "Silver Creek", "Ashford Park", "Foxglove Lane", "Copper Ridge", "Stonebridge", "Juniper Springs", "Eastgate",
  "Northfield", "Riverbend", "Oakmoor", "Sunset Terrace",
];
const STATES = ["PA", "OH", "IL", "TX", "FL", "NC", "CO", "MI", "GA", "AZ", "TN", "WA"];

interface Spec {
  label: string; names: string[]; price: [number, number]; yieldPct: [number, number]; risk: "low" | "medium" | "high";
  maint: [number, number]; blurbs: string[]; highlights: string[];
}

const SPECS: Record<string, Spec> = {
  residential: { label: "Single-family", names: ["Bungalow", "Colonial", "Ranch Home", "Cottage", "Townhome"], price: [220_000, 520_000], yieldPct: [7, 9], risk: "low", maint: [0.011, 0.014],
    blurbs: ["A tidy family home in a good school district.", "Fresh paint, a fenced yard and tenants who always renew.", "Quiet street, steady demand."], highlights: ["Reliable family tenants", "Beginner friendly"] },
  student: { label: "College rental", names: ["Campus House", "Student Duplex", "Scholars Row", "Dorm-Alternative Flats"], price: [300_000, 520_000], yieldPct: [8.5, 10.5], risk: "medium", maint: [0.012, 0.016],
    blurbs: ["Walking distance to campus with leases that roll every August.", "Rented by the bedroom, always full in the fall."], highlights: ["Built-in student demand"] },
  luxury: { label: "Luxury condo", names: ["Skyline Residence", "Penthouse Suite", "Waterfront Loft", "Tower Condo"], price: [550_000, 950_000], yieldPct: [6.5, 8], risk: "medium", maint: [0.013, 0.017],
    blurbs: ["Floor-to-ceiling windows, a doorman and a rooftop pool.", "High-end finishes and a waitlist of executive renters."], highlights: ["Premium rental income", "Trophy asset"] },
  retail: { label: "Retail plaza", names: ["Shops at", "Market Row", "Corner Plaza", "Storefront Block"], price: [350_000, 750_000], yieldPct: [8.5, 11], risk: "high", maint: [0.017, 0.022],
    blurbs: ["Several storefronts anchored by a local favorite.", "Strip of small businesses on a busy road."], highlights: ["Commercial lease income"] },
  office: { label: "Office", names: ["Office Suites", "Business Center", "Professional Plaza", "Corporate Park"], price: [450_000, 900_000], yieldPct: [8, 10], risk: "high", maint: [0.016, 0.02],
    blurbs: ["Class B office space with a handful of long-term tenants.", "Professional suites near the downtown core."], highlights: ["Corporate lease income"] },
  industrial: { label: "Industrial", names: ["Logistics Warehouse", "Self-Storage Depot", "Flex Bays", "Distribution Hub"], price: [300_000, 700_000], yieldPct: [8, 10], risk: "medium", maint: [0.01, 0.015],
    blurbs: ["Low-maintenance space leased to a regional operator.", "Steady tenants and very little drama."], highlights: ["Low-maintenance cash flow"] },
  vacation: { label: "Vacation rental", names: ["Beach Villa", "Lakeside Cabin", "Mountain Retreat", "Seaside Cottage"], price: [300_000, 750_000], yieldPct: [9, 12], risk: "high", maint: [0.021, 0.026],
    blurbs: ["Booked solid in season, quiet the rest of the year.", "Hot tub, fire pit and five-star reviews."], highlights: ["Seasonal income, weather exposure"] },
  land: { label: "Raw land", names: ["Land Parcel", "Acreage", "Development Lot", "Meadow Tract"], price: [120_000, 320_000], yieldPct: [0, 4], risk: "high", maint: [0.005, 0.008],
    blurbs: ["Undeveloped ground waiting for the next boom.", "No rent, only appreciation."], highlights: ["Pure appreciation play"] },
  fixer: { label: "Fixer-upper", names: ["Victorian Fixer", "Foreclosure Special", "Handyman Special", "Old Farmhouse"], price: [150_000, 300_000], yieldPct: [5, 7], risk: "high", maint: [0.028, 0.035],
    blurbs: ["Good bones, lots of deferred maintenance.", "Buy cheap and hope the market lifts it."], highlights: ["High appreciation potential"] },
};

export function randomProperty(forType?: string) {
  const type = forType && SPECS[forType] ? forType : pick(Object.keys(SPECS));
  const s = SPECS[type];
  const place = pick(PLACES);
  const price = between(s.price[0], s.price[1]);
  const y = s.yieldPct[0] + Math.random() * (s.yieldPct[1] - s.yieldPct[0]);
  const rent = Math.round((price * y) / 100 / 12 / 50) * 50;
  const base = pick(s.names);
  const name = base.endsWith(" at") ? `${base} ${place}` : `${place} ${base}`;
  return {
    name, label: s.label, type, risk: s.risk, price, rent,
    location: `${place}, ${pick(STATES)}`,
    description: pick(s.blurbs), highlight: pick(s.highlights),
    maintenance_rate: +(s.maint[0] + Math.random() * (s.maint[1] - s.maint[0])).toFixed(4),
  };
}

export const GENERATOR_TYPES = Object.keys(TYPE_META);
