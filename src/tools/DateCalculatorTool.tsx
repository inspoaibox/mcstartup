import { useState } from 'react';
import { Copy, Check, Calendar, Clock, Plus, Minus } from 'lucide-react';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';

type Mode = 'diff' | 'add' | 'workday' | 'time';

const MODE_INFO = {
  diff: { name: '日期差', icon: Calendar },
  add: { name: '日期加减', icon: Plus },
  workday: { name: '工作日计算', icon: Clock },
  time: { name: '时间段差', icon: Minus },
};

export default function DateCalculatorTool() {
  const ready = useToolTheme();
  const [mode, setMode] = useState<Mode>('diff');
  const [copied, setCopied] = useState(false);

  // 日期差
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // 日期加减
  const [baseDate, setBaseDate] = useState('');
  const [days, setDays] = useState('');
  const [addMode, setAddMode] = useState<'calendar' | 'workday'>('calendar');
  const [operation, setOperation] = useState<'add' | 'subtract'>('add');

  // 时间段差
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');

  // 工作日设置
  const [workDays, setWorkDays] = useState([1, 2, 3, 4, 5]); // 周一到周五
  const excludeDates: string[] = []; // 排除的日期（未来可扩展）

  const isWorkDay = (date: Date) => {
    const day = date.getDay();
    const dateStr = date.toISOString().split('T')[0];
    return workDays.includes(day) && !excludeDates.includes(dateStr);
  };

  const calculateDateDiff = () => {
    if (!startDate || !endDate) return null;
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const totalDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 包含结束日期

    let workdays = 0;
    let weekends = 0;
    let holidays = 0;

    const current = new Date(start);
    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      const day = current.getDay();

      if (excludeDates.includes(dateStr)) {
        // 被排除的日期算作节假日
        holidays++;
      } else if (day === 0 || day === 6) {
        // 周末
        weekends++;
      } else {
        // 工作日（周一到周五）
        workdays++;
      }

      current.setDate(current.getDate() + 1);
    }

    return { totalDays, workdays, weekends, holidays };
  };

  const calculateDateAdd = () => {
    if (!baseDate || !days) return null;
    const base = new Date(baseDate);
    const daysNum = parseInt(days);
    if (isNaN(daysNum)) return null;

    if (addMode === 'calendar') {
      const result = new Date(base);
      if (operation === 'add') {
        result.setDate(result.getDate() + daysNum);
      } else {
        result.setDate(result.getDate() - daysNum);
      }
      return result.toISOString().split('T')[0];
    } else {
      // 工作日计算
      const result = new Date(base);
      let remaining = daysNum;
      const direction = operation === 'add' ? 1 : -1;

      while (remaining > 0) {
        result.setDate(result.getDate() + direction);
        if (isWorkDay(result)) {
          remaining--;
        }
      }
      return result.toISOString().split('T')[0];
    }
  };

  const calculateWorkdays = () => {
    if (!startDate || !endDate) return null;
    const start = new Date(startDate);
    const end = new Date(endDate);

    let workdays = 0;
    let nonWorkdays = 0;

    const current = new Date(start);
    while (current <= end) {
      if (isWorkDay(current)) {
        workdays++;
      } else {
        nonWorkdays++;
      }
      current.setDate(current.getDate() + 1);
    }

    return { workdays, nonWorkdays };
  };

  const calculateTimeDiff = () => {
    if (!startTime || !endTime) return null;
    const start = new Date(startTime);
    const end = new Date(endTime);
    const diffMs = Math.abs(end.getTime() - start.getTime());

    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const totalHours = (diffMs / (1000 * 60 * 60)).toFixed(2);

    // 工作时长（假设工作时间 9:00-18:00）
    const workStart = 9;
    const workEnd = 18;
    let workHours = 0;

    const current = new Date(start);
    while (current < end) {
      const hour = current.getHours();
      if (hour >= workStart && hour < workEnd && isWorkDay(current)) {
        workHours += 1 / 60; // 每分钟
      }
      current.setMinutes(current.getMinutes() + 1);
    }

    return { hours, minutes, totalHours, workHours: workHours.toFixed(2) };
  };

  const getResult = () => {
    switch (mode) {
      case 'diff':
        return calculateDateDiff();
      case 'add':
        return calculateDateAdd();
      case 'workday':
        return calculateWorkdays();
      case 'time':
        return calculateTimeDiff();
      default:
        return null;
    }
  };

  const result = getResult();

  const copyResult = () => {
    if (!result) return;
    let text = '';
    if (mode === 'diff') {
      const r = result as ReturnType<typeof calculateDateDiff>;
      text = `总天数：${r?.totalDays}\n工作日：${r?.workdays}\n周末：${r?.weekends}\n节假日：${r?.holidays}`;
    } else if (mode === 'add') {
      text = `结果日期：${result}`;
    } else if (mode === 'workday') {
      const r = result as ReturnType<typeof calculateWorkdays>;
      text = `工作日：${r?.workdays}\n非工作日：${r?.nonWorkdays}`;
    } else if (mode === 'time') {
      const r = result as ReturnType<typeof calculateTimeDiff>;
      text = `总时长：${r?.hours}小时${r?.minutes}分钟\n工作时长：${r?.workHours}小时`;
    }
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900 rounded-2xl overflow-hidden">
      <ToolHeader icon="🕒" title="时间差计算" closeMode="hide" />

      {/* 模式切换 */}
      <div className="flex gap-2 p-4 border-b border-gray-200 dark:border-gray-800">
        {(Object.keys(MODE_INFO) as Mode[]).map((m) => {
          const Icon = MODE_INFO[m].icon;
          return (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                mode === m
                  ? 'bg-blue-500 text-white shadow-md'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              <Icon size={16} />
              {MODE_INFO[m].name}
            </button>
          );
        })}
      </div>

      {/* 输入区域 */}
      <div className="flex-1 p-6 overflow-y-auto">
        {mode === 'diff' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                开始日期
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                结束日期
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        )}

        {mode === 'add' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                基准日期
              </label>
              <input
                type="date"
                value={baseDate}
                onChange={(e) => setBaseDate(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setOperation('add')}
                className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  operation === 'add'
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                }`}
              >
                加
              </button>
              <button
                onClick={() => setOperation('subtract')}
                className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  operation === 'subtract'
                    ? 'bg-red-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                }`}
              >
                减
              </button>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                天数
              </label>
              <input
                type="number"
                value={days}
                onChange={(e) => setDays(e.target.value)}
                placeholder="输入天数"
                className="w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setAddMode('calendar')}
                className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  addMode === 'calendar'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                }`}
              >
                自然日
              </button>
              <button
                onClick={() => setAddMode('workday')}
                className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  addMode === 'workday'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                }`}
              >
                工作日
              </button>
            </div>
          </div>
        )}

        {mode === 'workday' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                开始日期
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                结束日期
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                工作日设置
              </label>
              <div className="flex gap-2">
                {['日', '一', '二', '三', '四', '五', '六'].map((day, index) => (
                  <button
                    key={index}
                    onClick={() => {
                      if (workDays.includes(index)) {
                        setWorkDays(workDays.filter((d) => d !== index));
                      } else {
                        setWorkDays([...workDays, index].sort());
                      }
                    }}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      workDays.includes(index)
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                    }`}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {mode === 'time' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                开始时间
              </label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                结束时间
              </label>
              <input
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        )}
      </div>

      {/* 结果区域 */}
      {result && (
        <div className="p-6 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">计算结果</span>
            <button
              onClick={copyResult}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                copied
                  ? 'bg-green-500 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? '已复制' : '复制'}
            </button>
          </div>
          <div className="space-y-2">
            {mode === 'diff' && typeof result === 'object' && 'totalDays' in result && (
              <>
                <ResultItem label="总天数" value={`${result.totalDays} 天`} />
                <ResultItem label="工作日" value={`${result.workdays} 天`} />
                <ResultItem label="周末" value={`${result.weekends} 天`} />
                <ResultItem label="节假日" value={`${result.holidays} 天`} />
              </>
            )}
            {mode === 'add' && typeof result === 'string' && (
              <ResultItem label="结果日期" value={result} highlight />
            )}
            {mode === 'workday' && typeof result === 'object' && 'nonWorkdays' in result && (
              <>
                <ResultItem label="工作日" value={`${result.workdays} 天`} />
                <ResultItem label="非工作日" value={`${result.nonWorkdays} 天`} />
              </>
            )}
            {mode === 'time' && typeof result === 'object' && 'hours' in result && (
              <>
                <ResultItem label="总时长" value={`${result.hours} 小时 ${result.minutes} 分钟`} />
                <ResultItem label="总计" value={`${result.totalHours} 小时`} />
                <ResultItem label="工作时长" value={`${result.workHours} 小时`} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ResultItem({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white dark:bg-gray-900">
      <span className="text-sm text-gray-600 dark:text-gray-400">{label}</span>
      <span
        className={`text-sm font-semibold ${
          highlight ? 'text-blue-600 dark:text-blue-400' : 'text-gray-800 dark:text-gray-200'
        }`}
      >
        {value}
      </span>
    </div>
  );
}
