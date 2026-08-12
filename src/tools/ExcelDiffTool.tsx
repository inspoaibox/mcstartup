import { useState } from 'react';
import { open, save } from '@tauri-apps/api/dialog';
import { invoke } from '@tauri-apps/api/tauri';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import {
  Upload,
  CheckCircle,
  Loader,
  AlertCircle,
  Play,
  FileSpreadsheet,
  ListFilter
} from 'lucide-react';

export default function ExcelDiffTool() {
  const ready = useToolTheme();
  
  const [fileA, setFileA] = useState<{ path: string; name: string } | null>(null);
  const [fileB, setFileB] = useState<{ path: string; name: string } | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [selectedColumnName, setSelectedColumnName] = useState<string>('');
  
  const [loadingA, setLoadingA] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{ path: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectFileA = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xls', 'csv', 'ods'] }],
    });
    
    if (!selected || Array.isArray(selected)) return;
    
    setFileA({
      path: selected,
      name: selected.split(/[\\/]/).pop() || selected
    });
    setResult(null);
    setError(null);
    setHeaders([]);
    setLoadingA(true);
    
    try {
      const cols = await invoke<string[]>('get_excel_headers', { path: selected });
      setHeaders(cols);
      if (cols.length > 0) {
        setSelectedColumnName(cols[0]);
      }
    } catch (e: any) {
      setError(e.toString() || '读取文件 A 表头失败');
    } finally {
      setLoadingA(false);
    }
  };

  const selectFileB = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xls', 'csv', 'ods'] }],
    });
    
    if (!selected || Array.isArray(selected)) return;
    
    setFileB({
      path: selected,
      name: selected.split(/[\\/]/).pop() || selected
    });
    setResult(null);
    setError(null);
  };

  const handleDiff = async () => {
    if (!fileA || !fileB || !selectedColumnName) return;
    
    setProcessing(true);
    setError(null);
    setResult(null);
    
    try {
      const outPath = await save({
        defaultPath: '对比结果.xlsx',
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      });
      
      if (!outPath) {
        setProcessing(false);
        return;
      }
      
      const res = await invoke<string>('diff_excel_files', {
        pathA: fileA.path,
        pathB: fileB.path,
        keyColumnName: selectedColumnName,
        outputPath: outPath
      });
      
      setResult({ path: res });
    } catch (e: any) {
      setError(e.toString() || '对比失败');
    } finally {
      setProcessing(false);
    }
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <ToolHeader
        icon="⚖️"
        title="Excel 数据对比"
        subtitle="智能比对两份 Excel 表格的数据差异（新增、删除、修改），并高亮导出结果"
      />

      <div className="flex-1 overflow-auto p-6 flex flex-col gap-6 max-w-4xl mx-auto w-full">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* File A */}
          <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <h3 className="text-sm font-medium mb-3 text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xs font-bold">A</span>
              旧版本 / 原表格
            </h3>
            
            {!fileA ? (
              <div
                onClick={selectFileA}
                className="h-28 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-colors"
              >
                <Upload size={24} className="text-gray-400 mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-400">选择文件 A</p>
              </div>
            ) : (
              <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/50 rounded-lg h-28">
                <div className="flex items-center gap-3 overflow-hidden">
                  <FileSpreadsheet size={20} className="text-blue-500 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{fileA.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-1">{fileA.path}</p>
                  </div>
                </div>
                <button 
                  onClick={selectFileA}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex-shrink-0 ml-4"
                >
                  更换
                </button>
              </div>
            )}
          </div>

          {/* File B */}
          <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <h3 className="text-sm font-medium mb-3 text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xs font-bold">B</span>
              新版本 / 修改后表格
            </h3>
            
            {!fileB ? (
              <div
                onClick={selectFileB}
                className="h-28 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-colors"
              >
                <Upload size={24} className="text-gray-400 mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-400">选择文件 B</p>
              </div>
            ) : (
              <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/50 rounded-lg h-28">
                <div className="flex items-center gap-3 overflow-hidden">
                  <FileSpreadsheet size={20} className="text-blue-500 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{fileB.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-1">{fileB.path}</p>
                  </div>
                </div>
                <button 
                  onClick={selectFileB}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex-shrink-0 ml-4"
                >
                  更换
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Step 3: Select Key Column */}
        <div className={`bg-white dark:bg-gray-800 p-5 rounded-xl border shadow-sm transition-opacity ${(!fileA || loadingA) ? 'opacity-50 pointer-events-none border-gray-100 dark:border-gray-800' : 'border-gray-200 dark:border-gray-700'}`}>
          <h3 className="text-sm font-medium mb-3 text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xs font-bold">KEY</span>
            选择对比基准列 (主键)
          </h3>
          
          {loadingA ? (
            <div className="flex items-center justify-center py-6 text-gray-400 text-sm gap-2">
              <Loader size={16} className="animate-spin" />
              正在读取表头...
            </div>
          ) : headers.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                系统将根据此列（如工号、订单号、身份证号等唯一标识）来判断数据是新增、删除还是修改。
                <br/>
                <span className="text-red-500 dark:text-red-400 mt-1 inline-block">注意：请确保文件 A 和 B 中都有这一列！</span>
              </p>
              <div className="relative max-w-md">
                <select
                  value={selectedColumnName}
                  onChange={(e) => setSelectedColumnName(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
                >
                  {headers.map((h, i) => (
                    <option key={i} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
                <ListFilter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              </div>
            </div>
          ) : (
             <div className="py-4 text-center text-xs text-gray-400">
               请先选择文件 A 以读取表头
             </div>
          )}
        </div>

        {/* Execute */}
        <div className="flex justify-center mt-4">
          <button
            onClick={handleDiff}
            disabled={!fileA || !fileB || !selectedColumnName || processing}
            className="flex items-center gap-2 px-8 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white rounded-xl text-sm font-medium transition-colors disabled:cursor-not-allowed shadow-md shadow-blue-500/20 disabled:shadow-none"
          >
            {processing ? (
              <>
                <Loader size={18} className="animate-spin" />
                正在智能比对...
              </>
            ) : (
              <>
                <Play size={18} />
                开始比对并导出
              </>
            )}
          </button>
        </div>

        {/* Result & Error */}
        {result && (
          <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/50 rounded-xl flex items-start gap-3">
            <CheckCircle size={18} className="text-green-500 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-green-800 dark:text-green-300">
                对比完成！已导出高亮结果。
              </p>
              <p className="text-xs text-green-600 dark:text-green-400/70 mt-1 select-all">
                已保存至：{result.path}
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
        
        {/* Color Legend */}
        <div className="flex items-center justify-center gap-6 text-xs text-gray-500 dark:text-gray-400 mt-4">
            <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded bg-[#C6EFCE] border border-[#006100]"></span>
                表示文件 B 中新增的数据
            </div>
            <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded bg-[#FFC7CE] border border-[#9C0006]"></span>
                表示文件 B 中删掉的数据
            </div>
            <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded bg-[#FFEB9C] border border-[#9C6500]"></span>
                表示有变化（修改过）的单元格
            </div>
        </div>
      </div>
    </div>
  );
}
