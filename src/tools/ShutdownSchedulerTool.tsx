import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { CalendarDays, Clock, Power, RotateCcw, XCircle } from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';

type Action = 'shutdown' | 'restart';
type ScheduleKind = 'once' | 'daily' | 'weekly';

interface ShutdownStatus {
  active: boolean;
  raw: string;
  taskName: string;
  nextRunTime: string;
  action: string;
  schedule: string;
}

const PRESETS = [
  { label: '15 分钟', minutes: 15 },
  { label: '30 分钟', minutes: 30 },
  { label: '1 小时', minutes: 60 },
  { label: '2 小时', minutes: 120 },
  { label: '今晚 23:30', minutes: -1 },
];

function minutesToTonight() {
  const now = new Date();
  const target = new Date();
  target.setHours(23, 30, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return Math.max(1, Math.ceil((target.getTime() - now.getTime()) / 60000));
}

export default function ShutdownSchedulerTool() {
  const ready = useToolTheme();
  const [action, setAction] = useState<Action>('shutdown');
  const [scheduleKind, setScheduleKind] = useState<ScheduleKind>('once');
  const [minutes, setMinutes] = useState(60);
  const [time, setTime] = useState('23:30');
  const [weekdays, setWeekdays] = useState<string[]>(['Monday']);
  const [message, setMessage] = useState('McStartUP 定时任务');
  const [status, setStatus] = useState<ShutdownStatus | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [nowTick, setNowTick] = useState(Date.now());
  const weekdayOptions = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const refreshStatus = async () => {
    try {
      setStatus(await invoke<ShutdownStatus>('system_shutdown_status'));
    } catch (err) {
      setError(String(err));
    }
  };

  useEffect(() => {
    void refreshStatus();
  }, []);

  const schedule = async () => {
    setError('');
    setNotice('');
    try {
      const result = await invoke<ShutdownStatus>('system_shutdown_task_save', {
        request: {
          action,
          scheduleKind,
          delayMinutes: scheduleKind === 'once' ? Math.max(1, Math.round(minutes)) : undefined,
          time: scheduleKind === 'once' ? undefined : time,
          weekdays: scheduleKind === 'weekly' ? weekdays : undefined,
          message,
        },
      });
      setStatus(result);
      setNotice(`${action === 'shutdown' ? '关机' : '重启'}计划已保存`);
    } catch (err) {
      setError(String(err));
    }
  };

  const cancel = async () => {
    setError('');
    setNotice('');
    try {
      const result = await invoke<ShutdownStatus>('system_shutdown_task_delete');
      setStatus(result);
      setNotice('已取消计划任务');
    } catch (err) {
      setError(String(err));
    }
  };

  const countdown = useMemo(() => {
    if (!status?.nextRunTime) return '';
    const target = new Date(status.nextRunTime).getTime();
    if (!Number.isFinite(target)) return '';
    const diff = target - nowTick;
    if (diff <= 0) return '即将执行';
    const minutesLeft = Math.floor(diff / 60000);
    const secondsLeft = Math.floor((diff % 60000) / 1000);
    return `${minutesLeft} 分 ${secondsLeft} 秒`;
  }, [nowTick, status]);

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader icon="⏻" title="定时关机" subtitle="使用计划任务管理关机/重启计划，支持查询、编辑和取消" />

      <main className="grid min-h-0 flex-1 grid-cols-[360px_minmax(0,1fr)] gap-4 p-4 max-md:grid-cols-1">
        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="grid grid-cols-2 rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-950">
            {(['shutdown', 'restart'] as Action[]).map((item) => (
              <button
                key={item}
                onClick={() => setAction(item)}
                className={`h-9 rounded-md text-sm font-medium ${
                  action === item
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-600 hover:bg-white dark:text-gray-300 dark:hover:bg-gray-800'
                }`}
              >
                {item === 'shutdown' ? '关机' : '重启'}
              </button>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              ['once', '一次性'],
              ['daily', '每日'],
              ['weekly', '每周'],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setScheduleKind(key as ScheduleKind)}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  scheduleKind === key
                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                    : 'border-gray-200 dark:border-gray-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <label className="mt-4 block space-y-2">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Clock size={16} />
              {scheduleKind === 'once' ? '延迟时间' : '执行时间'}
            </span>
            {scheduleKind === 'once' ? (
              <div className="flex rounded-lg border border-gray-200 bg-white focus-within:border-blue-500 dark:border-gray-700 dark:bg-gray-950">
                <input
                  type="number"
                  min={1}
                  value={minutes}
                  onChange={(event) => setMinutes(Math.max(1, Number(event.target.value) || 1))}
                  className="min-w-0 flex-1 rounded-l-lg bg-transparent px-3 py-2 text-sm outline-none"
                />
                <span className="border-l border-gray-200 px-3 py-2 text-sm text-gray-500 dark:border-gray-700">分钟</span>
              </div>
            ) : (
              <div className="flex rounded-lg border border-gray-200 bg-white focus-within:border-blue-500 dark:border-gray-700 dark:bg-gray-950">
                <input
                  type="time"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                  className="min-w-0 flex-1 rounded-lg bg-transparent px-3 py-2 text-sm outline-none"
                />
              </div>
            )}
          </label>

          {scheduleKind === 'once' && (
            <div className="mt-3 flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => setMinutes(preset.minutes > 0 ? preset.minutes : minutesToTonight())}
                  className="rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}

          {scheduleKind === 'weekly' && (
            <div className="mt-3 flex flex-wrap gap-2">
              {weekdayOptions.map((day) => {
                const active = weekdays.includes(day);
                return (
                  <button
                    key={day}
                    onClick={() => setWeekdays((current) => (current.includes(day) ? current.filter((item) => item !== day) : [...current, day]))}
                    className={`rounded-md border px-2.5 py-1.5 text-xs ${
                      active
                        ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          )}

          <label className="mt-4 block space-y-2">
            <span className="text-sm font-medium">提醒文案</span>
            <input
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
            />
          </label>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              onClick={() => void schedule()}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700"
            >
              {action === 'shutdown' ? <Power size={16} /> : <RotateCcw size={16} />}
              创建任务
            </button>
            <button
              onClick={() => void cancel()}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <XCircle size={16} />
              取消任务
            </button>
          </div>
        </section>

        <section className="min-w-0 rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h2 className="text-sm font-semibold">计划预览与当前任务</h2>
          <div className="mt-3 rounded-lg bg-gray-50 p-4 dark:bg-gray-950">
            <p className="text-3xl font-semibold text-blue-600">{scheduleKind === 'once' ? minutes : time}</p>
            <p className="mt-1 text-sm text-gray-500">
              {scheduleKind === 'once' ? `${minutes} 分钟后${action === 'shutdown' ? '关机' : '重启'}` : `${scheduleKind} ${action === 'shutdown' ? '关机' : '重启'}`}
            </p>
          </div>

          <div className="mt-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <CalendarDays size={15} />
              当前计划
            </div>
            <div className="mt-2 text-xs leading-5 text-gray-500">
              {status?.taskName || '暂无自建计划'}
              <br />
              {status?.nextRunTime ? `下次执行：${status.nextRunTime}` : ''}
              <br />
              {countdown ? `倒计时：${countdown}` : ''}
              <br />
              {status?.schedule ? `触发器：${status.schedule}` : ''}
            </div>
            <pre className="mt-3 max-h-48 overflow-auto rounded-lg bg-gray-950 p-3 text-[11px] leading-5 text-gray-100">
              {status?.raw || '暂无可显示的计划信息'}
            </pre>
          </div>

          {(notice || error) && (
            <div
              className={`mt-4 rounded-lg px-3 py-2 text-sm ${
                error
                  ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
                  : 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
              }`}
            >
              {error || notice}
            </div>
          )}

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">系统任务状态</span>
              <button
                onClick={() => void refreshStatus()}
                className="text-xs text-blue-600 hover:text-blue-700"
              >
                刷新
              </button>
            </div>
            <pre className="max-h-64 overflow-auto rounded-lg bg-gray-950 p-3 text-xs text-gray-100">
              {status?.raw || '暂无可显示的 shutdown 计划任务信息'}
            </pre>
          </div>
        </section>
      </main>
    </div>
  );
}
