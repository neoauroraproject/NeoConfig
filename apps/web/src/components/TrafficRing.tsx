'use client';

type Props = {
  percent: number | null;
  label: string;
  sublabel: string;
};

export function TrafficRing({ percent, label, sublabel }: Props) {
  const size = 180;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const known = percent !== null;
  const p = known ? Math.min(100, Math.max(0, percent)) : 0;
  const offset = c - (p / 100) * c;

  return (
    <div className="relative mx-auto flex h-[180px] w-[180px] items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-white/10"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#trafficGrad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={known ? offset : c}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
        <defs>
          <linearGradient id="trafficGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--brand-primary)" />
            <stop offset="100%" stopColor="var(--brand-accent)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <div className="font-display text-3xl font-semibold tracking-tight">
          {known ? `${Math.round(p)}%` : '—'}
        </div>
        <div className="mt-1 text-sm font-medium">{label}</div>
        <div className="muted mt-0.5 text-xs">{sublabel}</div>
      </div>
    </div>
  );
}
