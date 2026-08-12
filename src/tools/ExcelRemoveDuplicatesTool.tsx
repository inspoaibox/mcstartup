import { useState } from 'react';
import { open, save } from '@tauri-apps/api/dialog';
import { invoke } from '@tauri-apps/api/tauri';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import {
  AlertCircle,
  CheckCircle,
  FileSpreadsheet,
  ListFilter,
  Loader,
  Play,
  Trash2,
  Upload,
} from 'lucide-react';

type DuplicateMode = 'keep_first' | 'keep_last' | 'remove_all';

interface SelectedFile {
  path: string;
  name: string;
}

interface RemoveDuplicatesResult {
  output_path: string;
  removed_rows: number;
  kept_rows: number;
  target_sheet_name: string;
}

const MODE_OPTIONS: Array<{
  id: DuplicateMode;
  title: string;
  desc: string;
}> = [
  {
    id: 'keep_first',
    title: '保留第一个',
    desc: '重复时保留第一次出现的行，其余重复行全部删除',
  },
  {
    id: 'keep_last',
    title: '保留最后一个',
    desc: '重复时仅保留最后一次出现的行，之前的重复行全部删除',
  },
  {
    id: 'remove_all',
    title: '移除全部',
    desc: '只要该列存在重复，所有重复值对应的行都删除',
  },
];

export default function ExcelRemoveDuplicatesTool() {
  const ready = useToolTheme();
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [selectedColumnIndex, setSelectedColumnIndex] = useState(0);
  const [mode, setMode] = useState<DuplicateMode>('keep_first');
  const [dragging, setDragging] = useState(false);
  const [loadingHeaders, setLoadingHeaders] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<RemoveDuplicatesResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadFile(path: string) {
    setLoadingHeaders(true);
    setResult(null);
    setError(null);
    try {
      const loadedHeaders = await invoke<string[]>('get_excel_headers', { path });
      setFile({
        path,
        name: path.split(/[\\/]/).pop() || path,
      });
      setHeaders(loadedHeaders);
      setSelectedColumnIndex(0);
    } catch (e) {
      setFile(null);
      setHeaders([]);
      setError(String(e));
    } finally {
      setLoadingHeaders(false);
    }
  }

  async function selectFile() {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xls', 'xlsm', 'xlsb', 'ods', 'csv'] }],
    });
    if (typeof selected === 'string') {
      await loadFile(selected);
    }
  }

  async function handleProcess() {
    if (!file || headers.length === 0) return;

    setProcessing(true);
    setResult(null);
    setError(null);

    try {
      const stem = file.name.replace(/\.[^.]+$/, '');
      const outputPath = await save({
        defaultPath: `${stem}_按列去重.xlsx`,
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      });

      if (!outputPath) {
        setProcessing(false);
        return;
      }

      const processed = await invoke<RemoveDuplicatesResult>('remove_excel_duplicates', {
        inputPath: file.path,
        columnIndex: selectedColumnIndex,
        mode,
        outputPath,
      });

      setResult(processed);
    } catch (e) {
      setError(String(e));
    } finally {
      setProcessing(false);
    }
  }

  async function continueProcessing() {
    if (!result?.output_path) return;
    await loadFile(result.output_path);
  }

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <ToolHeader
        icon="🧽"
        title="Excel重复列数据移除"
        subtitle="按指定列去重，支持保留第一个、保留最后一个和全部移除三种模式"
      />

      <div className="flex-1 overflow-auto p-6 flex flex-col gap-6 max-w-4xl mx-auto w-full">
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 p-4 rounded-xl text-sm text-blue-800 dark:text-blue-300 shadow-sm leading-relaxed">
          <p className="font-semibold mb-1 flex items-center gap-1.5">
            <AlertCircle size={16} /> 工具说明
          </p>
          <ul className="list-disc pl-5 space-y-1 mt-2 text-xs opacity-90">
            <li>根据指定列的值查找重复项，并按模式删除对应的重复行。</li>
            <li>支持保留第一个、保留最后一个、移除全部三种处理模式。</li>
            <li>处理后可点击“↑ 继续处理 ↑”，直接以结果文件作为下一轮输入继续按其他列去重。</li>
          </ul>
        </div>

        <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 flex items-center justify-center text-xs font-bold">1</span>
              选择要处理的 Excel 文件
            </h3>
            <button
              onClick={selectFile}
              disabled={processing}
              className="text-xs px-3 py-1.5 bg-teal-50 text-teal-600 dark:bg-teal-900/20 dark:text-teal-400 rounded-lg hover:bg-teal-100 dark:hover:bg-teal-900/40 transition-colors disabled:opacity-50"
            >
              选择文件
            </button>
          </div>

          {!file ? (
            <div
              onClick={selectFile}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={async (e) => {
                e.preventDefault();
                setDragging(false);
                const dropped = Array.from(e.dataTransfer.files)[0] as File & { path?: string };
                if (dropped?.path) {
                  await loadFile(dropped.path);
                }
              }}
              className={`h-36 flex flex-col items-center justify-center border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
                dragging
                  ? 'border-teal-400 bg-teal-50 dark:bg-teal-900/10'
                  : 'border-gray-300 dark:border-gray-600 hover:border-teal-400 hover:bg-teal-50 dark:hover:bg-teal-900/10'
              }`}
            >
              <Upload size={28} className="text-gray-400 mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                点击选择或将 Excel 文件拖到这里
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/30 border border-gray-100 dark:border-gray-700 rounded-lg">
              <div className="flex items-center gap-3 overflow-hidden">
                <FileSpreadsheet size={18} className="text-teal-500 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">
                    {file.name}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{file.path}</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setFile(null);
                  setHeaders([]);
                  setResult(null);
                  setError(null);
                }}
                disabled={processing}
                className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors disabled:opacity-50"
              >
                <Trash2 size={14} />
              </button>
            </div>
          )}
        </div>

        <div
          className={`bg-white dark:bg-gray-800 p-5 rounded-xl border shadow-sm transition-opacity ${
            !file ? 'opacity-50 pointer-events-none border-gray-100 dark:border-gray-800' : 'border-gray-200 dark:border-gray-700'
          }`}
        >
          <h3 className="text-sm font-medium mb-3 text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 flex items-center justify-center text-xs font-bold">2</span>
            选择去重列和模式
          </h3>

          {loadingHeaders ? (
            <div className="flex items-center justify-center py-8 gap-2 text-gray-400">
              <Loader size={16} className="animate-spin" />
              <span className="text-sm">正在读取表头...</span>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="relative">
                <select
                  value={selectedColumnIndex}
                  onChange={(e) => setSelectedColumnIndex(Number(e.target.value))}
                  className="w-full pl-9 pr-4 py-2 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 appearance-none"
                >
                  {headers.map((header, index) => (
                    <option key={index} value={index}>
                      {header} (第 {index + 1} 列)
                    </option>
                  ))}
                </select>
                <ListFilter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {MODE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => setMode(option.id)}
                    className={`text-left p-3 rounded-lg border transition-colors ${
                      mode === option.id
                        ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-teal-300 bg-white dark:bg-gray-800'
                    }`}
                  >
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{option.title}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-5">{option.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div
          className={`bg-white dark:bg-gray-800 p-5 rounded-xl border shadow-sm transition-opacity ${
            !file || loadingHeaders ? 'opacity-50 pointer-events-none border-gray-100 dark:border-gray-800' : 'border-gray-200 dark:border-gray-700'
          }`}
        >
          <h3 className="text-sm font-medium mb-3 text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 flex items-center justify-center text-xs font-bold">3</span>
            开始处理并保存新文件
          </h3>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={handleProcess}
              disabled={!file || headers.length === 0 || processing}
              className="flex items-center gap-2 px-6 py-2 bg-teal-500 hover:bg-teal-600 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed"
            >
              {processing ? (
                <>
                  <Loader size={16} className="animate-spin" />
                  处理中...
                </>
              ) : (
                <>
                  <Play size={16} />
                  开始去重
                </>
              )}
            </button>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              每次处理会生成新的结果文件，原文件不会被覆盖。
            </p>
          </div>
        </div>

        {result && (
          <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/50 rounded-xl flex items-start gap-3">
            <CheckCircle size={18} className="text-green-500 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-green-800 dark:text-green-300">
                处理完成！目标工作表 {result.target_sheet_name} 保留 {result.kept_rows} 行，移除重复行 {result.removed_rows} 行
              </p>
              <p className="text-xs text-green-600 dark:text-green-400/70 mt-1 select-all">
                已保存到：{result.output_path}
              </p>
              <button
                onClick={continueProcessing}
                className="mt-3 px-3 py-1.5 text-xs font-medium rounded-lg bg-teal-500 hover:bg-teal-600 text-white transition-colors"
              >
                ↑ 继续处理 ↑
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-xl flex items-start gap-3">
            <AlertCircle size={18} className="text-red-500 mt-0.5" />
            <p className="text-sm text-red-700 dark:text-red-300 flex-1 whitespace-pre-wrap">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
