import { useState } from 'react';
import { WeatherResult } from '../types';
import { Wind, Droplets, Eye, Thermometer, Cloud } from 'lucide-react';

interface WeatherCardProps {
  weather: WeatherResult;
  days: number;
  onChangeDays: (days: number) => void;
  loading?: boolean;
}

function weatherIcon(iconCode: string): string {
  const code = parseInt(iconCode, 10);
  if (code === 100) return '☀️';
  if (code === 101) return '🌤️';
  if (code === 102 || code === 103) return '⛅';
  if (code === 104) return '☁️';
  if (code >= 150 && code <= 153) return '🌙';
  if (code >= 300 && code <= 304) return '⛈️';
  if (code >= 305 && code <= 313) return '🌧️';
  if (code >= 314 && code <= 318) return '🌨️';
  if (code >= 400 && code <= 407) return '❄️';
  if (code >= 500 && code <= 502) return '🌫️';
  if (code >= 503 && code <= 508) return '💨';
  if (code >= 509 && code <= 515) return '🌫️';
  if (code === 900) return '🔥';
  if (code === 901) return '🥶';
  return '🌡️';
}

function formatDate(dateStr: string): { weekday: string; date: string } {
  const date = new Date(dateStr);
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  let weekday = weekdays[date.getDay()];
  if (date.toDateString() === today.toDateString()) weekday = '今天';
  else if (date.toDateString() === tomorrow.toDateString()) weekday = '明天';
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return { weekday, date: `${month}/${day}` };
}

function formatUpdateTime(timeStr: string): string {
  if (!timeStr) return '';
  try {
    const date = new Date(timeStr);
    const h = date.getHours().toString().padStart(2, '0');
    const m = date.getMinutes().toString().padStart(2, '0');
    return `${h}:${m} 更新`;
  } catch {
    return '';
  }
}

export default function WeatherCard({ weather, days, onChangeDays, loading }: WeatherCardProps) {
  const [activeTab, setActiveTab] = useState<'now' | 'forecast'>('now');
  const { now, daily, cityName, updateTime } = weather;

  const FORECAST_OPTIONS = [
    { label: '7天', value: 7 },
    { label: '15天', value: 15 },
    { label: '30天', value: 30 },
  ];

  return (
    <div className="mx-2 mb-2 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
      {/* 城市 + Tab */}
      <div className="flex items-center justify-between px-4 pt-3 pb-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900 dark:text-white">{cityName}</span>
          <span className="text-xs text-gray-400">{formatUpdateTime(updateTime)}</span>
        </div>
        <div className="flex items-center gap-0.5 p-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg">
          <button
            onClick={() => setActiveTab('now')}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              activeTab === 'now'
                ? 'bg-white dark:bg-gray-700 text-[#0066ff] shadow-sm font-medium'
                : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            实时
          </button>
          <button
            onClick={() => setActiveTab('forecast')}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              activeTab === 'forecast'
                ? 'bg-white dark:bg-gray-700 text-[#0066ff] shadow-sm font-medium'
                : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            预报
          </button>
        </div>
      </div>

      {/* 实时天气 */}
      {activeTab === 'now' && (
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className="text-4xl">{weatherIcon(now.icon)}</span>
              <div>
                <div className="flex items-end gap-1">
                  <span className="text-3xl font-light text-gray-900 dark:text-white">
                    {now.temp}
                  </span>
                  <span className="text-lg text-gray-500 dark:text-gray-400 mb-0.5">°C</span>
                </div>
                <span className="text-sm text-gray-500 dark:text-gray-400">{now.text}</span>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500 dark:text-gray-400">体感 {now.feelsLike}°C</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {now.windDir} {now.windScale}级
              </p>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div className="flex flex-col items-center p-2 rounded-lg bg-gray-50 dark:bg-gray-800/50">
              <Droplets size={14} className="text-blue-400 mb-1" />
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {now.humidity}%
              </span>
              <span className="text-xs text-gray-400">湿度</span>
            </div>
            <div className="flex flex-col items-center p-2 rounded-lg bg-gray-50 dark:bg-gray-800/50">
              <Wind size={14} className="text-teal-400 mb-1" />
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {now.windSpeed}
              </span>
              <span className="text-xs text-gray-400">km/h</span>
            </div>
            <div className="flex flex-col items-center p-2 rounded-lg bg-gray-50 dark:bg-gray-800/50">
              <Eye size={14} className="text-purple-400 mb-1" />
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {now.vis}
              </span>
              <span className="text-xs text-gray-400">能见度</span>
            </div>
            <div className="flex flex-col items-center p-2 rounded-lg bg-gray-50 dark:bg-gray-800/50">
              <Thermometer size={14} className="text-orange-400 mb-1" />
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {now.pressure}
              </span>
              <span className="text-xs text-gray-400">气压</span>
            </div>
          </div>
          {parseFloat(now.precip) > 0 && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-blue-500">
              <Cloud size={12} />
              <span>当前降水量 {now.precip} mm</span>
            </div>
          )}
        </div>
      )}

      {/* 天气预报 */}
      {activeTab === 'forecast' && (
        <div className="px-4 py-3">
          {/* 天数切换 */}
          <div className="flex items-center gap-1 mb-3">
            {FORECAST_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onChangeDays(opt.value)}
                disabled={loading}
                className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                  days === opt.value
                    ? 'bg-[#0066ff] text-white font-medium'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {loading && days === opt.value ? '加载中...' : opt.label}
              </button>
            ))}
            <span className="text-xs text-gray-400 ml-auto">共 {daily.length} 天</span>
          </div>

          {/* 预报列表 */}
          <div className="space-y-1.5 max-h-[280px] overflow-y-auto custom-scrollbar">
            {daily.map((day) => {
              const { weekday, date } = formatDate(day.fxDate);
              return (
                <div
                  key={day.fxDate}
                  className="flex items-center gap-3 py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0"
                >
                  <div className="w-12 flex-shrink-0">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
                      {weekday}
                    </p>
                    <p className="text-xs text-gray-400">{date}</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-1">
                    <span className="text-base">{weatherIcon(day.iconDay)}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {day.textDay}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-xs flex-shrink-0">
                    <span className="text-gray-900 dark:text-white font-medium">
                      {day.tempMax}°
                    </span>
                    <span className="text-gray-400">/</span>
                    <span className="text-gray-500 dark:text-gray-400">{day.tempMin}°</span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-gray-400 flex-shrink-0 w-14">
                    <Droplets size={11} className="text-blue-400" />
                    <span>{day.humidity}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
