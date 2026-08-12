// 颜色助手工具 - 完整功能版本
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import {
  X,
  Copy,
  Check,
  Pipette,
  Palette,
  Droplet,
  Sparkles,
  Heart,
  Image as ImageIcon,
  Plus,
  Shuffle,
  Star,
  Trash2,
} from 'lucide-react';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';
import { useToolDataStore, ColorItem, FavoriteItem } from '../stores/toolDataStore';
import { UI_PALETTES, CHINESE_COLORS, JAPANESE_COLORS } from './color-data';

type Tab =
  | 'color'
  | 'eyedropper'
  | 'ui-palettes'
  | 'traditional'
  | 'gradient'
  | 'ai-scheme'
  | 'ai-card'
  | 'favorites';

const TAB_INFO = {
  color: { name: '颜色', icon: Droplet },
  eyedropper: { name: '取色器', icon: Pipette },
  'ui-palettes': { name: 'UI 色卡', icon: Palette },
  traditional: { name: '传统色', icon: Palette },
  gradient: { name: '渐变色', icon: Sparkles },
  'ai-scheme': { name: 'AI 配色', icon: Sparkles },
  'ai-card': { name: 'AI 色卡', icon: ImageIcon },
  favorites: { name: '收藏', icon: Heart },
};

export default function ColorAssistantTool() {
  const ready = useToolTheme();
  const { data, saveData } = useToolDataStore();
  const [tab, setTab] = useState<Tab>('color');
  const [currentColor, setCurrentColor] = useState('#1A73E8');
  const [copied, setCopied] = useState(false);

  const favorites = (data.colorAssistant?.favorites || []) as FavoriteItem[];
  const colorHistory = (data.colorAssistant?.colorHistory || []) as ColorItem[];

  const saveFavorites = (newFavorites: FavoriteItem[]) => {
    saveData({
      ...data,
      colorAssistant: {
        ...data.colorAssistant,
        favorites: newFavorites,
      },
    });
  };

  const saveColorHistory = (newHistory: ColorItem[]) => {
    saveData({
      ...data,
      colorAssistant: {
        ...data.colorAssistant,
        colorHistory: newHistory,
      },
    });
  };

  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : null;
  };

  const hexToHsl = (hex: string) => {
    const rgb = hexToRgb(hex);
    if (!rgb) return null;
    const r = rgb.r / 255;
    const g = rgb.g / 255;
    const b = rgb.b / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0,
      s = 0,
      l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r:
          h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
          break;
        case g:
          h = ((b - r) / d + 2) / 6;
          break;
        case b:
          h = ((r - g) / d + 4) / 6;
          break;
      }
    }

    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900">
      <ToolHeader icon="🎨" title="颜色助手" closeMode="hide" />

      <div className="flex gap-1 p-2 border-b border-gray-200 dark:border-gray-800 overflow-x-auto">
        {(Object.keys(TAB_INFO) as Tab[]).map((t) => {
          const Icon = TAB_INFO[t].icon;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${tab === t ? 'bg-blue-500 text-white shadow-md' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
            >
              <Icon size={14} />
              {TAB_INFO[t].name}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'color' && (
          <ColorTab
            currentColor={currentColor}
            setCurrentColor={setCurrentColor}
            copyToClipboard={copyToClipboard}
            hexToRgb={hexToRgb}
            hexToHsl={hexToHsl}
            copied={copied}
            saveFavorites={saveFavorites}
            favorites={favorites}
          />
        )}
        {tab === 'eyedropper' && (
          <EyedropperTab
            currentColor={currentColor}
            setCurrentColor={setCurrentColor}
            colorHistory={colorHistory}
            saveColorHistory={saveColorHistory}
            copyToClipboard={copyToClipboard}
          />
        )}
        {tab === 'ui-palettes' && (
          <UIPalettesTab
            copyToClipboard={copyToClipboard}
            saveFavorites={saveFavorites}
            favorites={favorites}
          />
        )}
        {tab === 'traditional' && (
          <TraditionalTab
            copyToClipboard={copyToClipboard}
            saveFavorites={saveFavorites}
            favorites={favorites}
          />
        )}
        {tab === 'gradient' && (
          <GradientTab
            copyToClipboard={copyToClipboard}
            saveFavorites={saveFavorites}
            favorites={favorites}
          />
        )}
        {tab === 'ai-scheme' && (
          <AISchemeTab
            copyToClipboard={copyToClipboard}
            saveFavorites={saveFavorites}
            favorites={favorites}
          />
        )}
        {tab === 'ai-card' && <AICardTab />}
        {tab === 'favorites' && (
          <FavoritesTab
            favorites={favorites}
            saveFavorites={saveFavorites}
            copyToClipboard={copyToClipboard}
          />
        )}
      </div>
    </div>
  );
}

// 颜色标签页
function ColorTab({
  currentColor,
  setCurrentColor,
  copyToClipboard,
  hexToRgb,
  hexToHsl,
  copied,
  saveFavorites,
  favorites,
}: {
  currentColor: string;
  setCurrentColor: (color: string) => void;
  copyToClipboard: (text: string) => void;
  hexToRgb: (hex: string) => { r: number; g: number; b: number } | null;
  hexToHsl: (hex: string) => { h: number; s: number; l: number } | null;
  copied: boolean;
  saveFavorites: (favorites: FavoriteItem[]) => void;
  favorites: FavoriteItem[];
}) {
  const [compareColors, setCompareColors] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState(currentColor);
  const rgb = hexToRgb(currentColor);
  const hsl = hexToHsl(currentColor);

  const handleInputChange = (value: string) => {
    setInputValue(value);
    if (/^#[0-9A-F]{6}$/i.test(value)) {
      setCurrentColor(value);
    }
  };

  const addToFavorites = () => {
    const newFav: FavoriteItem = {
      id: Date.now().toString(),
      type: 'color',
      data: { hex: currentColor },
      tags: [],
      timestamp: Date.now(),
    };
    saveFavorites([newFav, ...favorites]);
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          当前颜色
        </label>
        <div
          className="w-full h-32 rounded-lg border-2 border-gray-300 dark:border-gray-600 cursor-pointer"
          style={{ backgroundColor: currentColor }}
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'color';
            input.value = currentColor;
            input.onchange = (e) => {
              const color = (e.target as HTMLInputElement).value;
              setCurrentColor(color);
              setInputValue(color);
            };
            input.click();
          }}
        />
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder="#1A73E8"
            className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={addToFavorites}
            className="px-3 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors flex items-center gap-1"
          >
            <Star size={16} />
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <ColorFormat
          label="HEX"
          value={currentColor}
          copyToClipboard={copyToClipboard}
          copied={copied}
        />
        {rgb && (
          <ColorFormat
            label="RGB"
            value={`rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`}
            copyToClipboard={copyToClipboard}
            copied={copied}
          />
        )}
        {hsl && (
          <ColorFormat
            label="HSL"
            value={`hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`}
            copyToClipboard={copyToClipboard}
            copied={copied}
          />
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">对比颜色</label>
          <button
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'color';
              input.onchange = (e) => {
                const color = (e.target as HTMLInputElement).value;
                setCompareColors([...compareColors, color]);
              };
              input.click();
            }}
            className="px-3 py-1 text-xs bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            添加颜色
          </button>
        </div>
        <div className="flex gap-2 flex-wrap">
          {compareColors.map((color, index) => (
            <div
              key={index}
              className="w-16 h-16 rounded-lg border-2 border-gray-300 dark:border-gray-600 cursor-pointer relative group"
              style={{ backgroundColor: color }}
              onClick={() => setCompareColors(compareColors.filter((_, i) => i !== index))}
            >
              <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 rounded-lg flex items-center justify-center transition-all">
                <X size={16} className="text-white opacity-0 group-hover:opacity-100" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ColorFormat({
  label,
  value,
  copyToClipboard,
  copied,
}: {
  label: string;
  value: string;
  copyToClipboard: (text: string) => void;
  copied: boolean;
}) {
  return (
    <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
      <div>
        <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
        <p className="text-sm font-mono text-gray-800 dark:text-gray-200">{value}</p>
      </div>
      <button
        onClick={() => copyToClipboard(value)}
        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 ${copied ? 'bg-green-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600'}`}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </div>
  );
}

// 取色器标签页
function EyedropperTab({
  currentColor,
  setCurrentColor,
  colorHistory,
  saveColorHistory,
  copyToClipboard,
}: {
  currentColor: string;
  setCurrentColor: (color: string) => void;
  colorHistory: ColorItem[];
  saveColorHistory: (history: ColorItem[]) => void;
  copyToClipboard: (text: string) => void;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isPickingColor, setIsPickingColor] = useState(false);
  const [palette, setPalette] = useState<
    { hex: string; r: number; g: number; b: number; population: number }[]
  >([]);
  const [extracting, setExtracting] = useState(false);

  const startEyedropper = async () => {
    if ('EyeDropper' in window) {
      try {
        const eyeDropper = new (window as any).EyeDropper();
        const result = await eyeDropper.open();
        const color = result.sRGBHex;
        setCurrentColor(color);
        const newHistory = [
          { id: Date.now().toString(), hex: color, timestamp: Date.now() },
          ...colorHistory.slice(0, 19),
        ];
        saveColorHistory(newHistory);
      } catch (e) {
        alert('取色器启动失败或被取消');
      }
    } else {
      alert('您的浏览器不支持取色器 API');
    }
  };

  // 处理图片上传
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const url = event.target?.result as string;
        setImageUrl(url);
        setPalette([]);
        extractPalette(url);
      };
      reader.readAsDataURL(file);
    }
  };

  // 处理粘贴图片
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const blob = items[i].getAsFile();
        if (blob) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const url = event.target?.result as string;
            setImageUrl(url);
            setPalette([]);
            extractPalette(url);
          };
          reader.readAsDataURL(blob);
        }
      }
    }
  };

  // 用 auto-palette 提取主色
  const extractPalette = async (url: string) => {
    setExtracting(true);
    try {
      const result = await invoke<{ colors: typeof palette }>('image_extract_palette', {
        data: url,
        count: 8,
      });
      setPalette(result.colors);
    } catch (e) {
      console.error('主色提取失败:', e);
    } finally {
      setExtracting(false);
    }
  };

  // 从图片中取色
  const pickColorFromImage = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!isPickingColor) return;

    const img = e.currentTarget;
    const rect = img.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 创建临时 canvas 来获取像素颜色
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);

    // 计算实际图片坐标
    const scaleX = img.naturalWidth / img.width;
    const scaleY = img.naturalHeight / img.height;
    const pixelX = Math.floor(x * scaleX);
    const pixelY = Math.floor(y * scaleY);

    const pixel = ctx.getImageData(pixelX, pixelY, 1, 1).data;
    const hex = `#${((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2])
      .toString(16)
      .slice(1)
      .toUpperCase()}`;

    setCurrentColor(hex);
    setIsPickingColor(false);

    const newHistory = [
      { id: Date.now().toString(), hex, timestamp: Date.now() },
      ...colorHistory.slice(0, 19),
    ];
    saveColorHistory(newHistory);
  };

  return (
    <div className="p-6 space-y-6">
      {/* 屏幕取色器 */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">屏幕取色</h3>
        <button
          onClick={startEyedropper}
          className="w-full py-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center justify-center gap-2 font-medium"
        >
          <Pipette size={20} />
          启动屏幕取色器
        </button>
      </div>

      {/* 图片取色器 */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">图片取色</h3>
        <div
          className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 text-center"
          onPaste={handlePaste}
          tabIndex={0}
        >
          {!imageUrl ? (
            <div className="space-y-4">
              <ImageIcon className="mx-auto text-gray-400" size={48} />
              <div className="text-sm text-gray-500 dark:text-gray-400">
                <p>拖拽图片到此处，或</p>
                <p className="mt-1">按 Ctrl+V 粘贴图片</p>
              </div>
              <label className="inline-block px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg cursor-pointer hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
                选择图片
              </label>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="relative">
                <img
                  src={imageUrl}
                  alt="Preview"
                  className={`max-w-full max-h-96 mx-auto rounded-lg ${
                    isPickingColor ? 'cursor-crosshair' : 'cursor-default'
                  }`}
                  onClick={pickColorFromImage}
                  onMouseMove={(e) => {
                    if (isPickingColor) {
                      e.currentTarget.style.cursor = 'crosshair';
                    }
                  }}
                />
                {isPickingColor && (
                  <div className="absolute top-2 left-2 bg-blue-500 text-white px-3 py-1 rounded-lg text-sm">
                    点击图片取色
                  </div>
                )}
              </div>
              <div className="flex gap-2 justify-center">
                <button
                  onClick={() => setIsPickingColor(!isPickingColor)}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    isPickingColor
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                  }`}
                >
                  <Pipette size={16} className="inline mr-2" />
                  {isPickingColor ? '取色中...' : '开始取色'}
                </button>
                <button
                  onClick={() => {
                    setImageUrl(null);
                    setIsPickingColor(false);
                    setPalette([]);
                  }}
                  className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                >
                  清除图片
                </button>
              </div>

              {/* 主色调色板 */}
              {(extracting || palette.length > 0) && (
                <div className="mt-3">
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                    {extracting ? '提取主色中...' : `主色调色板（${palette.length} 色）`}
                  </div>
                  {palette.length > 0 && (
                    <div className="flex gap-1.5 flex-wrap">
                      {palette.map((c, i) => (
                        <div
                          key={i}
                          className="flex flex-col items-center gap-1 cursor-pointer group"
                          onClick={() => {
                            setCurrentColor(c.hex);
                            copyToClipboard(c.hex);
                          }}
                          title={`${c.hex} - 点击复制`}
                        >
                          <div
                            className="w-10 h-10 rounded-lg border-2 border-white dark:border-gray-700 shadow group-hover:scale-110 transition-transform"
                            style={{ backgroundColor: c.hex }}
                          />
                          <span className="text-[9px] font-mono text-gray-400">{c.hex}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 当前颜色 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          当前颜色
        </label>
        <div
          className="w-full h-24 rounded-lg border-2 border-gray-300 dark:border-gray-600"
          style={{ backgroundColor: currentColor }}
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-sm font-mono text-gray-800 dark:text-gray-200">{currentColor}</span>
          <button
            onClick={() => copyToClipboard(currentColor)}
            className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
          >
            复制
          </button>
        </div>
      </div>

      {/* 历史记录 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          历史记录
        </label>
        <div className="grid grid-cols-8 gap-2">
          {colorHistory.map((item: ColorItem) => (
            <div
              key={item.id}
              className="aspect-square rounded-lg border-2 border-gray-300 dark:border-gray-600 cursor-pointer hover:scale-110 transition-transform"
              style={{ backgroundColor: item.hex }}
              onClick={() => setCurrentColor(item.hex)}
              title={item.hex}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// UI 色卡标签页
function UIPalettesTab({
  copyToClipboard,
  saveFavorites,
  favorites,
}: {
  copyToClipboard: (text: string) => void;
  saveFavorites: (favorites: FavoriteItem[]) => void;
  favorites: FavoriteItem[];
}) {
  const [selectedPalette, setSelectedPalette] = useState<string>('Flat UI');

  const addToFavorites = (hex: string, name: string) => {
    const newFav: FavoriteItem = {
      id: Date.now().toString(),
      type: 'color',
      data: { hex, name },
      tags: ['UI色卡', selectedPalette],
      timestamp: Date.now(),
    };
    saveFavorites([newFav, ...favorites]);
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex gap-2 flex-wrap">
        {Object.keys(UI_PALETTES).map((palette) => (
          <button
            key={palette}
            onClick={() => setSelectedPalette(palette)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${selectedPalette === palette ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
          >
            {palette}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-4 gap-3">
        {UI_PALETTES[selectedPalette as keyof typeof UI_PALETTES].map((color) => (
          <div key={color.hex} className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <div className="flex flex-col items-center gap-2">
              <div
                className="w-full aspect-square rounded-lg border-2 border-gray-300 dark:border-gray-600 shadow-sm"
                style={{ backgroundColor: color.hex }}
                title={color.hex}
              />
              <div className="w-full text-center">
                <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">
                  {color.name}
                </p>
                <p className="text-xs font-mono text-gray-500 dark:text-gray-400 mt-0.5">
                  {color.hex}
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => copyToClipboard(color.hex)}
                className="flex-1 px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                复制
              </button>
              <button
                onClick={() => addToFavorites(color.hex, color.name)}
                className="px-2 py-1 text-xs bg-yellow-500 text-white rounded hover:bg-yellow-600 transition-colors flex items-center justify-center"
              >
                <Star size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// 传统色标签页
function TraditionalTab({
  copyToClipboard,
  saveFavorites,
  favorites,
}: {
  copyToClipboard: (text: string) => void;
  saveFavorites: (favorites: FavoriteItem[]) => void;
  favorites: FavoriteItem[];
}) {
  const [selectedType, setSelectedType] = useState<'chinese' | 'japanese'>('chinese');

  const addToFavorites = (hex: string, name: string) => {
    const newFav: FavoriteItem = {
      id: Date.now().toString(),
      type: 'color',
      data: { hex, name },
      tags: ['传统色', selectedType === 'chinese' ? '中国' : '日本'],
      timestamp: Date.now(),
    };
    saveFavorites([newFav, ...favorites]);
  };

  const colors = selectedType === 'chinese' ? CHINESE_COLORS : JAPANESE_COLORS;

  return (
    <div className="p-6 space-y-4">
      <div className="flex gap-2">
        <button
          onClick={() => setSelectedType('chinese')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${selectedType === 'chinese' ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
        >
          中国传统色
        </button>
        <button
          onClick={() => setSelectedType('japanese')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${selectedType === 'japanese' ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
        >
          日本传统色
        </button>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {colors.map((color) => (
          <div key={color.hex} className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <div className="flex flex-col items-center gap-2">
              <div
                className="w-full aspect-square rounded-lg border-2 border-gray-300 dark:border-gray-600 shadow-sm"
                style={{ backgroundColor: color.hex }}
                title={color.hex}
              />
              <div className="w-full text-center">
                <p className="text-xs font-medium text-gray-800 dark:text-gray-200">{color.name}</p>
                <p className="text-xs font-mono text-gray-500 dark:text-gray-400 mt-0.5">
                  {color.hex}
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => copyToClipboard(color.hex)}
                className="flex-1 px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                复制
              </button>
              <button
                onClick={() => addToFavorites(color.hex, color.name)}
                className="px-2 py-1 text-xs bg-yellow-500 text-white rounded hover:bg-yellow-600 transition-colors flex items-center justify-center"
              >
                <Star size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// 渐变色标签页
function GradientTab({
  copyToClipboard,
  saveFavorites,
  favorites,
}: {
  copyToClipboard: (text: string) => void;
  saveFavorites: (favorites: FavoriteItem[]) => void;
  favorites: FavoriteItem[];
}) {
  const [color1, setColor1] = useState('#FF6B6B');
  const [color2, setColor2] = useState('#4ECDC4');
  const [angle, setAngle] = useState(45);
  const [type, setType] = useState<'linear' | 'radial'>('linear');

  const gradientCSS =
    type === 'linear'
      ? `linear-gradient(${angle}deg, ${color1}, ${color2})`
      : `radial-gradient(circle, ${color1}, ${color2})`;

  const randomGradient = () => {
    const randomColor = () =>
      '#' +
      Math.floor(Math.random() * 16777215)
        .toString(16)
        .padStart(6, '0');
    setColor1(randomColor());
    setColor2(randomColor());
    setAngle(Math.floor(Math.random() * 360));
  };

  const addToFavorites = () => {
    const newFav: FavoriteItem = {
      id: Date.now().toString(),
      type: 'gradient',
      data: { colors: [color1, color2], angle, type, css: gradientCSS },
      tags: ['渐变色'],
      timestamp: Date.now(),
    };
    saveFavorites([newFav, ...favorites]);
  };

  return (
    <div className="p-6 space-y-6">
      {/* 渐变色预览 - 大尺寸显示 */}
      <div className="space-y-3">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          渐变预览
        </label>
        <div
          className="w-full rounded-xl border-4 border-gray-300 dark:border-gray-600 shadow-lg"
          style={{
            backgroundImage: gradientCSS,
            minHeight: '256px',
            height: '256px',
          }}
        />
      </div>

      <div className="space-y-4">
        <div className="flex gap-2">
          <button
            onClick={() => setType('linear')}
            className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${type === 'linear' ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}
          >
            线性渐变
          </button>
          <button
            onClick={() => setType('radial')}
            className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${type === 'radial' ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}
          >
            径向渐变
          </button>
        </div>

        <div className="flex gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              颜色 1
            </label>
            <div className="flex gap-2">
              <div
                className="w-16 h-16 flex-shrink-0 rounded-lg border-2 border-gray-300 dark:border-gray-600 cursor-pointer shadow-sm"
                style={{ backgroundColor: color1 }}
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'color';
                  input.value = color1;
                  input.onchange = (e) => setColor1((e.target as HTMLInputElement).value);
                  input.click();
                }}
              />
              <input
                type="text"
                value={color1}
                onChange={(e) => setColor1(e.target.value)}
                className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-mono"
              />
            </div>
          </div>

          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              颜色 2
            </label>
            <div className="flex gap-2">
              <div
                className="w-16 h-16 flex-shrink-0 rounded-lg border-2 border-gray-300 dark:border-gray-600 cursor-pointer shadow-sm"
                style={{ backgroundColor: color2 }}
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'color';
                  input.value = color2;
                  input.onchange = (e) => setColor2((e.target as HTMLInputElement).value);
                  input.click();
                }}
              />
              <input
                type="text"
                value={color2}
                onChange={(e) => setColor2(e.target.value)}
                className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-mono"
              />
            </div>
          </div>
        </div>

        {type === 'linear' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              角度: {angle}°
            </label>
            <input
              type="range"
              min="0"
              max="360"
              value={angle}
              onChange={(e) => setAngle(Number(e.target.value))}
              className="w-full"
            />
          </div>
        )}

        <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">CSS</label>
          <p className="text-sm font-mono text-gray-800 dark:text-gray-200 break-all">
            {gradientCSS}
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => copyToClipboard(gradientCSS)}
            className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center justify-center gap-2"
          >
            <Copy size={16} />
            复制 CSS
          </button>
          <button
            onClick={randomGradient}
            className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors flex items-center gap-2"
          >
            <Shuffle size={16} />
            随机
          </button>
          <button
            onClick={addToFavorites}
            className="px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors"
          >
            <Star size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

// AI 配色标签页
function AISchemeTab({
  copyToClipboard,
  saveFavorites,
  favorites,
}: {
  copyToClipboard: (text: string) => void;
  saveFavorites: (favorites: FavoriteItem[]) => void;
  favorites: FavoriteItem[];
}) {
  const [keyword, setKeyword] = useState('');
  const [scheme, setScheme] = useState<Array<{ name: string; hex: string; description: string }>>(
    []
  );

  const generateScheme = () => {
    // 模拟AI生成配色方案
    const schemes: Record<string, Array<{ name: string; hex: string; description: string }>> = {
      科技: [
        { name: '星辰蓝', hex: '#1A73E8', description: '冷静、理性、科技感' },
        { name: '冰川青', hex: '#4FC3F7', description: '清新、现代、创新' },
        { name: '深空灰', hex: '#37474F', description: '稳重、专业、高端' },
        { name: '极光绿', hex: '#00E676', description: '活力、未来、智能' },
        { name: '量子紫', hex: '#7C4DFF', description: '神秘、前沿、科幻' },
      ],
      自然: [
        { name: '森林绿', hex: '#2E7D32', description: '生机、自然、环保' },
        { name: '天空蓝', hex: '#42A5F5', description: '清新、开阔、自由' },
        { name: '大地棕', hex: '#6D4C41', description: '稳重、质朴、温暖' },
        { name: '阳光黄', hex: '#FDD835', description: '明亮、活力、希望' },
        { name: '海洋蓝', hex: '#0277BD', description: '深邃、宁静、广阔' },
      ],
      温暖: [
        { name: '暖阳橙', hex: '#FF9800', description: '温暖、活力、友好' },
        { name: '蜜桃粉', hex: '#FF6F61', description: '甜美、柔和、温馨' },
        { name: '奶油黄', hex: '#FFE082', description: '柔软、舒适、温和' },
        { name: '焦糖棕', hex: '#A1887F', description: '醇厚、温暖、怀旧' },
        { name: '玫瑰红', hex: '#E91E63', description: '热情、浪漫、温暖' },
      ],
      商务: [
        { name: '商务蓝', hex: '#1565C0', description: '专业、可靠、稳重' },
        { name: '精英灰', hex: '#546E7A', description: '低调、高端、内敛' },
        { name: '品质黑', hex: '#263238', description: '经典、权威、正式' },
        { name: '信任绿', hex: '#2E7D32', description: '诚信、成长、稳定' },
        { name: '活力橙', hex: '#EF6C00', description: '创新、积极、进取' },
      ],
      浪漫: [
        { name: '樱花粉', hex: '#F8BBD0', description: '浪漫、温柔、甜美' },
        { name: '薰衣草紫', hex: '#CE93D8', description: '优雅、梦幻、神秘' },
        { name: '玫瑰金', hex: '#E1BEE7', description: '高贵、浪漫、奢华' },
        { name: '珊瑚橙', hex: '#FFAB91', description: '温暖、活泼、可爱' },
        { name: '天使白', hex: '#FAFAFA', description: '纯洁、清新、简约' },
      ],
      活力: [
        { name: '柠檬黄', hex: '#FFF176', description: '明亮、活力、青春' },
        { name: '橙色冲击', hex: '#FF6F00', description: '热情、动感、激情' },
        { name: '草莓红', hex: '#F44336', description: '鲜艳、醒目、热烈' },
        { name: '薄荷绿', hex: '#00E676', description: '清新、活力、健康' },
        { name: '天空蓝', hex: '#00B0FF', description: '自由、开阔、希望' },
      ],
    };

    const matchedScheme = Object.keys(schemes).find((k) => keyword.includes(k));
    if (matchedScheme) {
      setScheme(schemes[matchedScheme]);
    } else {
      // 随机生成
      const randomScheme =
        Object.values(schemes)[Math.floor(Math.random() * Object.values(schemes).length)];
      setScheme(randomScheme);
    }
  };

  const addToFavorites = (hex: string, name: string, description: string) => {
    const newFav: FavoriteItem = {
      id: Date.now().toString(),
      type: 'color',
      data: { hex, name, description },
      tags: ['AI配色', keyword || '随机'],
      timestamp: Date.now(),
    };
    saveFavorites([newFav, ...favorites]);
  };

  const saveAllScheme = () => {
    const newFavs = scheme.map((color, index) => ({
      id: `${Date.now()}-${index}`,
      type: 'color' as const,
      data: { hex: color.hex, name: color.name, description: color.description },
      tags: ['AI配色', keyword || '随机', '配色方案'],
      timestamp: Date.now(),
    }));
    saveFavorites([...newFavs, ...favorites]);
    alert('配色方案已全部收藏！');
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          关键词
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && generateScheme()}
            placeholder="例如：科技、自然、温暖、商务、浪漫、活力..."
            className="flex-1 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={generateScheme}
            className="px-6 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg hover:from-purple-600 hover:to-pink-600 transition-colors flex items-center gap-2"
          >
            <Sparkles size={16} />
            生成配色
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
          支持关键词：科技、自然、温暖、商务、浪漫、活力
        </p>
      </div>

      {scheme.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
              AI 生成的配色方案
            </h3>
            <button
              onClick={saveAllScheme}
              className="px-3 py-1.5 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors flex items-center gap-1 text-xs"
            >
              <Star size={14} />
              收藏全部
            </button>
          </div>
          {scheme.map((color) => (
            <div key={color.hex} className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <div className="flex items-center gap-4">
                <div
                  className="w-16 h-16 rounded-lg border-2 border-gray-300 dark:border-gray-600"
                  style={{ backgroundColor: color.hex }}
                />
                <div className="flex-1">
                  <h4 className="text-base font-semibold text-gray-800 dark:text-gray-200">
                    {color.name}
                  </h4>
                  <p className="text-sm font-mono text-gray-500 dark:text-gray-400 mt-1">
                    {color.hex}
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    {color.description}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => copyToClipboard(color.hex)}
                    className="px-3 py-2 bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 text-sm"
                  >
                    复制
                  </button>
                  <button
                    onClick={() => addToFavorites(color.hex, color.name, color.description)}
                    className="px-3 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 text-sm"
                  >
                    <Star size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// AI 色卡图片标签页
function AICardTab() {
  const [selectedColors, setSelectedColors] = useState<string[]>(['#FF6B6B', '#4ECDC4', '#45B7D1']);
  const [cardName, setCardName] = useState('我的色卡');
  const [cardDescription, setCardDescription] = useState('');

  const addColor = () => {
    const input = document.createElement('input');
    input.type = 'color';
    input.onchange = (e) => {
      const color = (e.target as HTMLInputElement).value;
      if (selectedColors.length < 10) {
        setSelectedColors([...selectedColors, color]);
      }
    };
    input.click();
  };

  const randomColors = () => {
    const count = Math.floor(Math.random() * 5) + 3;
    const colors = [];
    for (let i = 0; i < count; i++) {
      colors.push(
        '#' +
          Math.floor(Math.random() * 16777215)
            .toString(16)
            .padStart(6, '0')
      );
    }
    setSelectedColors(colors);
  };

  const exportAsImage = () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = 800;
    const height = 400;
    canvas.width = width;
    canvas.height = height;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    const colorWidth = width / selectedColors.length;
    selectedColors.forEach((color, index) => {
      ctx.fillStyle = color;
      ctx.fillRect(index * colorWidth, 0, colorWidth, height * 0.7);
    });

    ctx.fillStyle = '#333333';
    ctx.font = '14px monospace';
    ctx.textAlign = 'center';
    selectedColors.forEach((color, index) => {
      ctx.fillText(color, (index + 0.5) * colorWidth, height * 0.8);
    });

    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(cardName, width / 2, height * 0.92);

    canvas.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${cardName}.png`;
        a.click();
        URL.revokeObjectURL(url);
      }
    });
  };

  const copyAllColors = () => {
    const text = selectedColors.join(', ');
    navigator.clipboard.writeText(text);
    alert('已复制所有颜色代码！');
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="flex items-center justify-between mb-3">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            选择颜色（最多 10 个）
          </label>
          <div className="flex gap-2">
            <button
              onClick={randomColors}
              className="px-3 py-1 text-xs bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors flex items-center gap-1"
            >
              <Shuffle size={12} />
              随机
            </button>
            <button
              onClick={addColor}
              disabled={selectedColors.length >= 10}
              className="px-3 py-1 text-xs bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <Plus size={12} />
              添加
            </button>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {selectedColors.map((color, index) => (
            <div key={index} className="relative group">
              <div
                className="w-16 h-16 rounded-lg border-2 border-gray-300 dark:border-gray-600 cursor-pointer"
                style={{ backgroundColor: color }}
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'color';
                  input.value = color;
                  input.onchange = (e) => {
                    const newColor = (e.target as HTMLInputElement).value;
                    const newColors = [...selectedColors];
                    newColors[index] = newColor;
                    setSelectedColors(newColors);
                  };
                  input.click();
                }}
              />
              <button
                onClick={() => setSelectedColors(selectedColors.filter((_, i) => i !== index))}
                className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
              >
                <X size={12} />
              </button>
              <p className="text-xs text-center mt-1 font-mono text-gray-600 dark:text-gray-400">
                {color}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            色卡名称
          </label>
          <input
            type="text"
            value={cardName}
            onChange={(e) => setCardName(e.target.value)}
            placeholder="例如：未来科技蓝"
            className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            色卡描述（可选）
          </label>
          <textarea
            value={cardDescription}
            onChange={(e) => setCardDescription(e.target.value)}
            placeholder="例如：冷静、理性、科技感十足..."
            rows={3}
            className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>
      </div>

      <div className="p-6 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <div className="flex gap-2 mb-4 h-32">
          {selectedColors.map((color, index) => (
            <div key={index} className="flex-1 rounded-lg" style={{ backgroundColor: color }} />
          ))}
        </div>
        <div className="text-center">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">{cardName}</h3>
          {cardDescription && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">{cardDescription}</p>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={exportAsImage}
          className="flex-1 px-4 py-3 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-lg hover:from-blue-600 hover:to-purple-600 transition-colors flex items-center justify-center gap-2 font-medium"
        >
          <ImageIcon size={18} />
          导出为图片
        </button>
        <button
          onClick={copyAllColors}
          className="px-4 py-3 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors flex items-center gap-2"
        >
          <Copy size={18} />
          复制全部
        </button>
      </div>
    </div>
  );
}

// 收藏标签页
function FavoritesTab({
  favorites,
  saveFavorites,
  copyToClipboard,
}: {
  favorites: FavoriteItem[];
  saveFavorites: (favorites: FavoriteItem[]) => void;
  copyToClipboard: (text: string) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'color' | 'gradient'>('all');

  const filteredFavorites =
    filter === 'all' ? favorites : favorites.filter((f) => f.type === filter);

  const removeFavorite = (id: string) => {
    saveFavorites(favorites.filter((f) => f.id !== id));
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex gap-2">
        <button
          onClick={() => setFilter('all')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${filter === 'all' ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}
        >
          全部
        </button>
        <button
          onClick={() => setFilter('color')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${filter === 'color' ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}
        >
          单色
        </button>
        <button
          onClick={() => setFilter('gradient')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${filter === 'gradient' ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}
        >
          渐变
        </button>
      </div>

      {filteredFavorites.length === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <Heart size={48} className="mx-auto mb-4 opacity-50" />
          <p>还没有收藏任何颜色</p>
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-3">
          {filteredFavorites.map((fav) => (
            <div key={fav.id} className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
              {fav.type === 'color' && (
                <>
                  <div
                    className="w-full aspect-square rounded-lg border-2 border-gray-300 dark:border-gray-600 shadow-sm mb-2"
                    style={{ backgroundColor: fav.data.hex }}
                    title={fav.data.hex}
                  />
                  <div className="mb-2 text-center">
                    {fav.data.name && (
                      <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">
                        {fav.data.name}
                      </p>
                    )}
                    <p className="text-xs font-mono text-gray-500 dark:text-gray-400 mt-0.5">
                      {fav.data.hex}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => copyToClipboard(fav.data.hex)}
                      className="flex-1 px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                    >
                      复制
                    </button>
                    <button
                      onClick={() => removeFavorite(fav.id)}
                      className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors flex items-center justify-center"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </>
              )}
              {fav.type === 'gradient' && (
                <>
                  <div
                    className="w-full aspect-square rounded-lg border-2 border-gray-300 dark:border-gray-600 mb-2 shadow-sm"
                    style={{ backgroundImage: fav.data.css }}
                    title={fav.data.css}
                  />
                  <div className="mb-2 text-center">
                    <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">
                      渐变色
                    </p>
                    <p className="text-xs font-mono text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                      {fav.data.colors?.join(' → ') || 'gradient'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => copyToClipboard(fav.data.css)}
                      className="flex-1 px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                    >
                      CSS
                    </button>
                    <button
                      onClick={() => removeFavorite(fav.id)}
                      className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors flex items-center justify-center"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
