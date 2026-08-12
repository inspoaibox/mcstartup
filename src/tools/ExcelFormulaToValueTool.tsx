import { useState } from 'react';
import { open, save } from '@tauri-apps/api/dialog';
import { invoke } from '@tauri-apps/api/tauri';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import {
  AlertCircle,
  CheckCircle,
  FileSpreadsheet,
  Loader,
  Play,
  Trash2,
  Upload,
} from 'lucide-react';

interface SelectedFile {
  path: string;
  name: string;
}

interface ConvertResult {
  output_path: string;
  sheet_count: number;
  formula_count: number;
}

export default function ExcelFormulaToValueTool() {
  const ready = useToolTheme();
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function selectFile() {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xls', 'xlsm', 'xlsb', 'ods'] }],
    });

    if (typeof selected !== 'string') return;

    setFile({
      path: selected,
      name: selected.split(/[\\/]/).pop() || selected,
    });
    setResult(null);
    setError(null);
  }

  async function handleDrop(fileLike: File & { path?: string }) {
    if (!fileLike?.path) return;
    setFile({
      path: fileLike.path,
      name: fileLike.name || fileLike.path.split(/[\\/]/).pop() || fileLike.path,
    });
    setResult(null);
    setError(null);
  }

  async function handleProcess() {
    if (!file) return;

    setProcessing(true);
    setResult(null);
    setError(null);

    try {
      const stem = file.name.replace(/\.[^.]+$/, '');
      const outputPath = await save({
        defaultPath: `${stem}_公式转值.xlsx`,
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      });

      if (!outputPath) {
        setProcessing(false);
        return;
      }

      const converted = await invoke<ConvertResult>('convert_excel_formulas_to_values', {
        inputPath: file.path,
        outputPath,
      });

      setResult(converted);
    } catch (e) {
      setError(String(e));
    } finally {
      setProcessing(false);
    }
  }

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <ToolHeader
        icon="🧮"
        title="Excel公式转值"
        subtitle="将工作簿中所有公式转换为静态结果值，避免后续引用变化引发数据波动"
      />

      <div className="flex-1 overflow-auto p-6 flex flex-col gap-6 max-w-4xl mx-auto w-full">
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 p-4 rounded-xl text-sm text-blue-800 dark:text-blue-300 shadow-sm leading-relaxed">
          <p className="font-semibold mb-1 flex items-center gap-1.5">
            <AlertCircle size={16} /> 工具说明
          </p>
          <ul className="list-disc pl-5 space-y-1 mt-2 text-xs opacity-90">
            <li>将 Excel 中所有公式替换为当前计算结果，输出为新的 `.xlsx` 文件。</li>
            <li>适合项目报告、财务归档和数据分析场景，避免引用源变动导致结果变化。</li>
            <li>当前版本以数据保留为主，不保留原始样式和公式。</li>
          </ul>
        </div>

        <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 flex items-center justify-center text-xs font-bold">1</span>
              上传需要转值的 Excel 文件
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
                await handleDrop(dropped);
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
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                支持 .xlsx / .xls / .xlsm / .xlsb / .ods
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
            开始转换并保存新文件
          </h3>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={handleProcess}
              disabled={!file || processing}
              className="flex items-center gap-2 px-6 py-2 bg-teal-500 hover:bg-teal-600 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed"
            >
              {processing ? (
                <>
                  <Loader size={16} className="animate-spin" />
                  转换中...
                </>
              ) : (
                <>
                  <Play size={16} />
                  开始转换
                </>
              )}
            </button>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              处理完成后会保存为新的 Excel 文件，原文件不会被修改。
            </p>
          </div>
        </div>

        {result && (
          <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/50 rounded-xl flex items-start gap-3">
            <CheckCircle size={18} className="text-green-500 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-green-800 dark:text-green-300">
                转换完成！共处理 {result.sheet_count} 个工作表，转为静态值的公式 {result.formula_count} 个
              </p>
              <p className="text-xs text-green-600 dark:text-green-400/70 mt-1 select-all">
                已保存到：{result.output_path}
              </p>
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
