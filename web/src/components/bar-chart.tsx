type BarSeries = {
  label: string;
  tone: "brand" | "money" | "attention" | "neutral" | "muted";
};

type BarRow = {
  label: string;
  values: number[];
};

const FILL: Record<BarSeries["tone"], string> = {
  brand: "var(--tone-info)",
  money: "var(--tone-money)",
  attention: "var(--tone-attention)",
  neutral: "var(--tone-series)",
  muted: "var(--fg-3)",
};

export function BarChart({
  title,
  series,
  rows,
}: {
  title: string;
  series: BarSeries[];
  rows: BarRow[];
}) {
  const max = Math.max(1, ...rows.flatMap((row) => row.values));
  const width = 640;
  const height = 200;
  const pad = { left: 8, right: 8, top: 16, bottom: 32 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const groupW = rows.length ? innerW / rows.length : innerW;
  const barW = Math.min(22, Math.max(8, (groupW - 16) / Math.max(series.length, 1)));

  return (
    <div className="space-y-3 rounded-2xl border border-separator1 bg-bg1 p-4">
      <p className="text-sm text-fg1">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-fg3">Sin datos todavía.</p>
      ) : (
        <svg viewBox={`0 0 ${width} ${height}`} className="h-52 w-full" role="img" aria-label={title}>
          {rows.map((row, group) => {
            const groupX = pad.left + group * groupW;
            const barsW = series.length * barW + (series.length - 1) * 4;
            const startX = groupX + (groupW - barsW) / 2;
            return (
              <g key={row.label}>
                {row.values.map((value, index) => {
                  const h = (value / max) * innerH;
                  const x = startX + index * (barW + 4);
                  const y = pad.top + innerH - h;
                  return (
                    <rect
                      key={series[index]?.label || index}
                      x={x}
                      y={y}
                      width={barW}
                      height={Math.max(h, value > 0 ? 2 : 0)}
                      rx={4}
                      fill={FILL[series[index]?.tone || "brand"]}
                    >
                      <title>{`${series[index]?.label || ""}: ${value}`}</title>
                    </rect>
                  );
                })}
                <text
                  x={groupX + groupW / 2}
                  y={height - 10}
                  textAnchor="middle"
                  fill="var(--fg-3)"
                  fontSize="11"
                >
                  {row.label}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      <div className="flex flex-wrap gap-4 text-sm text-fg3">
        {series.map((item) => (
          <span key={item.label} className="inline-flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: FILL[item.tone] }} />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}
