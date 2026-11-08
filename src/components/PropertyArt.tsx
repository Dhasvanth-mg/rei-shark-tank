"use client";
import { typeMeta } from "@/lib/format";

const hash = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

/** Photo if an image URL is set (and loads), otherwise generated art. */
export function PropertyImage({ src, type, seed, className = "" }: { src?: string | null; type: string; seed: string; className?: string }) {
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <PropertyArt type={type} seed={seed} className="absolute inset-0 h-full w-full" />
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover"
          onError={(e) => { e.currentTarget.style.display = "none"; }} />
      )}
    </div>
  );
}

/** Seeded geometric skyline art per property type so every listing looks distinct. */
export function PropertyArt({ type, seed = "", className = "" }: { type: string; seed?: string; className?: string }) {
  const { color, art } = typeMeta(type);
  const h = hash(seed || type);
  const id = `sky-${h}`;
  const sunX = 30 + (h % 140);
  const tall = 38 + (h % 24);
  const wing = 20 + ((h >> 3) % 20);
  const cols = 2 + ((h >> 5) % 2);
  return (
    <svg viewBox="0 0 200 100" className={className} preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".98" />
          <stop offset="1" stopColor={color} stopOpacity=".5" />
        </linearGradient>
      </defs>
      <rect width="200" height="100" fill={`url(#${id})`} />
      <circle cx={sunX} cy="22" r="13" fill="#fff" opacity=".16" />
      <rect y="92" width="200" height="8" fill="#0b0c0e" opacity=".28" />
      {art === "tower" && (
        <g>
          <rect x="14" y={100 - wing - 24} width="34" height={wing + 24} fill="#fff" opacity=".24" />
          <rect x="152" y={100 - wing - 30} width="34" height={wing + 30} fill="#fff" opacity=".24" />
          <path d={`M78 100V${100 - tall - 30}l22-14 22 14v${tall + 30}z`} fill="#fff" opacity=".94" />
          <path d={`M100 ${100 - tall - 44}l22 14v${tall + 30}h-22z`} fill="#0b0c0e" opacity=".32" />
          {Array.from({ length: 5 }).map((_, i) => (
            <g key={i} fill={color} opacity=".75">
              <rect x="86" y={100 - tall - 22 + i * 14} width="8" height="7" />
              <rect x="106" y={100 - tall - 22 + i * 14} width="8" height="7" />
            </g>
          ))}
        </g>
      )}
      {art === "house" && (
        <g>
          <path d="M0 92c40-8 80-2 120-5s60-2 80 2V100H0z" fill="#fff" opacity=".18" />
          <path d="M40 92V56l60-38 60 38v36z" fill="#fff" opacity=".94" />
          <path d="M30 60l70-46 70 46" fill="none" stroke="#0b0c0e" strokeOpacity=".55" strokeWidth="9" strokeLinejoin="round" />
          <rect x="91" y="64" width="18" height="28" fill={color} />
          {Array.from({ length: cols }).map((_, i) => (
            <g key={i}>
              <rect x={52 + i * 14} y="62" width="11" height="13" fill={color} opacity=".7" />
              <rect x={138 - i * 14} y="62" width="11" height="13" fill={color} opacity=".7" />
            </g>
          ))}
          <rect x="140" y="26" width="9" height="18" fill="#0b0c0e" opacity=".45" />
        </g>
      )}
      {art === "shop" && (
        <g>
          <rect x="14" y="44" width="172" height="48" fill="#fff" opacity=".94" />
          <rect x="14" y="36" width="172" height="14" fill="#0b0c0e" opacity=".5" />
          {Array.from({ length: 6 }).map((_, i) => <rect key={i} x={14 + i * 29} y="36" width="14" height="14" fill="#fff" opacity=".85" />)}
          {Array.from({ length: 3 }).map((_, i) => <rect key={i} x={26 + i * 56} y="58" width="40" height="34" fill={color} opacity=".78" />)}
        </g>
      )}
      {art === "warehouse" && (
        <g>
          <path d="M12 92V44l88-26 88 26v48z" fill="#fff" opacity=".94" />
          {Array.from({ length: 3 }).map((_, i) => (
            <g key={i}>
              <rect x={30 + i * 52} y="58" width="38" height="34" fill={color} opacity=".82" />
              <path d={`M${30 + i * 52} 68h38M${30 + i * 52} 78h38`} stroke="#fff" strokeOpacity=".55" />
            </g>
          ))}
        </g>
      )}
      {art === "land" && (
        <g>
          <path d="M0 74c40-20 80 8 120-6s60-10 80 4v28H0z" fill="#fff" opacity=".32" />
          <path d="M0 86c50-14 90 6 130-4s50-4 70 2v16H0z" fill="#0b0c0e" opacity=".3" />
          <g stroke="#fff" strokeWidth="3" opacity=".9">
            <path d="M60 88V50M60 60l-10-8M60 68l12-10" />
            <path d="M140 86V44M140 56l-11-9M140 66l12-10" />
          </g>
          <path d="M20 90h160" stroke="#fff" strokeDasharray="4 4" opacity=".5" />
        </g>
      )}
    </svg>
  );
}
