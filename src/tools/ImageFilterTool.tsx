import { useState, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { Upload, Download, RotateCcw, Copy } from 'lucide-react';
import { fileToBase64, useClipboardPaste, copyImageToClipboard } from './useImageInput';

interface Filters {
  grayscale: boolean;
  invert: boolean;
  brightness: number; // -100 ~ 100
  contrast: number; // -100 ~ 100
  blur: number; // 0 ~ 20
  unsharpen: number; // 0 ~ 5
}

const DEFAULT: Filters = {
  grayscale: false,
  invert: false,
  brightness: 0,
  contrast: 0,
  blur: 0,
  unsharpen: 0,
};

const PRESETS: { name: string; f: Partial<Filters> }[] = [
  { name: '原图', f: {} },
  { name: '黑白', f: { grayscale: true } },
  { name: '反色', f: { invert: true } },
  { name: '高对比', f: { contrast: 50, brightness: 10 } },
  { name: '低对比', f: { contrast: -40 } },
  { name: '提亮', f: { brightness: 40 } },
  { name: '压暗', f: { brightness: -40 } },
  { name: '柔焦', f: { blur: 2 } },
  { name: '锐化', f: { unsharpen: 2 } },
];

export default function ImageFilterTool() {
  useToolTheme();
  const [origB64, setOrigB64] = useState('');
  const [filters, setFilters] = useState<Filters>({ ...DEFAULT });
  const [resultB64, setResultB64] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedFlag, setCopiedFlag] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function loadImage(b64: string) {
    setOrigB64(b64);
    setFilters({ ...DEFAULT });
    setResultB64('');
  }

  async function handleFile(f: File) {
    if (!f.type.startsWith('image/')) return;
    loadImage(await fileToBase64(f));
  }

  useClipboardPaste((b64) => loadImage(b64));

  const doApply = useCallback(async (f: Filters, b64: string) => {
    if (!b64) return;
    setLoading(true);
    try {
      const result = await invoke<string>('image_filter', {
        data: b64,
        grayscale: f.grayscale,
        invert: f.invert,
        brightness: f.brightness,
        contrast: f.contrast,
        blur: f.blur,
        unsharpen: f.unsharpen,
      });
      setResultB64(result);
    } catch (e) {
      console.error('滤镜失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  function updateFilter(patch: Partial<Filters>) {
    const next = { ...filters, ...patch };
    setFilters(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doApply(next, origB64), 400);
  }

  function applyPreset(p: Partial<Filters>) {
    const next = { ...DEFAULT, ...p };
    setFilters(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doApply(next, origB64), 100);
  }

  function download() {
    if (!resultB64) return;
    const a = document.createElement('a');
    a.href = resultB64;
    a.download = 'filtered.png';
    a.click();
  }

  const preview = resultB64 || origB64;

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white">
      <ToolHeader title="图片滤镜" icon="🎨" />
      <div className="flex-1 overflow-hidden flex">
        {/* 左侧预览 */}
        <div className="flex-1 flex flex-col p-4 min-w-0">
          {!origB64 ? (
            <label
              className="flex-1 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed cursor-pointer border-gray-300 dark:border-gray-600 hover:border-pink-400 bg-white dark:bg-gray-800"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f) handleFile(f);
              }}
            >
              <Upload size={28} className="text-gray-400" />
              <div className="text-sm text-gray-400">点击上传 / 拖拽 / Ctrl+V 粘贴图片</div>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </label>
          ) : (
            <>
              <div
                className={`flex-1 rounded-xl border bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 flex items-center justify-center overflow-hidden transition-opacity ${loading ? 'opacity-60' : ''}`}
              >
                <img src={preview} alt="" className="max-w-full max-h-full object-contain" />
              </div>
              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-pink-500 cursor-pointer">
                    <Upload size={12} /> 重选图片
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleFile(f);
                      }}
                    />
                  </label>
                  <button
                    onClick={() => {
                      setOrigB64('');
                      setResultB64('');
                      setFilters({ ...DEFAULT });
                    }}
                    className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                  >
                    重置
                  </button>
                </div>
                {resultB64 && (
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        if (await copyImageToClipboard(resultB64)) setCopiedFlag(true);
                        setTimeout(() => setCopiedFlag(false), 1500);
                      }}
                      className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg"
                    >
                      <Copy size={13} /> {copiedFlag ? '已复制 ✓' : '复制'}
                    </button>
                    <button
                      onClick={download}
                      className="flex items-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-xs rounded-lg"
                    >
                      <Download size={13} /> 下载
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* 右侧控制 */}
        {origB64 && (
          <div className="w-64 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-y-auto p-4 space-y-4 flex-shrink-0">
            {/* 预设 */}
            <div>
              <div className="text-xs font-medium text-gray-400 mb-2">预设</div>
              <div className="grid grid-cols-3 gap-1">
                {PRESETS.map((p) => (
                  <button
                    key={p.name}
                    onClick={() => applyPreset(p.f)}
                    className="px-2 py-1.5 text-xs rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-pink-50 dark:hover:bg-pink-900/20 hover:text-pink-600 transition-colors"
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>

            {/* 开关 */}
            <div className="space-y-2">
              {(
                [
                  ['grayscale', '灰度化'],
                  ['invert', '反色'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center justify-between cursor-pointer">
                  <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
                  <div
                    className={`w-9 h-5 rounded-full transition-colors relative ${filters[key] ? 'bg-pink-500' : 'bg-gray-200 dark:bg-gray-600'}`}
                    onClick={() => updateFilter({ [key]: !filters[key] })}
                  >
                    <div
                      className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${filters[key] ? 'translate-x-4' : 'translate-x-0.5'}`}
                    />
                  </div>
                </label>
              ))}
            </div>

            {/* 滑块 */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-400">参数调整</span>
                <button
                  onClick={() => {
                    setFilters({ ...DEFAULT });
                    setResultB64('');
                  }}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500"
                >
                  <RotateCcw size={10} /> 重置
                </button>
              </div>
              {[
                {
                  key: 'brightness' as const,
                  label: '亮度',
                  min: -100,
                  max: 100,
                  step: 5,
                  unit: '',
                },
                {
                  key: 'contrast' as const,
                  label: '对比度',
                  min: -100,
                  max: 100,
                  step: 5,
                  unit: '',
                },
                { key: 'blur' as const, label: '模糊', min: 0, max: 20, step: 0.5, unit: 'px' },
                { key: 'unsharpen' as const, label: '锐化', min: 0, max: 5, step: 0.5, unit: '' },
              ].map(({ key, label, min, max, step, unit }) => (
                <div key={key}>
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>{label}</span>
                    <span>
                      {filters[key]}
                      {unit}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={filters[key]}
                    onChange={(e) => updateFilter({ [key]: Number(e.target.value) })}
                    className="w-full h-1.5 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer accent-pink-500"
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
