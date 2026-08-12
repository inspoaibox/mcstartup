import { useEffect, useMemo, useState } from 'react';
import { open } from '@tauri-apps/api/dialog';
import { invoke } from '@tauri-apps/api/tauri';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Loader,
  RefreshCw,
  Upload,
} from 'lucide-react';

interface WorkbookPreview {
  file_name: string;
  sheets: SheetMeta[];
}

interface SheetMeta {
  name: string;
  row_count: number;
  col_count: number;
  non_empty_cells: number;
  formula_cells: number;
}

interface SheetPage {
  sheet_name: string;
  page: number;
  page_size: number;
  total_rows: number;
  total_cols: number;
  total_pages: number;
  start_row_number: number;
  rows: PreviewRow[];
}

interface PreviewRow {
  row_number: number;
  cells: PreviewCell[];
}

interface PreviewCell {
  address: string;
  value: string;
  formula?: string | null;
  kind: string;
  is_empty: boolean;
}

const PAGE_SIZE_OPTIONS = [50, 100, 200, 500];

function toExcelColumnName(index: number) {
  let current = index;
  let name = '';
  while (true) {
    name = String.fromCharCode(65 + (current % 26)) + name;
    if (current < 26) break;
    current = Math.floor(current / 26) - 1;
  }
  return name;
}

export default function ExcelPreviewTool() {
  const ready = useToolTheme();
  const [filePath, setFilePath] = useState('');
  const [workbook, setWorkbook] = useState<WorkbookPreview | null>(null);
  const [activeSheet, setActiveSheet] = useState('');
  const [sheetPage, setSheetPage] = useState<SheetPage | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [selectedCell, setSelectedCell] = useState<PreviewCell | null>(null);
  const [loadingWorkbook, setLoadingWorkbook] = useState(false);
  const [loadingSheet, setLoadingSheet] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeSheetMeta = useMemo(
    () => workbook?.sheets.find((sheet) => sheet.name === activeSheet) ?? null,
    [activeSheet, workbook]
  );

  async function loadWorkbook(path: string) {
    setLoadingWorkbook(true);
    setError(null);
    setSelectedCell(null);
    try {
      const result = await invoke<WorkbookPreview>('excel_preview_get_workbook', {
        filePath: path,
      });
      setFilePath(path);
      setWorkbook(result);
      const firstSheet = result.sheets[0]?.name ?? '';
      setActiveSheet(firstSheet);
      setPage(1);
    } catch (e) {
      setWorkbook(null);
      setSheetPage(null);
      setActiveSheet('');
      setError(String(e));
    } finally {
      setLoadingWorkbook(false);
    }
  }

  async function pickFile() {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xls', 'xlsm', 'xlsb', 'ods', 'csv'] }],
    });
    if (typeof selected === 'string') {
      await loadWorkbook(selected);
    }
  }

  useEffect(() => {
    if (!filePath || !activeSheet) return;

    let cancelled = false;

    async function loadSheetPage() {
      setLoadingSheet(true);
      setError(null);
      try {
        const result = await invoke<SheetPage>('excel_preview_get_sheet_page', {
          filePath,
          sheetName: activeSheet,
          page,
          pageSize,
        });
        if (cancelled) return;
        setSheetPage(result);
        setSelectedCell((current) =>
          current && result.rows.some((row) => row.cells.some((cell) => cell.address === current.address))
            ? current
            : null
        );
      } catch (e) {
        if (!cancelled) {
          setSheetPage(null);
          setError(String(e));
        }
      } finally {
        if (!cancelled) {
          setLoadingSheet(false);
        }
      }
    }

    loadSheetPage();
    return () => {
      cancelled = true;
    };
  }, [activeSheet, filePath, page, pageSize]);

  if (!ready) return null;

  const columnCount = sheetPage?.total_cols ?? 0;

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <ToolHeader
        icon="📄"
        title="Excel 预览"
        subtitle={workbook ? `本地预览 · ${workbook.file_name}` : '无需 Office，支持多 sheet 与公式查看'}
      />

      {!workbook ? (
        <div className="flex-1 p-4">
          <div
            onClick={pickFile}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={async (e) => {
              e.preventDefault();
              setDragging(false);
              const file = Array.from(e.dataTransfer.files)[0] as File & { path?: string };
              if (file?.path) {
                await loadWorkbook(file.path);
              }
            }}
            className={`h-full rounded-2xl border-2 border-dashed transition-colors flex flex-col items-center justify-center px-6 text-center cursor-pointer ${
              dragging
                ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/10'
                : 'border-gray-300 dark:border-gray-600 hover:border-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/10'
            }`}
          >
            {loadingWorkbook ? (
              <div className="flex flex-col items-center gap-3 text-gray-500 dark:text-gray-400">
                <Loader size={28} className="animate-spin" />
                <p className="text-sm">正在读取工作簿...</p>
              </div>
            ) : (
              <>
                <Upload size={34} className="text-gray-400 mb-3" />
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  点击选择或将 Excel 文件拖到页面中
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                  支持 .xlsx / .xls / .xlsm / .xlsb / .ods / .csv
                </p>
                <div className="mt-6 max-w-2xl rounded-xl bg-white/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 p-4 text-left">
                  <p className="text-sm font-medium mb-2">工具介绍</p>
                  <div className="space-y-2 text-xs leading-5 text-gray-500 dark:text-gray-400">
                    <p>无需安装 Office，即可在本地快速预览 Excel 文件中的每个 sheet 工作表内容。</p>
                    <p>支持分页浏览大表格，点击单元格可以查看值、地址和公式，适合临时核对与分析数据。</p>
                    <p>所有解析都在本地完成，不会上传到网络服务器。</p>
                  </div>
                </div>
              </>
            )}
          </div>

          {error && (
            <div className="mt-4 p-3 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 flex items-center gap-2">
              <AlertCircle size={16} className="text-red-500 flex-shrink-0" />
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex">
          <aside className="w-72 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-800/60 flex flex-col">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
                  <FileSpreadsheet size={18} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{workbook.file_name}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{filePath}</p>
                </div>
              </div>
              <button
                onClick={pickFile}
                className="w-full text-sm px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white transition-colors"
              >
                重新选择文件
              </button>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-gray-50 dark:bg-gray-900/60 px-3 py-2">
                  <p className="text-gray-400">工作表</p>
                  <p className="mt-1 font-medium">{workbook.sheets.length}</p>
                </div>
                <div className="rounded-lg bg-gray-50 dark:bg-gray-900/60 px-3 py-2">
                  <p className="text-gray-400">当前页大小</p>
                  <p className="mt-1 font-medium">{pageSize} 行</p>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-3 space-y-2">
              {workbook.sheets.map((sheet) => {
                const active = sheet.name === activeSheet;
                return (
                  <button
                    key={sheet.name}
                    onClick={() => {
                      setActiveSheet(sheet.name);
                      setPage(1);
                      setSelectedCell(null);
                    }}
                    className={`w-full text-left rounded-xl border p-3 transition-colors ${
                      active
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-emerald-300 bg-white dark:bg-gray-800'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium truncate">{sheet.name}</p>
                      {sheet.formula_cells > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                          fx {sheet.formula_cells}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
                      {sheet.row_count} 行 · {sheet.col_count} 列
                    </p>
                    <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                      非空单元格 {sheet.non_empty_cells}
                    </p>
                  </button>
                );
              })}
            </div>
          </aside>

          <main className="flex-1 min-w-0 flex flex-col">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-800/50 flex items-center gap-3 flex-wrap">
              <div>
                <p className="text-sm font-medium">{activeSheet}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  {activeSheetMeta ? `${activeSheetMeta.row_count} 行 · ${activeSheetMeta.col_count} 列` : '读取中'}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => filePath && loadWorkbook(filePath)}
                  disabled={loadingWorkbook || loadingSheet}
                  className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                  title="刷新预览"
                >
                  <RefreshCw size={14} className={loadingWorkbook || loadingSheet ? 'animate-spin' : ''} />
                </button>

                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2"
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      每页 {size} 行
                    </option>
                  ))}
                </select>

                <div className="flex items-center rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <button
                    onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                    disabled={!sheetPage || sheetPage.page <= 1 || loadingSheet}
                    className="px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <div className="px-3 py-2 text-sm bg-white dark:bg-gray-800 min-w-[92px] text-center">
                    {sheetPage ? `${sheetPage.page} / ${sheetPage.total_pages}` : '...'}
                  </div>
                  <button
                    onClick={() =>
                      setPage((prev) =>
                        sheetPage ? Math.min(sheetPage.total_pages, prev + 1) : prev + 1
                      )
                    }
                    disabled={!sheetPage || sheetPage.page >= sheetPage.total_pages || loadingSheet}
                    className="px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </div>

            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-900/50 grid grid-cols-1 xl:grid-cols-[160px_minmax(0,1fr)] gap-3">
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2">
                <p className="text-[11px] text-gray-400 mb-1">当前单元格</p>
                <p className="text-sm font-medium">{selectedCell?.address ?? '未选择'}</p>
                {selectedCell && (
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                    类型：{selectedCell.kind}
                  </p>
                )}
              </div>
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 space-y-2">
                <div>
                  <p className="text-[11px] text-gray-400 mb-1">值</p>
                  <p className="text-sm whitespace-pre-wrap break-all min-h-[20px]">
                    {selectedCell ? (selectedCell.value || '(空)') : '点击表格中的单元格查看详情'}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-gray-400 mb-1">公式</p>
                  <p className="text-xs font-mono whitespace-pre-wrap break-all text-amber-600 dark:text-amber-300 min-h-[18px]">
                    {selectedCell?.formula || '当前单元格没有公式'}
                  </p>
                </div>
              </div>
            </div>

            {error && (
              <div className="mx-4 mt-4 p-3 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 flex items-center gap-2">
                <AlertCircle size={16} className="text-red-500 flex-shrink-0" />
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            <div className="flex-1 min-h-0 p-4">
              <div className="h-full rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-800 overflow-hidden">
                {loadingSheet ? (
                  <div className="h-full flex flex-col items-center justify-center gap-3 text-gray-400">
                    <Loader size={24} className="animate-spin" />
                    <p className="text-sm">正在加载工作表数据...</p>
                  </div>
                ) : !sheetPage ? (
                  <div className="h-full flex items-center justify-center text-sm text-gray-400">
                    暂无可预览内容
                  </div>
                ) : (
                  <div className="h-full overflow-auto">
                    <table className="border-separate border-spacing-0 text-sm">
                      <thead className="sticky top-0 z-20">
                        <tr>
                          <th className="sticky left-0 z-30 bg-gray-100 dark:bg-gray-900 border-b border-r border-gray-200 dark:border-gray-700 px-3 py-2 text-[11px] text-gray-400 min-w-[72px]">
                            行号
                          </th>
                          {Array.from({ length: columnCount }, (_, index) => (
                            <th
                              key={index}
                              className="bg-gray-100 dark:bg-gray-900 border-b border-r border-gray-200 dark:border-gray-700 px-3 py-2 text-[11px] text-gray-500"
                              style={{ width: 180, minWidth: 180, maxWidth: 180 }}
                            >
                              {toExcelColumnName(index)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sheetPage.rows.map((row) => (
                          <tr key={row.row_number}>
                            <td className="sticky left-0 z-10 bg-gray-50 dark:bg-gray-900 border-b border-r border-gray-200 dark:border-gray-800 px-3 py-2 text-[11px] text-gray-500 font-medium">
                              {row.row_number}
                            </td>
                            {row.cells.map((cell) => {
                              const selected = selectedCell?.address === cell.address;
                              return (
                                <td
                                  key={cell.address}
                                  onClick={() => setSelectedCell(cell)}
                                  title={cell.value || undefined}
                                  className={`border-b border-r border-gray-200 dark:border-gray-800 px-3 py-2 align-top cursor-pointer transition-colors ${
                                    selected
                                      ? 'bg-emerald-50 dark:bg-emerald-900/20'
                                      : cell.formula
                                        ? 'bg-amber-50/60 dark:bg-amber-900/10 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                                        : 'hover:bg-gray-50 dark:hover:bg-gray-700/40'
                                  }`}
                                  style={{ width: 180, minWidth: 180, maxWidth: 180 }}
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    {cell.formula && (
                                      <span className="text-[10px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 flex-shrink-0">
                                        fx
                                      </span>
                                    )}
                                    <span
                                      className={`block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap ${
                                        cell.is_empty ? 'text-gray-300 dark:text-gray-600' : ''
                                      }`}
                                    >
                                      {cell.value || '\u00A0'}
                                    </span>
                                  </div>
                                </td>
                              );
                            })}
                            {row.cells.length < columnCount &&
                              Array.from({ length: columnCount - row.cells.length }).map((_, fillerIndex) => (
                                <td
                                  key={`${row.row_number}-empty-${fillerIndex}`}
                                  className="border-b border-r border-gray-200 dark:border-gray-800 px-3 py-2"
                                />
                              ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </main>
        </div>
      )}
    </div>
  );
}
