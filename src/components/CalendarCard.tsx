import { useState, useMemo } from 'react';
import { Solar, HolidayUtil } from 'lunar-javascript';

interface CalendarCardProps {
  date?: Date; // 不传则显示今天
}

/** 解析用户输入的日期字符串，返回 Date 或 null */
export function parseCalendarQuery(input: string): Date | null {
  const trimmed = input.trim();

  // 今天
  if (['今天', '今日', '日历', '农历', '万年历', '黄历'].includes(trimmed)) {
    return new Date();
  }

  // 明天
  if (['明天', '明日'].includes(trimmed)) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  }

  // 后天
  if (['后天'].includes(trimmed)) {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return d;
  }

  // 昨天
  if (['昨天', '昨日'].includes(trimmed)) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d;
  }

  // 格式：2025-01-01 或 2025/01/01 或 20250101
  const isoMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    const d = new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]));
    if (!isNaN(d.getTime())) return d;
  }

  // 格式：2025年1月1日
  const cnMatch = trimmed.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日?$/);
  if (cnMatch) {
    const d = new Date(parseInt(cnMatch[1]), parseInt(cnMatch[2]) - 1, parseInt(cnMatch[3]));
    if (!isNaN(d.getTime())) return d;
  }

  // 格式：1月1日 或 1月1号（当年）
  const shortMatch = trimmed.match(/^(\d{1,2})月(\d{1,2})[日号]?$/);
  if (shortMatch) {
    const d = new Date(
      new Date().getFullYear(),
      parseInt(shortMatch[1]) - 1,
      parseInt(shortMatch[2])
    );
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

/** 检查输入是否是日历查询意图 */
export function isCalendarQuery(input: string): boolean {
  const trimmed = input.trim();
  if (
    [
      '今天',
      '今日',
      '日历',
      '农历',
      '万年历',
      '黄历',
      '明天',
      '明日',
      '后天',
      '昨天',
      '昨日',
    ].includes(trimmed)
  ) {
    return true;
  }
  if (/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.test(trimmed)) return true;
  if (/^(\d{4})年(\d{1,2})月(\d{1,2})日?$/.test(trimmed)) return true;
  if (/^(\d{1,2})月(\d{1,2})[日号]?$/.test(trimmed)) return true;
  return false;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const MONTHS = [
  '一月',
  '二月',
  '三月',
  '四月',
  '五月',
  '六月',
  '七月',
  '八月',
  '九月',
  '十月',
  '十一月',
  '十二月',
];

export default function CalendarCard({ date = new Date() }: CalendarCardProps) {
  const [viewDate, setViewDate] = useState(date);
  const [activeTab, setActiveTab] = useState<'day' | 'month'>('day');

  const info = useMemo(() => {
    const solar = Solar.fromDate(viewDate);
    const lunar = solar.getLunar();
    const festivals = solar.getFestivals();
    const lunarFestivals = lunar.getFestivals();
    const jieQi = lunar.getJieQi();
    const holiday = HolidayUtil.getHoliday(solar.getYear(), solar.getMonth(), solar.getDay());

    return {
      solar,
      lunar,
      year: solar.getYear(),
      month: solar.getMonth(),
      day: solar.getDay(),
      weekday: WEEKDAYS[solar.getWeek()],
      lunarYear: lunar.getYearInChinese(),
      lunarMonth: lunar.getMonthInChinese(),
      lunarDay: lunar.getDayInChinese(),
      lunarYearGanZhi: lunar.getYearInGanZhi(),
      lunarMonthGanZhi: lunar.getMonthInGanZhi(),
      lunarDayGanZhi: lunar.getDayInGanZhi(),
      shengXiao: lunar.getYearShengXiao(),
      jieQi,
      festivals: [...festivals, ...lunarFestivals],
      yi: lunar.getDayYi(),
      ji: lunar.getDayJi(),
      holiday,
      isToday: new Date().toDateString() === viewDate.toDateString(),
    };
  }, [viewDate]);

  // 当月日历数据
  const monthDays = useMemo(() => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days: Array<{ day: number; lunar: string; isToday: boolean; isFestival: boolean }> = [];

    for (let i = 0; i < firstDay; i++) {
      days.push({ day: 0, lunar: '', isToday: false, isFestival: false });
    }

    const today = new Date();
    for (let d = 1; d <= daysInMonth; d++) {
      const solar = Solar.fromYmd(year, month + 1, d);
      const lunar = solar.getLunar();
      const lunarDay = lunar.getDayInChinese();
      const lunarFestivals = lunar.getFestivals();
      const solarFestivals = solar.getFestivals();
      const jieQi = lunar.getJieQi();
      const isToday =
        today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
      const isFestival = lunarFestivals.length > 0 || solarFestivals.length > 0 || !!jieQi;

      // 优先显示：节日 > 节气 > 农历初一显示月份 > 农历日
      let label = lunarDay;
      if (lunarDay === '初一') label = `${lunar.getMonthInChinese()}月`;
      if (jieQi) label = jieQi;
      if (lunarFestivals.length > 0) label = lunarFestivals[0].substring(0, 2);
      if (solarFestivals.length > 0) label = solarFestivals[0].substring(0, 2);

      days.push({ day: d, lunar: label, isToday, isFestival });
    }

    return days;
  }, [viewDate]);

  const prevMonth = () => {
    const d = new Date(viewDate);
    d.setMonth(d.getMonth() - 1);
    setViewDate(d);
  };

  const nextMonth = () => {
    const d = new Date(viewDate);
    d.setMonth(d.getMonth() + 1);
    setViewDate(d);
  };

  const goToday = () => setViewDate(new Date());

  return (
    <div className="mx-2 mb-2 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
      {/* Tab 切换 */}
      <div className="flex items-center justify-between px-4 pt-3 pb-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900 dark:text-white">
            {info.year}年{info.month}月{info.day}日
          </span>
          {info.isToday && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-[#0066ff]/10 text-[#0066ff]">
              今天
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 p-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg">
          <button
            onClick={() => setActiveTab('day')}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              activeTab === 'day'
                ? 'bg-white dark:bg-gray-700 text-[#0066ff] shadow-sm font-medium'
                : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            日详情
          </button>
          <button
            onClick={() => setActiveTab('month')}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              activeTab === 'month'
                ? 'bg-white dark:bg-gray-700 text-[#0066ff] shadow-sm font-medium'
                : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            月历
          </button>
        </div>
      </div>

      {/* 日详情 */}
      {activeTab === 'day' && (
        <div className="px-4 py-3 space-y-3">
          {/* 主要信息 */}
          <div className="flex items-start gap-4">
            {/* 大日期 */}
            <div className="flex-shrink-0 w-16 h-16 rounded-xl bg-[#0066ff] flex flex-col items-center justify-center shadow-sm">
              <span className="text-2xl font-bold text-white leading-none">{info.day}</span>
              <span className="text-xs text-white/80 mt-0.5">{info.weekday}</span>
            </div>
            {/* 农历信息 */}
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  农历{info.lunarYear}年
                </span>
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {info.lunarMonth}月{info.lunarDay}
                </span>
                <span className="text-xs text-gray-400">{info.shengXiao}年</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                  {info.lunarYearGanZhi}年
                </span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                  {info.lunarMonthGanZhi}月
                </span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                  {info.lunarDayGanZhi}日
                </span>
              </div>
              {/* 节日/节气 */}
              {(info.festivals.length > 0 || info.jieQi) && (
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  {info.jieQi && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 font-medium">
                      {info.jieQi}
                    </span>
                  )}
                  {info.festivals.map((f, i) => (
                    <span
                      key={i}
                      className="text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 font-medium"
                    >
                      {f}
                    </span>
                  ))}
                </div>
              )}
              {/* 假日 */}
              {info.holiday && (
                <div className="mt-1">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      info.holiday.isWork()
                        ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400'
                        : 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                    }`}
                  >
                    {info.holiday.isWork() ? '🔧 调休上班' : `🎉 ${info.holiday.getName()}假期`}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* 宜忌 */}
          {(info.yi.length > 0 || info.ji.length > 0) && (
            <div className="grid grid-cols-2 gap-2">
              {info.yi.length > 0 && (
                <div className="p-2 rounded-lg bg-green-50 dark:bg-green-900/10 border border-green-100 dark:border-green-900/30">
                  <p className="text-xs font-medium text-green-700 dark:text-green-400 mb-1">宜</p>
                  <p className="text-xs text-green-600 dark:text-green-500 leading-relaxed">
                    {info.yi.slice(0, 6).join(' · ')}
                  </p>
                </div>
              )}
              {info.ji.length > 0 && (
                <div className="p-2 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30">
                  <p className="text-xs font-medium text-red-700 dark:text-red-400 mb-1">忌</p>
                  <p className="text-xs text-red-600 dark:text-red-500 leading-relaxed">
                    {info.ji.slice(0, 6).join(' · ')}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 月历 */}
      {activeTab === 'month' && (
        <div className="px-4 py-3">
          {/* 月份导航 */}
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={prevMonth}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors text-gray-500 dark:text-gray-400"
            >
              ‹
            </button>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-900 dark:text-white">
                {viewDate.getFullYear()}年{MONTHS[viewDate.getMonth()]}
              </span>
              {!info.isToday && (
                <button onClick={goToday} className="text-xs text-[#0066ff] hover:underline">
                  回今天
                </button>
              )}
            </div>
            <button
              onClick={nextMonth}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors text-gray-500 dark:text-gray-400"
            >
              ›
            </button>
          </div>

          {/* 星期头 */}
          <div className="grid grid-cols-7 mb-1">
            {['日', '一', '二', '三', '四', '五', '六'].map((w, i) => (
              <div
                key={w}
                className={`text-center text-xs py-1 font-medium ${
                  i === 0 || i === 6 ? 'text-red-400' : 'text-gray-400'
                }`}
              >
                {w}
              </div>
            ))}
          </div>

          {/* 日期格子 */}
          <div className="grid grid-cols-7 gap-0.5">
            {monthDays.map((d, i) => (
              <button
                key={i}
                onClick={() =>
                  d.day > 0 &&
                  setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth(), d.day))
                }
                disabled={d.day === 0}
                className={`flex flex-col items-center py-1 rounded-lg transition-colors ${
                  d.day === 0 ? 'invisible' : ''
                } ${
                  d.isToday
                    ? 'bg-[#0066ff] text-white'
                    : d.day === viewDate.getDate() && activeTab === 'month'
                      ? 'bg-[#0066ff]/10 text-[#0066ff]'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <span
                  className={`text-xs font-medium leading-none ${
                    d.isToday ? 'text-white' : 'text-gray-800 dark:text-gray-200'
                  }`}
                >
                  {d.day}
                </span>
                <span
                  className={`text-[9px] leading-none mt-0.5 truncate max-w-full px-0.5 ${
                    d.isToday ? 'text-white/80' : d.isFestival ? 'text-red-400' : 'text-gray-400'
                  }`}
                >
                  {d.lunar}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
