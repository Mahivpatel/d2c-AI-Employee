interface Props {
  label:    string;
  value:    string | number;
  sub?:     string;
  trend?:   'up' | 'down' | 'neutral';
  color?:   'default' | 'green' | 'red' | 'yellow';
  loading?: boolean;
}

const colorMap = {
  default: 'text-white',
  green:   'text-emerald-400',
  red:     'text-rose-400',
  yellow:  'text-amber-400',
};

const trendIcon = { up: '↑', down: '↓', neutral: '→' };
const trendColor = {
  up:      'text-emerald-400',
  down:    'text-rose-400',
  neutral: 'text-slate-400',
};

export function MetricCard({ label, value, sub, trend, color = 'default', loading }: Props) {
  return (
    <div className="card p-5 flex flex-col gap-2 animate-fade-in">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</p>
      {loading ? (
        <div className="h-8 w-24 bg-surface-border rounded-lg animate-pulse" />
      ) : (
        <p className={`text-2xl font-bold tracking-tight ${colorMap[color]}`}>{value}</p>
      )}
      {(sub || trend) && !loading && (
        <p className="text-xs text-slate-500 flex items-center gap-1">
          {trend && (
            <span className={trendColor[trend]}>{trendIcon[trend]}</span>
          )}
          {sub}
        </p>
      )}
    </div>
  );
}
