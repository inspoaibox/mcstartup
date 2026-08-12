// 单位换算工具 - 一页式布局
import { useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';

interface UnitDefinition {
  name: string;
  symbol: string;
  toBase: (value: number) => number;
  fromBase: (value: number) => number;
}

interface ConverterState {
  fromUnit: string;
  toUnit: string;
  fromValue: string;
  toValue: string;
}

// 长度单位（基准：米）
const lengthUnits: Record<string, UnitDefinition> = {
  inch: { name: '英寸', symbol: 'in', toBase: (v) => v * 0.0254, fromBase: (v) => v / 0.0254 },
  cm: { name: '厘米', symbol: 'cm', toBase: (v) => v / 100, fromBase: (v) => v * 100 },
  foot: { name: '英尺', symbol: 'ft', toBase: (v) => v * 0.3048, fromBase: (v) => v / 0.3048 },
  m: { name: '米', symbol: 'm', toBase: (v) => v, fromBase: (v) => v },
  km: { name: '千米', symbol: 'km', toBase: (v) => v * 1000, fromBase: (v) => v / 1000 },
  mm: { name: '毫米', symbol: 'mm', toBase: (v) => v / 1000, fromBase: (v) => v * 1000 },
  mile: { name: '英里', symbol: 'mi', toBase: (v) => v * 1609.344, fromBase: (v) => v / 1609.344 },
  yard: { name: '码', symbol: 'yd', toBase: (v) => v * 0.9144, fromBase: (v) => v / 0.9144 },
};

// 重量单位（基准：克）
const weightUnits: Record<string, UnitDefinition> = {
  lb: { name: '磅', symbol: 'lb', toBase: (v) => v * 453.59237, fromBase: (v) => v / 453.59237 },
  g: { name: '克', symbol: 'g', toBase: (v) => v, fromBase: (v) => v },
  kg: { name: '千克', symbol: 'kg', toBase: (v) => v * 1000, fromBase: (v) => v / 1000 },
  oz: {
    name: '盎司',
    symbol: 'oz',
    toBase: (v) => v * 28.349523125,
    fromBase: (v) => v / 28.349523125,
  },
  ton: { name: '吨', symbol: 't', toBase: (v) => v * 1000000, fromBase: (v) => v / 1000000 },
  mg: { name: '毫克', symbol: 'mg', toBase: (v) => v / 1000, fromBase: (v) => v * 1000 },
  jin: { name: '斤', symbol: '斤', toBase: (v) => v * 500, fromBase: (v) => v / 500 },
  liang: { name: '两', symbol: '两', toBase: (v) => v * 50, fromBase: (v) => v / 50 },
};

// 温度单位
const temperatureUnits: Record<string, UnitDefinition> = {
  celsius: { name: '摄氏度', symbol: '°C', toBase: (v) => v, fromBase: (v) => v },
  fahrenheit: {
    name: '华氏度',
    symbol: '°F',
    toBase: (v) => (v - 32) * (5 / 9),
    fromBase: (v) => v * (9 / 5) + 32,
  },
  kelvin: { name: '开尔文', symbol: 'K', toBase: (v) => v - 273.15, fromBase: (v) => v + 273.15 },
};

// 面积单位（基准：平方米）
const areaUnits: Record<string, UnitDefinition> = {
  m2: { name: '平方米', symbol: 'm²', toBase: (v) => v, fromBase: (v) => v },
  sqft: {
    name: '平方英尺',
    symbol: 'ft²',
    toBase: (v) => v * 0.092903,
    fromBase: (v) => v / 0.092903,
  },
  km2: {
    name: '平方千米',
    symbol: 'km²',
    toBase: (v) => v * 1000000,
    fromBase: (v) => v / 1000000,
  },
  cm2: { name: '平方厘米', symbol: 'cm²', toBase: (v) => v / 10000, fromBase: (v) => v * 10000 },
  hectare: { name: '公顷', symbol: 'ha', toBase: (v) => v * 10000, fromBase: (v) => v / 10000 },
  mu: { name: '亩', symbol: '亩', toBase: (v) => v * 666.67, fromBase: (v) => v / 666.67 },
  acre: { name: '英亩', symbol: 'ac', toBase: (v) => v * 4046.86, fromBase: (v) => v / 4046.86 },
};

// 体积单位（基准：升）
const volumeUnits: Record<string, UnitDefinition> = {
  l: { name: '升', symbol: 'L', toBase: (v) => v, fromBase: (v) => v },
  ml: { name: '毫升', symbol: 'mL', toBase: (v) => v / 1000, fromBase: (v) => v * 1000 },
  m3: { name: '立方米', symbol: 'm³', toBase: (v) => v * 1000, fromBase: (v) => v / 1000 },
  gallon: { name: '加仑', symbol: 'gal', toBase: (v) => v * 3.78541, fromBase: (v) => v / 3.78541 },
  quart: { name: '夸脱', symbol: 'qt', toBase: (v) => v * 0.946353, fromBase: (v) => v / 0.946353 },
  pint: { name: '品脱', symbol: 'pt', toBase: (v) => v * 0.473176, fromBase: (v) => v / 0.473176 },
  floz: {
    name: '液盎司',
    symbol: 'fl oz',
    toBase: (v) => v * 0.0295735,
    fromBase: (v) => v / 0.0295735,
  },
};

// 数据存储单位（基准：字节）
const storageUnits: Record<string, UnitDefinition> = {
  byte: { name: '字节', symbol: 'B', toBase: (v) => v, fromBase: (v) => v },
  kb: { name: '千字节', symbol: 'KB', toBase: (v) => v * 1024, fromBase: (v) => v / 1024 },
  mb: {
    name: '兆字节',
    symbol: 'MB',
    toBase: (v) => v * 1024 * 1024,
    fromBase: (v) => v / (1024 * 1024),
  },
  gb: {
    name: '吉字节',
    symbol: 'GB',
    toBase: (v) => v * 1024 * 1024 * 1024,
    fromBase: (v) => v / (1024 * 1024 * 1024),
  },
  tb: {
    name: '太字节',
    symbol: 'TB',
    toBase: (v) => v * 1024 * 1024 * 1024 * 1024,
    fromBase: (v) => v / (1024 * 1024 * 1024 * 1024),
  },
  pb: {
    name: '拍字节',
    symbol: 'PB',
    toBase: (v) => v * 1024 * 1024 * 1024 * 1024 * 1024,
    fromBase: (v) => v / (1024 * 1024 * 1024 * 1024 * 1024),
  },
  bit: { name: '比特', symbol: 'bit', toBase: (v) => v / 8, fromBase: (v) => v * 8 },
  kbit: {
    name: '千比特',
    symbol: 'Kbit',
    toBase: (v) => (v * 1024) / 8,
    fromBase: (v) => (v * 8) / 1024,
  },
  mbit: {
    name: '兆比特',
    symbol: 'Mbit',
    toBase: (v) => (v * 1024 * 1024) / 8,
    fromBase: (v) => (v * 8) / (1024 * 1024),
  },
};

export default function UnitConverter() {
  const ready = useToolTheme();

  const [length, setLength] = useState<ConverterState>({
    fromUnit: 'inch',
    toUnit: 'cm',
    fromValue: '1',
    toValue: '2.54',
  });

  const [weight, setWeight] = useState<ConverterState>({
    fromUnit: 'lb',
    toUnit: 'g',
    fromValue: '1',
    toValue: '453.59',
  });

  const [temperature, setTemperature] = useState<ConverterState>({
    fromUnit: 'celsius',
    toUnit: 'fahrenheit',
    fromValue: '0',
    toValue: '32',
  });

  const [area, setArea] = useState<ConverterState>({
    fromUnit: 'm2',
    toUnit: 'sqft',
    fromValue: '1',
    toValue: '10.76',
  });

  const [volume, setVolume] = useState<ConverterState>({
    fromUnit: 'l',
    toUnit: 'ml',
    fromValue: '1',
    toValue: '1000',
  });

  const [storage, setStorage] = useState<ConverterState>({
    fromUnit: 'mb',
    toUnit: 'kb',
    fromValue: '1',
    toValue: '1024',
  });

  const convert = (
    units: Record<string, UnitDefinition>,
    fromUnit: string,
    toUnit: string,
    value: string
  ): string => {
    const num = parseFloat(value);
    if (isNaN(num)) return '';

    const from = units[fromUnit];
    const to = units[toUnit];
    if (!from || !to) return '';

    const baseValue = from.toBase(num);
    const result = to.fromBase(baseValue);
    return result.toFixed(6).replace(/\.?0+$/, '');
  };

  const handleConvert = (
    category: 'length' | 'weight' | 'temperature' | 'area' | 'volume' | 'storage',
    field: 'fromValue' | 'fromUnit' | 'toUnit',
    value: string
  ) => {
    const states = { length, weight, temperature, area, volume, storage };
    const setters = {
      length: setLength,
      weight: setWeight,
      temperature: setTemperature,
      area: setArea,
      volume: setVolume,
      storage: setStorage,
    };
    const unitMaps = {
      length: lengthUnits,
      weight: weightUnits,
      temperature: temperatureUnits,
      area: areaUnits,
      volume: volumeUnits,
      storage: storageUnits,
    };

    const state = states[category];
    const setState = setters[category];
    const units = unitMaps[category];

    const newState = { ...state, [field]: value };
    const result = convert(units, newState.fromUnit, newState.toUnit, newState.fromValue);
    newState.toValue = result;

    setState(newState);
  };

  const swap = (category: 'length' | 'weight' | 'temperature' | 'area' | 'volume' | 'storage') => {
    const states = { length, weight, temperature, area, volume, storage };
    const setters = {
      length: setLength,
      weight: setWeight,
      temperature: setTemperature,
      area: setArea,
      volume: setVolume,
      storage: setStorage,
    };

    const state = states[category];
    const setState = setters[category];

    setState({
      fromUnit: state.toUnit,
      toUnit: state.fromUnit,
      fromValue: state.toValue || '0',
      toValue: state.fromValue,
    });
  };

  const renderConverter = (
    title: string,
    emoji: string,
    state: ConverterState,
    units: Record<string, UnitDefinition>,
    category: 'length' | 'weight' | 'temperature' | 'area' | 'volume' | 'storage'
  ) => (
    <div className="min-w-0 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xl">{emoji}</span>
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{title}</h3>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_auto_minmax(0,1fr)_minmax(0,1.15fr)] gap-3 max-[760px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] max-[760px]:items-center">
        <input
          type="number"
          value={state.fromValue}
          onChange={(e) => handleConvert(category, 'fromValue', e.target.value)}
          className="min-w-0 w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={state.fromUnit}
          onChange={(e) => handleConvert(category, 'fromUnit', e.target.value)}
          className="min-w-0 w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {Object.entries(units).map(([key, unit]) => (
            <option key={key} value={key}>
              {unit.name} ({unit.symbol})
            </option>
          ))}
        </select>
        <button
          onClick={() => swap(category)}
          className="h-10 w-10 flex items-center justify-center rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors max-[760px]:col-span-2 max-[760px]:mx-auto"
          title="交换单位"
        >
          <ArrowLeftRight size={16} />
        </button>
        <input
          type="text"
          value={state.toValue}
          readOnly
          className="min-w-0 w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm"
        />
        <select
          value={state.toUnit}
          onChange={(e) => handleConvert(category, 'toUnit', e.target.value)}
          className="min-w-0 w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {Object.entries(units).map(([key, unit]) => (
            <option key={key} value={key}>
              {unit.name} ({unit.symbol})
            </option>
          ))}
        </select>
      </div>
    </div>
  );

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900">
      <ToolHeader icon="🔄" title="单位换算" />

      {/* 内容区域 */}
      <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-6">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(360px,1fr))] gap-4 lg:gap-6 max-[420px]:grid-cols-1">
          {renderConverter('长度', '📏', length, lengthUnits, 'length')}
          {renderConverter('面积', '📐', area, areaUnits, 'area')}
          {renderConverter('重量', '⚖️', weight, weightUnits, 'weight')}
          {renderConverter('体积', '💧', volume, volumeUnits, 'volume')}
          {renderConverter('温度', '🌡️', temperature, temperatureUnits, 'temperature')}
          {renderConverter('存储', '💾', storage, storageUnits, 'storage')}
        </div>
      </div>

      {/* 常用参考 */}
      <div className="max-h-36 overflow-auto border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-3 sm:p-4">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-x-6 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
          <div>• 1 英寸 (in) = 2.54 厘米 (cm)</div>
          <div>• 1 磅 (lb) = 453.59 克 (g) ≈ 0.91 斤</div>
          <div>• 0°C = 32°F（水的冰点）</div>
          <div>• 1 MB = 1024 KB</div>
          <div>• 1 英尺 (ft) = 30.48 厘米 (cm)</div>
          <div>• 1 千克 (kg) = 2.20 磅 (lb) = 2 斤</div>
          <div>• 100°C = 212°F（水的沸点）</div>
          <div>• 1 GB = 1024 MB</div>
          <div>• 1 平方米 (m²) = 10.76 平方英尺 (ft²)</div>
          <div>• 1 升 (L) = 1000 毫升 (mL)</div>
          <div>• 1 亩 = 666.67 平方米 (m²)</div>
          <div>• 1 TB = 1024 GB</div>
        </div>
      </div>
    </div>
  );
}
