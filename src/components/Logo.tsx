"use client";

const swap = (img: HTMLImageElement) => {
  if (!img.src.endsWith("/logo.svg")) img.src = "/logo.svg";
};

/** Uses /logo.png when present (drop the official file in /public), else the bundled SVG mark. */
export function Logo({ className = "h-16", withName = false }: { className?: string; withName?: boolean }) {
  return (
    <span className="inline-flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.png"
        alt="Rho Epsilon Iota Real Estate Investors"
        className={`${className} w-auto object-contain`}
        ref={(el) => { if (el && el.complete && el.naturalWidth === 0) swap(el); }}
        onError={(e) => swap(e.currentTarget)}
      />
      {withName && (
        <span className="font-display leading-none">
          <span className="block text-xl font-black tracking-wide">RHO EPSILON IOTA</span>
          <span className="mt-1 block text-[0.62rem] tracking-[0.35em] opacity-70">REAL ESTATE INVESTORS</span>
        </span>
      )}
    </span>
  );
}
