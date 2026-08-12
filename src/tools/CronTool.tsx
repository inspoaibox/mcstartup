import { useState, useEffect } from 'react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { Copy, ArrowRight } from 'lucide-react';
import cronstrue from 'cronstrue/i18n';
import { CronExpressionParser } from 'cron-parser';

// ── 解析工具函数 ──────────────────────────────────────────────────────────────

function getDescription(expr: string): string {
  try {
    return cronstrue.toString(expr, { locale: 'zh_CN', throwExceptionOnParseError: true });
  } catch {
    return '';
  }
}

function getNextRuns(expr: string, count = 8): string[] {
  try {
    const interval = CronExpressionParser.parse(expr);
    const results: string[] = [];
    for (let i = 0; i < count; i++) {
      results.push(interval.next().toDate().toLocaleString('zh-CN'));
    }
    return results;
  } catch {
    return [];
  }
}

// ── 生成器状态 ────────────────────────────────────────────────────────────────

type FreqType = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'custom';

interface GenState {
  freq: FreqType;
  // 每 N 分钟
  everyMinute: number;
  // 每 N 小时，在第 M 分钟
  everyHour: number;
  hourMinute: number;
  // 每天，在 HH:MM
  dayHour: number;
  dayMinute: number;
  // 每周，星期几，在 HH:MM
  weekDays: number[]; // 0=周日
  weekHour: number;
  weekMinute: number;
  // 每月，第几天，在 HH:MM
  monthDay: number;
  monthHour: number;
  monthMinute: number;
}

const DEFAULT_GEN: GenState = {
  freq: 'day',
  everyMinute: 5,
  everyHour: 1,
  hourMinute: 0,
  dayHour: 9,
  dayMinute: 0,
  weekDays: [1],
  weekHour: 9,
  weekMinute: 0,
  monthDay: 1,
  monthHour: 9,
  monthMinute: 0,
};

const WEEK_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function buildExpr(g: GenState): string {
  const pad = (n: number) => String(n);
  switch (g.freq) {
    case 'minute':
      return `*/${g.everyMinute} * * * *`;
    case 'hour':
      return `${pad(g.hourMinute)} */${g.everyHour} * * *`;
    case 'day':
      return `${pad(g.dayMinute)} ${pad(g.dayHour)} * * *`;
    case 'week': {
      const days = g.weekDays.length > 0 ? g.weekDays.join(',') : '1';
      return `${pad(g.weekMinute)} ${pad(g.weekHour)} * * ${days}`;
    }
    case 'month':
      return `${pad(g.monthMinute)} ${pad(g.monthHour)} ${pad(g.monthDay)} * *`;
    default:
      return '';
  }
}

// ── 快捷预设 ──────────────────────────────────────────────────────────────────

const PRESETS = [
  { label: '每分钟', expr: '* * * * *' },
  { label: '每5分钟', expr: '*/5 * * * *' },
  { label: '每15分钟', expr: '*/15 * * * *' },
  { label: '每小时', expr: '0 * * * *' },
  { label: '每天9点', expr: '0 9 * * *' },
  { label: '每天凌晨', expr: '0 0 * * *' },
  { label: '工作日9点', expr: '0 9 * * 1-5' },
  { label: '每周一', expr: '0 0 * * 1' },
  { label: '每月1号', expr: '0 0 1 * *' },
  { label: '每季度', expr: '0 0 1 */3 *' },
];

// ── 主组件 ────────────────────────────────────────────────────────────────────

export default function CronTool() {
  useToolTheme();
  const [tab, setTab] = useState<'generate' | 'parse'>('generate');
  const [gen, setGen] = useState<GenState>({ ...DEFAULT_GEN });
  const [parseExpr, setParseExpr] = useState('*/5 * * * *');
  const [copied, setCopied] = useState(false);

  // 生成器产生的表达式
  const generatedExpr = gen.freq === 'custom' ? parseExpr : buildExpr(gen);

  // 当前要解析的表达式（生成模式用生成的，解析模式用输入的）
  const activeExpr = tab === 'generate' ? generatedExpr : parseExpr;
  const description = getDescription(activeExpr);
  const nextRuns = getNextRuns(activeExpr);
  const isValid = description !== '';

  function copy(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function updateGen(patch: Partial<GenState>) {
    setGen((prev) => ({ ...prev, ...patch }));
  }

  function toggleWeekDay(d: number) {
    setGen((prev) => ({
      ...prev,
      weekDays: prev.weekDays.includes(d)
        ? prev.weekDays.filter((x) => x !== d)
        : [...prev.weekDays, d].sort(),
    }));
  }

  // 切换到生成模式时，把生成的表达式同步到解析框
  useEffect(() => {
    if (tab === 'parse' && gen.freq !== 'custom') {
      setParseExpr(generatedExpr);
    }
  }, [tab]);

  const numInput = (val: number, min: number, max: number, onChange: (v: number) => void) => (
    <input
      type="number"
      min={min}
      max={max}
      value={val}
      onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value))))}
      className="w-16 px-2 py-1 rounded-lg border text-sm text-center outline-none bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white focus:border-blue-500"
    />
  );

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white">
      <ToolHeader title="Cron 表达式" icon="⏰" />
      <div className="flex-1 overflow-hidden flex">
        {/* 左侧：生成器 / 解析器 */}
        <div className="flex-1 flex flex-col min-w-0 border-r border-gray-200 dark:border-gray-700">
          {/* Tab */}
          <div className="flex border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            {(['generate', 'parse'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                  tab === t
                    ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                {t === 'generate' ? '🛠 可视化生成' : '🔍 表达式解析'}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {tab === 'generate' ? (
              <>
                {/* 频率选择 */}
                <div className="rounded-xl border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 p-4 space-y-4">
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    执行频率
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {(
                      [
                        { id: 'minute', label: '按分钟' },
                        { id: 'hour', label: '按小时' },
                        { id: 'day', label: '每天' },
                        { id: 'week', label: '每周' },
                        { id: 'month', label: '每月' },
                      ] as const
                    ).map((f) => (
                      <button
                        key={f.id}
                        onClick={() => updateGen({ freq: f.id })}
                        className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                          gen.freq === f.id
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  {/* 按分钟 */}
                  {gen.freq === 'minute' && (
                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                      <span>每隔</span>
                      {numInput(gen.everyMinute, 1, 59, (v) => updateGen({ everyMinute: v }))}
                      <span>分钟执行一次</span>
                    </div>
                  )}

                  {/* 按小时 */}
                  {gen.freq === 'hour' && (
                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 flex-wrap">
                      <span>每隔</span>
                      {numInput(gen.everyHour, 1, 23, (v) => updateGen({ everyHour: v }))}
                      <span>小时，在第</span>
                      {numInput(gen.hourMinute, 0, 59, (v) => updateGen({ hourMinute: v }))}
                      <span>分钟执行</span>
                    </div>
                  )}

                  {/* 每天 */}
                  {gen.freq === 'day' && (
                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                      <span>每天</span>
                      {numInput(gen.dayHour, 0, 23, (v) => updateGen({ dayHour: v }))}
                      <span>时</span>
                      {numInput(gen.dayMinute, 0, 59, (v) => updateGen({ dayMinute: v }))}
                      <span>分执行</span>
                    </div>
                  )}

                  {/* 每周 */}
                  {gen.freq === 'week' && (
                    <div className="space-y-3">
                      <div className="flex gap-1.5 flex-wrap">
                        {WEEK_LABELS.map((label, i) => (
                          <button
                            key={i}
                            onClick={() => toggleWeekDay(i)}
                            className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                              gen.weekDays.includes(i)
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                        <span>在</span>
                        {numInput(gen.weekHour, 0, 23, (v) => updateGen({ weekHour: v }))}
                        <span>时</span>
                        {numInput(gen.weekMinute, 0, 59, (v) => updateGen({ weekMinute: v }))}
                        <span>分执行</span>
                      </div>
                    </div>
                  )}

                  {/* 每月 */}
                  {gen.freq === 'month' && (
                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 flex-wrap">
                      <span>每月第</span>
                      {numInput(gen.monthDay, 1, 31, (v) => updateGen({ monthDay: v }))}
                      <span>天，</span>
                      {numInput(gen.monthHour, 0, 23, (v) => updateGen({ monthHour: v }))}
                      <span>时</span>
                      {numInput(gen.monthMinute, 0, 59, (v) => updateGen({ monthMinute: v }))}
                      <span>分执行</span>
                    </div>
                  )}
                </div>

                {/* 生成结果 */}
                <div className="rounded-xl border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 p-4">
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
                    生成的表达式
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400 font-mono text-base font-bold tracking-widest">
                      {generatedExpr}
                    </code>
                    <button
                      onClick={() => copy(generatedExpr)}
                      className="px-3 py-2 text-gray-400 hover:text-blue-500 border border-gray-200 dark:border-gray-600 rounded-lg transition-colors"
                    >
                      {copied ? (
                        <span className="text-green-500 text-xs">✓</span>
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                  </div>
                </div>

                {/* 快捷预设 */}
                <div className="rounded-xl border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 p-4">
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
                    快捷预设
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {PRESETS.map((p) => (
                      <button
                        key={p.expr}
                        onClick={() => {
                          updateGen({ freq: 'custom' });
                          setParseExpr(p.expr);
                          setTab('parse');
                        }}
                        className="px-2.5 py-1 text-xs rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-600 transition-colors"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 使用教程 */}
                <CronGuide />
              </>
            ) : (
              <>
                {/* 解析输入 */}
                <div className="rounded-xl border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 p-4 space-y-3">
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    输入表达式
                  </div>
                  <div className="flex gap-2">
                    <input
                      className="flex-1 px-3 py-2 rounded-lg border text-sm font-mono outline-none bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white focus:border-blue-500"
                      value={parseExpr}
                      onChange={(e) => setParseExpr(e.target.value)}
                      placeholder="* * * * *"
                      spellCheck={false}
                    />
                    <button
                      onClick={() => copy(parseExpr)}
                      className="px-3 py-2 text-gray-400 hover:text-blue-500 border border-gray-200 dark:border-gray-600 rounded-lg"
                    >
                      {copied ? (
                        <span className="text-green-500 text-xs">✓</span>
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                  </div>

                  {/* 字段标注 */}
                  <div className="flex gap-2">
                    {['分钟', '小时', '日', '月', '星期'].map((label, i) => {
                      const parts = parseExpr.split(' ');
                      const val = parts[i] || '*';
                      return (
                        <div key={i} className="flex-1 text-center">
                          <div
                            className={`text-xs font-mono px-1.5 py-1 rounded ${
                              val !== '*'
                                ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-400'
                            }`}
                          >
                            {val}
                          </div>
                          <div className="text-[10px] text-gray-400 mt-0.5">{label}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 快捷预设 */}
                <div className="flex gap-1.5 flex-wrap">
                  {PRESETS.map((p) => (
                    <button
                      key={p.expr}
                      onClick={() => setParseExpr(p.expr)}
                      className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                        parseExpr === p.expr
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-600'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {/* 语法说明 */}
                <div className="rounded-xl border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 p-4">
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                    语法
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    {[
                      ['*', '任意值'],
                      ['*/n', '每隔 n'],
                      ['n', '固定值'],
                      ['n-m', 'n 到 m'],
                      ['n,m', 'n 或 m'],
                      ['1-5', '周一到周五'],
                    ].map(([s, d]) => (
                      <div key={s} className="flex gap-2">
                        <code className="font-mono text-blue-600 dark:text-blue-400 w-10 flex-shrink-0">
                          {s}
                        </code>
                        <span className="text-gray-500 dark:text-gray-400">{d}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* 右侧：解析结果 */}
        <div className="w-72 flex-shrink-0 flex flex-col bg-white dark:bg-gray-800">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              解析结果
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* 当前表达式 */}
            <div className="text-center">
              <code className="text-lg font-mono font-bold text-blue-600 dark:text-blue-400 tracking-widest">
                {activeExpr}
              </code>
            </div>

            {/* 描述 */}
            {isValid ? (
              <div className="px-4 py-3 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                <div className="text-[10px] text-green-600 dark:text-green-400 mb-1 font-medium">
                  执行规则
                </div>
                <div className="text-sm font-medium text-green-800 dark:text-green-300">
                  {description}
                </div>
              </div>
            ) : (
              <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-600 dark:text-red-400">
                表达式格式错误
              </div>
            )}

            {/* 下次执行时间 */}
            {nextRuns.length > 0 && (
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                  <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    下次执行（前8次）
                  </span>
                </div>
                <div className="divide-y divide-gray-50 dark:divide-gray-700/50">
                  {nextRuns.map((t, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-1.5">
                      <span className="text-[10px] text-gray-300 dark:text-gray-600 w-4 text-right flex-shrink-0">
                        {i + 1}
                      </span>
                      <ArrowRight
                        size={9}
                        className="text-gray-300 dark:text-gray-600 flex-shrink-0"
                      />
                      <span className="text-xs font-mono text-gray-600 dark:text-gray-400">
                        {t}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 使用教程组件 ──────────────────────────────────────────────────────────────

function CronGuide() {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-base">📖</span>
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Cron 使用教程（小白必读）
          </span>
        </div>
        <span className="text-gray-400 text-xs">{open ? '收起 ▲' : '展开 ▼'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-5 border-t border-gray-100 dark:border-gray-700 pt-4">
          {/* 什么是 Cron */}
          <section>
            <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2 flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-[10px] flex items-center justify-center font-bold">
                1
              </span>
              什么是 Cron 表达式？
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              Cron 是 Linux/Unix 系统的定时任务调度器。Cron 表达式是一串由 5
              个字段组成的字符串，用来描述"什么时候执行任务"。 广泛用于服务器定时任务、CI/CD
              流水线、云函数触发器等场景。
            </p>
          </section>

          {/* 5 个字段 */}
          <section>
            <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2 flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-[10px] flex items-center justify-center font-bold">
                2
              </span>
              5 个字段的含义
            </h3>
            <div className="rounded-lg overflow-hidden border border-gray-100 dark:border-gray-700">
              <div className="grid grid-cols-5 bg-gray-50 dark:bg-gray-700/50 text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase">
                {['分钟', '小时', '日', '月', '星期'].map((f) => (
                  <div
                    key={f}
                    className="px-2 py-1.5 text-center border-r last:border-0 border-gray-100 dark:border-gray-700"
                  >
                    {f}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-5 text-[10px] text-center">
                {[
                  ['0-59', '0-23', '1-31', '1-12', '0-7'],
                  ['每分钟', '每小时', '每天', '每月', '每周'],
                ].map((row, ri) => (
                  <div key={ri} className="contents">
                    {row.map((cell, ci) => (
                      <div
                        key={ci}
                        className={`px-2 py-1.5 border-r last:border-0 border-gray-50 dark:border-gray-700/50 ${ri === 0 ? 'font-mono text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-900/10' : 'text-gray-400 dark:text-gray-500'}`}
                      >
                        {cell}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <p className="text-[10px] text-gray-400 mt-1.5">
              💡 星期：0 和 7 都代表周日，1=周一，2=周二，以此类推
            </p>
          </section>

          {/* 特殊字符 */}
          <section>
            <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2 flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-[10px] flex items-center justify-center font-bold">
                3
              </span>
              特殊字符说明
            </h3>
            <div className="space-y-1.5">
              {[
                {
                  sym: '*',
                  color: 'text-purple-600 dark:text-purple-400',
                  title: '任意值',
                  desc: '匹配该字段的所有可能值',
                  eg: '分钟字段写 * 表示每分钟',
                },
                {
                  sym: '*/n',
                  color: 'text-blue-600 dark:text-blue-400',
                  title: '每隔 n',
                  desc: '从起始值开始，每隔 n 执行一次',
                  eg: '*/5 表示每隔5个单位（如每5分钟）',
                },
                {
                  sym: 'n-m',
                  color: 'text-green-600 dark:text-green-400',
                  title: '范围',
                  desc: '从 n 到 m 的连续范围',
                  eg: '1-5 在星期字段表示周一到周五',
                },
                {
                  sym: 'n,m',
                  color: 'text-amber-600 dark:text-amber-400',
                  title: '列举',
                  desc: '指定多个离散值',
                  eg: '1,3,5 在星期字段表示周一、三、五',
                },
              ].map((item) => (
                <div
                  key={item.sym}
                  className="flex gap-3 items-start p-2.5 rounded-lg bg-gray-50 dark:bg-gray-700/30"
                >
                  <code className={`font-mono font-bold text-sm w-10 flex-shrink-0 ${item.color}`}>
                    {item.sym}
                  </code>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-gray-700 dark:text-gray-300">
                      {item.title}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{item.desc}</div>
                    <div className="text-[10px] text-blue-500 dark:text-blue-400 mt-0.5">
                      例：{item.eg}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 实际场景示例 */}
          <section>
            <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2 flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-[10px] flex items-center justify-center font-bold">
                4
              </span>
              实际场景示例
            </h3>
            <div className="space-y-1.5">
              {[
                { expr: '0 2 * * *', scene: '每天凌晨2点备份数据库' },
                { expr: '*/10 * * * *', scene: '每10分钟检查一次服务健康状态' },
                { expr: '0 9 * * 1-5', scene: '工作日每天早上9点发送日报邮件' },
                { expr: '0 0 1 * *', scene: '每月1号凌晨生成月度报表' },
                { expr: '30 23 * * 5', scene: '每周五晚上11:30执行周末维护' },
                { expr: '0 */6 * * *', scene: '每6小时同步一次数据' },
                { expr: '0 8,12,18 * * *', scene: '每天8点、12点、18点推送通知' },
              ].map((item) => (
                <div
                  key={item.expr}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
                >
                  <code className="font-mono text-xs text-blue-600 dark:text-blue-400 w-36 flex-shrink-0">
                    {item.expr}
                  </code>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{item.scene}</span>
                </div>
              ))}
            </div>
          </section>

          {/* 使用场景 */}
          <section>
            <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2 flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-[10px] flex items-center justify-center font-bold">
                5
              </span>
              在哪里使用 Cron 表达式？
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: '🐧', name: 'Linux crontab', desc: 'crontab -e 编辑定时任务' },
                { icon: '☁️', name: '云函数触发器', desc: '阿里云/腾讯云/AWS Lambda' },
                { icon: '🔄', name: 'CI/CD 流水线', desc: 'GitHub Actions / Jenkins' },
                { icon: '🗄️', name: '数据库任务', desc: 'MySQL Event / PostgreSQL' },
                { icon: '🐳', name: 'Docker/K8s', desc: 'CronJob 定时容器任务' },
                { icon: '📦', name: 'Node.js', desc: 'node-cron / agenda 等库' },
              ].map((item) => (
                <div
                  key={item.name}
                  className="flex items-start gap-2 p-2.5 rounded-lg bg-gray-50 dark:bg-gray-700/30"
                >
                  <span className="text-base flex-shrink-0">{item.icon}</span>
                  <div>
                    <div className="text-xs font-medium text-gray-700 dark:text-gray-300">
                      {item.name}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 注意事项 */}
          <section className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3">
            <div className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1.5">
              ⚠️ 注意事项
            </div>
            <ul className="space-y-1 text-[11px] text-amber-700 dark:text-amber-400">
              <li>• Cron 表达式基于服务器时区，注意时区差异</li>
              <li>• 标准 Cron 最小粒度是分钟，不支持秒级调度</li>
              <li>• 部分系统（如 Quartz）支持 6 位（含秒）或 7 位（含年）格式</li>
              <li>• 日和星期同时指定时，不同系统行为可能不同</li>
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
