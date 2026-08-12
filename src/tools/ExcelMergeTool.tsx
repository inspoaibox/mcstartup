import { useState } from 'react';
import { open, save } from '@tauri-apps/api/dialog';
import { invoke } from '@tauri-apps/api/tauri';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import {
  Upload,
  X,
  CheckCircle,
  Loader,
  AlertCircle,
  Save,
  Plus,
  ArrowUp,
  ArrowDown,
  FileSpreadsheet
} from 'lucide-react';

interface ExcelFile {
  id: string;
  path: string;
  name: string;
}

type MergeMode = 'single_sheet' | 'multi_sheet';

export default function ExcelMergeTool() {
  const ready = useToolTheme();
  const [files, setFiles] = useState<ExcelFile[]>([]);
  const [mergeMode, setMergeMode] = useState<MergeMode>('single_sheet');
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{ path: string; count: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addFiles = async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xls', 'csv', 'ods'] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    
    const newFiles: ExcelFile[] = paths.map(p => ({
      id: Math.random().toString(36).substring(2, 9),
      path: p,
      name: p.split(/[\\/]/).pop() || p
    }));
    
    setFiles(prev => [...prev, ...newFiles]);
    setResult(null);
    setError(null);
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const moveFile = (index: number, direction: -1 | 1) => {
    if (index + direction < 0 || index + direction >= files.length) return;
    setFiles(prev => {
      const arr = [...prev];
      const temp = arr[index];
      arr[index] = arr[index + direction];
      arr[index + direction] = temp;
      return arr;
    });
  };

  const clearAll = () => {
    setFiles([]);
    setResult(null);
    setError(null);
  };

  const handleSave = async () => {
    if (files.length === 0) return;
    setProcessing(true);
    setError(null);
    setResult(null);
    
    try {
      const outPath = await save({
        defaultPath: 'merged.xlsx',
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      });
      
      if (!outPath) {
        setProcessing(false);
        return;
      }
      
      const inputPaths = files.map(f => f.path);
      
      // Call Rust backend
      const res = await invoke<string>('merge_excel_files', {
        inputPaths,
        outputPath: outPath,
        mergeMode,
      });
      
      setResult({ path: res, count: files.length });
    } catch (e: any) {
      setError(e.toString() || '合并失败');
    } finally {
      setProcessing(false);
    }
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <ToolHeader
        icon="📊"
        title="Excel 合并"
        subtitle="支持合并为一个总表，或保留为一个文件内的多个工作表"
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-auto p-4">
          {files.length === 0 ? (
            <div
              onClick={addFiles}
              className="h-full min-h-48 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl cursor-pointer hover:border-teal-400 hover:bg-teal-50 dark:hover:bg-teal-900/10 transition-colors"
            >
              <Upload size={32} className="text-gray-400 mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                点击选择 Excel 文件（支持多选）
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                支持 .xlsx, .xls, .csv, .ods 格式
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-w-3xl mx-auto">
              <div className="mb-4 p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-100 mb-3">合并模式</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <button
                    onClick={() => setMergeMode('single_sheet')}
                    disabled={processing}
                    className={`text-left p-3 rounded-lg border transition-colors ${
                      mergeMode === 'single_sheet'
                        ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-teal-300'
                    }`}
                  >
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100">合并为单个工作表</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      默认模式，将所有文件按统一表头汇总到一个 sheet
                    </p>
                  </button>
                  <button
                    onClick={() => setMergeMode('multi_sheet')}
                    disabled={processing}
                    className={`text-left p-3 rounded-lg border transition-colors ${
                      mergeMode === 'multi_sheet'
                        ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-teal-300'
                    }`}
                  >
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100">按源表写入多个工作表</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      输出为一个 Excel 文件，每个源文件或源 sheet 单独占一个 worksheet
                    </p>
                  </button>
                </div>
              </div>

              <div className="flex justify-between items-center mb-4">
                <span className="text-sm text-gray-500 dark:text-gray-400">已选择 {files.length} 个文件</span>
                <button
                  onClick={addFiles}
                  disabled={processing}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400 hover:bg-teal-200 dark:hover:bg-teal-900/50 rounded-lg transition-colors disabled:opacity-50"
                >
                  <Plus size={14} />
                  继续添加
                </button>
              </div>
              
              {files.map((file, idx) => (
                <div
                  key={file.id}
                  className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm"
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className="w-8 h-8 flex items-center justify-center bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-md flex-shrink-0">
                      <FileSpreadsheet size={16} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate" title={file.name}>
                        {file.name}
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 truncate" title={file.path}>
                        {file.path}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-1 flex-shrink-0 ml-4">
                    <button
                      onClick={() => moveFile(idx, -1)}
                      disabled={idx === 0}
                      className="p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-30 disabled:hover:bg-transparent"
                      title="上移"
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      onClick={() => moveFile(idx, 1)}
                      disabled={idx === files.length - 1}
                      className="p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-30 disabled:hover:bg-transparent"
                      title="下移"
                    >
                      <ArrowDown size={14} />
                    </button>
                    <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-1"></div>
                    <button
                      onClick={() => removeFile(file.id)}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                      title="移除"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {result && (
          <div className="mx-4 mb-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg flex items-center gap-2">
            <CheckCircle size={15} className="text-green-500 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm text-green-700 dark:text-green-300">
                合并成功！已处理 {result.count} 个文件
              </p>
              <p className="text-xs text-green-600 dark:text-green-400 truncate">
                {result.path}
              </p>
            </div>
          </div>
        )}
        {error && (
          <div className="mx-4 mb-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-2">
            <AlertCircle size={15} className="text-red-500 flex-shrink-0" />
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        <div className="flex-shrink-0 px-4 py-3 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex items-center gap-3">
          {files.length > 0 && !processing && (
            <button
              onClick={clearAll}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
            >
              <X size={14} />
              清空
            </button>
          )}
          <div className="flex-1" />
          {files.length > 0 && <span className="text-xs text-gray-400">{files.length} 个文件</span>}
          <button
            onClick={handleSave}
            disabled={files.length === 0 || processing}
            className="flex items-center gap-2 px-6 py-2 bg-teal-500 hover:bg-teal-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed"
          >
            {processing ? (
              <>
                <Loader size={14} className="animate-spin" />
                合并中...
              </>
            ) : (
              <>
                <Save size={14} />
                保存合并表格
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
