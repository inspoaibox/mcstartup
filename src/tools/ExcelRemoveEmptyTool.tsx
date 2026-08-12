import { useState } from 'react';
import { open } from '@tauri-apps/api/dialog';
import { invoke } from '@tauri-apps/api/tauri';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import {
  Upload,
  FolderOpen,
  CheckCircle,
  Loader,
  AlertCircle,
  Play,
  FileSpreadsheet,
  Trash2
} from 'lucide-react';

interface FileItem {
  id: string;
  path: string;
  name: string;
}

export default function ExcelRemoveEmptyTool() {
  const ready = useToolTheme();
  
  const [files, setFiles] = useState<FileItem[]>([]);
  const [outputDir, setOutputDir] = useState<string | null>(null);
  
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{ count: number; dir: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addFiles = async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xls', 'csv'] }],
    });
    
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    
    const newFiles = paths.map(p => {
      const name = p.split(/[\\/]/).pop() || p;
      return {
        id: Math.random().toString(36).substring(2, 9),
        path: p,
        name,
      } as FileItem;
    });
    
    setFiles(prev => [...prev, ...newFiles]);
    setResult(null);
    setError(null);
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const selectOutputDir = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
    });
    if (selected && !Array.isArray(selected)) {
      setOutputDir(selected);
    }
  };

  const handleProcess = async () => {
    if (files.length === 0 || !outputDir) return;
    
    setProcessing(true);
    setError(null);
    setResult(null);
    
    try {
      const count = await invoke<number>('remove_empty_rows', {
        inputPaths: files.map(f => f.path),
        outputDir: outputDir
      });
      
      setResult({ count, dir: outputDir });
    } catch (e: any) {
      setError(e.toString() || '处理失败');
    } finally {
      setProcessing(false);
    }
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <ToolHeader
        icon="🧹"
        title="Excel 删除空行"
        subtitle="自动识别并一键删除 Excel 中所有没数据的空白行，保持数据的整洁与一致性"
      />

      <div className="flex-1 overflow-auto p-6 flex flex-col gap-6 max-w-4xl mx-auto w-full">
        {/* Intro Alert */}
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 p-4 rounded-xl text-sm text-blue-800 dark:text-blue-300 shadow-sm leading-relaxed">
          <p className="font-semibold mb-1 flex items-center gap-1.5">
            <AlertCircle size={16} /> 工具说明
          </p>
          <ul className="list-disc pl-5 space-y-1 mt-2 text-xs opacity-90">
            <li>本工具仅在您的浏览器（本地应用）中处理 Excel 数据，不会上传至网络服务器，请放心使用！</li>
            <li>处理后的 Excel 会保留纯净的数据，但<strong>会丢失颜色等样式</strong>，如果对样式要求高的请谨慎使用。</li>
            <li>大量空行会影响 Excel 性能，删除后可显著提高文件的计算和处理速度，打印布局也会更专业。</li>
          </ul>
        </div>

        {/* Step 1: Select Files */}
        <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 flex items-center justify-center text-xs font-bold">1</span>
              上传需要清理的 Excel 文件
            </h3>
            <button
              onClick={addFiles}
              className="text-xs px-3 py-1.5 bg-teal-50 text-teal-600 dark:bg-teal-900/20 dark:text-teal-400 rounded-lg hover:bg-teal-100 dark:hover:bg-teal-900/40 transition-colors"
            >
              + 添加文件
            </button>
          </div>
          
          {files.length === 0 ? (
            <div
              onClick={addFiles}
              className="h-32 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer hover:border-teal-400 hover:bg-teal-50 dark:hover:bg-teal-900/10 transition-colors"
            >
              <Upload size={28} className="text-gray-400 mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">点击选择或拖拽 Excel 文件到这里</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
              {files.map(file => (
                <div key={file.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/30 border border-gray-100 dark:border-gray-700 rounded-lg">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <FileSpreadsheet size={18} className="text-teal-500 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">{file.name}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => removeFile(file.id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Step 2: Output & Execute */}
        <div className={`bg-white dark:bg-gray-800 p-5 rounded-xl border shadow-sm transition-opacity ${files.length === 0 ? 'opacity-50 pointer-events-none border-gray-100 dark:border-gray-800' : 'border-gray-200 dark:border-gray-700'}`}>
          <h3 className="text-sm font-medium mb-3 text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 flex items-center justify-center text-xs font-bold">2</span>
            选择保存目录并执行
          </h3>
          
          <div className="flex items-center gap-3">
            <button
              onClick={selectOutputDir}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg text-sm transition-colors"
            >
              <FolderOpen size={16} />
              选择保存位置
            </button>
            <div className="flex-1 text-xs text-gray-500 dark:text-gray-400 truncate" title={outputDir || '未选择'}>
              {outputDir ? outputDir : '尚未选择保存文件夹'}
            </div>
            
            <button
              onClick={handleProcess}
              disabled={!outputDir || processing || files.length === 0}
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
                  开始删除空行
                </>
              )}
            </button>
          </div>
        </div>

        {/* Result & Error */}
        {result && (
          <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/50 rounded-xl flex items-start gap-3">
            <CheckCircle size={18} className="text-green-500 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-green-800 dark:text-green-300">
                处理完成！成功清除了 {result.count} 个文件中的所有空行
              </p>
              <p className="text-xs text-green-600 dark:text-green-400/70 mt-1 select-all">
                已自动导出至：{result.dir}
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
