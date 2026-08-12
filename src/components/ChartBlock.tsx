/**
 * ChartBlock — 解析 AI 返回的 ```chart JSON 代码块，渲染成 Recharts 图表
 *
 * 支持的格式：
 * ```chart
 * {
 *   "type": "bar" | "line" | "pie",
 *   "title": "可选标题",
 *   "data": [{ "name": "A", "value": 10, "value2": 20 }],
 *   "xKey": "name",          // x 轴字段，默认 "name"
 *   "yKeys": ["value"],      // y 轴字段列表，默认取除 xKey 外所有数字字段
 *   "colors": ["#0066ff"]    // 可选颜色列表
 * }
 * ```
 */
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

const DEFAULT_COLORS = [
  '#0066ff',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#f97316',
  '#84cc16',
];

interface ChartSpec {
  type: 'bar' | 'line' | 'pie';
  title?: string;
  data: Record<string, unknown>[];
  xKey?: string;
  yKeys?: string[];
  colors?: string[];
}

function inferYKeys(data: Record<string, unknown>[], xKey: string): string[] {
  if (!data.length) return [];
  return Object.keys(data[0]).filter((k) => k !== xKey && typeof data[0][k] === 'number');
}

export default function ChartBlock({ code }: { code: string }) {
  let spec: ChartSpec;
  try {
    spec = JSON.parse(code);
  } catch {
    return (
      <div className="my-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-600 dark:text-red-400">
        图表数据解析失败：JSON 格式错误
      </div>
    );
  }

  const { type = 'bar', title, data, colors = DEFAULT_COLORS } = spec;
  if (!Array.isArray(data) || data.length === 0) {
    return (
      <div className="my-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
        图表数据为空
      </div>
    );
  }

  const xKey = spec.xKey ?? 'name';
  const yKeys = spec.yKeys?.length ? spec.yKeys : inferYKeys(data, xKey);

  if (yKeys.length === 0) {
    return (
      <div className="my-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
        图表数据中未找到数值字段，请确保数据包含数字类型的值
      </div>
    );
  }

  return (
    <div className="my-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 shadow-sm">
      {title && (
        <p className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300 text-center">
          {title}
        </p>
      )}
      <ResponsiveContainer width="100%" height={260}>
        {type === 'pie' ? (
          <PieChart>
            <Pie
              data={data}
              dataKey={yKeys[0] ?? 'value'}
              nameKey={xKey}
              cx="50%"
              cy="50%"
              outerRadius={90}
              label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={colors[i % colors.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        ) : type === 'line' ? (
          <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" />
            <XAxis dataKey={xKey} tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            {yKeys.length > 1 && <Legend />}
            {yKeys.map((key, i) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={colors[i % colors.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            ))}
          </LineChart>
        ) : (
          <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" />
            <XAxis dataKey={xKey} tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            {yKeys.length > 1 && <Legend />}
            {yKeys.map((key, i) => (
              <Bar key={key} dataKey={key} fill={colors[i % colors.length]} radius={[4, 4, 0, 0]} />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
