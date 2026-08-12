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
  X,
  FileJson
} from 'lucide-react';

interface FileItem {
  id: string;
  path: string;
  name: string;
  type: 'csv' | 'excel';
}

export default function ExcelConvertTool() {
  const ready = useToolTheme();
  
  const [files, setFiles] = useState<FileItem[]>([]);
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [targetFormat, setTargetFormat] = useState<'xlsx' | 'csv'>('xlsx');
  
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{ count: number; dir: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addFiles = async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: 'Spreadsheet', extensions: ['xlsx', 'xls', 'csv'] }],
    });
    
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    
    const newFiles = paths.map(p => {
      const name = p.split(/[\\/]/).pop() || p;
      const ext = name.split('.').pop()?.toLowerCase();
      return {
        id: Math.random().toString(36).substring(2, 9),
        path: p,
        name,
        type: ext === 'csv' ? 'csv' : 'excel'
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

  const handleConvert = async () => {
    if (files.length === 0 || !outputDir) return;
    
    setProcessing(true);
    setError(null);
    setResult(null);
    
    try {
      const count = await invoke<number>('convert_spreadsheet', {
        inputPaths: files.map(f => f.path),
        outputDir: outputDir,
        targetFormat: targetFormat
      });
      
      setResult({ count, dir: outputDir });
    } catch (e: any) {
      setError(e.toString() || '转换失败');
    } finally {
      setProcessing(false);
    }
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <ToolHeader
        icon="🔄"
        title="CSV 乱码修复与互转"
        subtitle="智能修复乱码 CSV 并转换为标准的 Excel (.xlsx) 格式，或将 Excel 导出为标准 UTF-8 CSV"
      />

      <div className="flex-1 overflow-auto p-6 flex flex-col gap-6 max-w-4xl mx-auto w-full">
        {/* Step 1: Select Files */}
        <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xs font-bold">1</span>
              选择要转换的文件 (支持批量)
            </h3>
            <button
              onClick={addFiles}
              className="text-xs px-3 py-1.5 bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors"
            >
              + 添加文件
            </button>
          </div>
          
          {files.length === 0 ? (
            <div
              onClick={addFiles}
              className="h-32 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/10 transition-colors"
            >
              <Upload size={28} className="text-gray-400 mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">点击选择 CSV 或 Excel 文件</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
              {files.map(file => (
                <div key={file.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/30 border border-gray-100 dark:border-gray-700 rounded-lg">
                  <div className="flex items-center gap-3 overflow-hidden">
                    {file.type === 'csv' ? (
                      <FileJson size={18} className="text-orange-500 flex-shrink-0" />
                    ) : (
                      <FileSpreadsheet size={18} className="text-green-500 flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">{file.name}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => removeFile(file.id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Step 2: Target Format */}
        <div className={`bg-white dark:bg-gray-800 p-5 rounded-xl border shadow-sm transition-opacity ${files.length === 0 ? 'opacity-50 pointer-events-none border-gray-100 dark:border-gray-800' : 'border-gray-200 dark:border-gray-700'}`}>
          <h3 className="text-sm font-medium mb-3 text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xs font-bold">2</span>
            选择目标格式
          </h3>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className={`flex flex-col p-4 rounded-xl border-2 cursor-pointer transition-all ${targetFormat === 'xlsx' ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-indigo-300'}`}>
              <div className="flex items-center gap-3 mb-1">
                <input 
                  type="radio" 
                  name="format" 
                  checked={targetFormat === 'xlsx'} 
                  onChange={() => setTargetFormat('xlsx')}
                  className="w-4 h-4 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="font-semibold text-gray-800 dark:text-gray-100">转为 Excel (.xlsx)</span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 pl-7">
                自动识别 GBK / UTF-8 编码，彻底解决 CSV 乱码。推荐用于数据阅读与人工处理。
              </p>
            </label>
            
            <label className={`flex flex-col p-4 rounded-xl border-2 cursor-pointer transition-all ${targetFormat === 'csv' ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-indigo-300'}`}>
              <div className="flex items-center gap-3 mb-1">
                <input 
                  type="radio" 
                  name="format" 
                  checked={targetFormat === 'csv'} 
                  onChange={() => setTargetFormat('csv')}
                  className="w-4 h-4 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="font-semibold text-gray-800 dark:text-gray-100">转为标准 CSV (带 BOM)</span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 pl-7">
                严格输出为 UTF-8 编码并添加 BOM 签名。确保 Excel 或各种系统导入时绝不乱码。
              </p>
            </label>
          </div>
        </div>

        {/* Step 3: Output & Execute */}
        <div className={`bg-white dark:bg-gray-800 p-5 rounded-xl border shadow-sm transition-opacity ${files.length === 0 ? 'opacity-50 pointer-events-none border-gray-100 dark:border-gray-800' : 'border-gray-200 dark:border-gray-700'}`}>
          <h3 className="text-sm font-medium mb-3 text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xs font-bold">3</span>
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
              onClick={handleConvert}
              disabled={!outputDir || processing || files.length === 0}
              className="flex items-center gap-2 px-6 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed"
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
          </div>
        </div>

        {/* Result & Error */}
        {result && (
          <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/50 rounded-xl flex items-start gap-3">
            <CheckCircle size={18} className="text-green-500 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-green-800 dark:text-green-300">
                转换成功！已处理 {result.count} 个文件
              </p>
              <p className="text-xs text-green-600 dark:text-green-400/70 mt-1 select-all">
                已保存至：{result.dir}
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
