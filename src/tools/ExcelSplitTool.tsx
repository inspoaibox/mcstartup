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
  ListFilter
} from 'lucide-react';

export default function ExcelSplitTool() {
  const ready = useToolTheme();
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [selectedColumnIndex, setSelectedColumnIndex] = useState<number>(0);
  const [outputDir, setOutputDir] = useState<string | null>(null);
  
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{ count: number; dir: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectFile = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xls', 'csv', 'ods'] }],
    });
    
    if (!selected || Array.isArray(selected)) return;
    
    setFilePath(selected);
    setFileName(selected.split(/[\\/]/).pop() || selected);
    setResult(null);
    setError(null);
    setHeaders([]);
    setLoading(true);
    
    try {
      const cols = await invoke<string[]>('get_excel_headers', { path: selected });
      setHeaders(cols);
      setSelectedColumnIndex(0);
    } catch (e: any) {
      setError(e.toString() || '读取表头失败，请确认文件是否正确或是否为空');
    } finally {
      setLoading(false);
    }
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

  const handleSplit = async () => {
    if (!filePath || !outputDir || headers.length === 0) return;
    setProcessing(true);
    setError(null);
    setResult(null);
    
    try {
      const count = await invoke<number>('split_excel_file', {
        inputPath: filePath,
        columnIndex: selectedColumnIndex,
        outputDir: outputDir
      });
      
      setResult({ count, dir: outputDir });
    } catch (e: any) {
      setError(e.toString() || '拆分失败');
    } finally {
      setProcessing(false);
    }
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <ToolHeader
        icon="✂️"
        title="Excel 拆分"
        subtitle="按指定的列内容（如按部门、城市等）将一个表格拆分成多个独立的文件"
      />

      <div className="flex-1 overflow-auto p-6 flex flex-col gap-6 max-w-3xl mx-auto w-full">
        {/* Step 1: Select File */}
        <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <h3 className="text-sm font-medium mb-3 text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xs font-bold">1</span>
            选择要拆分的表格
          </h3>
          
          {!filePath ? (
            <div
              onClick={selectFile}
              className="h-32 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-colors"
            >
              <Upload size={28} className="text-gray-400 mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">点击选择 Excel 文件</p>
            </div>
          ) : (
            <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/50 rounded-lg">
              <div className="flex items-center gap-3 overflow-hidden">
                <FileSpreadsheet size={20} className="text-blue-500 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{fileName}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{filePath}</p>
                </div>
              </div>
              <button 
                onClick={selectFile}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex-shrink-0 ml-4"
              >
                重新选择
              </button>
            </div>
          )}
        </div>

        {/* Step 2: Select Column */}
        <div className={`bg-white dark:bg-gray-800 p-5 rounded-xl border shadow-sm transition-opacity ${(!filePath || loading) ? 'opacity-50 pointer-events-none border-gray-100 dark:border-gray-800' : 'border-gray-200 dark:border-gray-700'}`}>
          <h3 className="text-sm font-medium mb-3 text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xs font-bold">2</span>
            选择拆分依据的列
          </h3>
          
          {loading ? (
            <div className="flex items-center justify-center py-6 text-gray-400 text-sm gap-2">
              <Loader size={16} className="animate-spin" />
              正在读取表头...
            </div>
          ) : headers.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                系统将根据此列的不同内容，生成多个对应的独立 Excel 文件。
              </p>
              <div className="relative">
                <select
                  value={selectedColumnIndex}
                  onChange={(e) => setSelectedColumnIndex(Number(e.target.value))}
                  className="w-full pl-9 pr-4 py-2 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
                >
                  {headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h} (第 {i + 1} 列)
                    </option>
                  ))}
                </select>
                <ListFilter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              </div>
            </div>
          ) : (
             <div className="py-4 text-center text-xs text-gray-400">
               请先选择带有表头的文件
             </div>
          )}
        </div>

        {/* Step 3: Output Dir */}
        <div className={`bg-white dark:bg-gray-800 p-5 rounded-xl border shadow-sm transition-opacity ${(!filePath || headers.length === 0) ? 'opacity-50 pointer-events-none border-gray-100 dark:border-gray-800' : 'border-gray-200 dark:border-gray-700'}`}>
          <h3 className="text-sm font-medium mb-3 text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xs font-bold">3</span>
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
              onClick={handleSplit}
              disabled={!outputDir || processing}
              className="flex items-center gap-2 px-6 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed"
            >
              {processing ? (
                <>
                  <Loader size={16} className="animate-spin" />
                  拆分中...
                </>
              ) : (
                <>
                  <Play size={16} />
                  开始拆分
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
                拆分成功！共生成 {result.count} 个独立文件
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
            <p className="text-sm text-red-700 dark:text-red-300 flex-1">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
