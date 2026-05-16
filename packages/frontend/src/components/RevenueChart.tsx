import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

interface DataPoint {
  label:      string;
  revenueInr: number;
  roas:       number | null;
}

interface Props {
  data:    DataPoint[];
  loading: boolean;
}

const tooltipStyle = {
  backgroundColor: '#181c2a',
  border:          '1px solid #252a3d',
  borderRadius:    '12px',
  color:           '#e2e8f0',
  fontSize:        '12px',
};

export function RevenueChart({ data, loading }: Props) {
  if (loading) {
    return (
      <div className="h-60 bg-surface-input rounded-2xl animate-pulse" />
    );
  }

  if (data.length === 0) {
    return (
      <div className="h-60 flex items-center justify-center text-slate-500 text-sm">
        No revenue data for this period
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Revenue bar chart */}
      <div>
        <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-3">Revenue (INR)</p>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#252a3d" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: '#64748b', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: '#64748b', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v: number) => [`₹${v.toLocaleString('en-IN')}`, 'Revenue']}
            />
            <Bar
              dataKey="revenueInr"
              fill="#3a57f2"
              radius={[6, 6, 0, 0]}
              maxBarSize={48}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ROAS line chart */}
      <div>
        <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-3">ROAS Trend</p>
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#252a3d" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: '#64748b', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: '#64748b', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `${v}×`}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v: number) => [`${v}×`, 'ROAS']}
            />
            <Legend wrapperStyle={{ fontSize: '11px', color: '#64748b' }} />
            <Line
              type="monotone"
              dataKey="roas"
              stroke="#34d399"
              strokeWidth={2}
              dot={{ fill: '#34d399', r: 3 }}
              activeDot={{ r: 5 }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
