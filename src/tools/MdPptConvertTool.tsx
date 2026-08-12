import { useState } from 'react';
import { open, save } from '@tauri-apps/api/dialog';
import { invoke } from '@tauri-apps/api/tauri';
import { FileText, FolderOpen, Loader } from 'lucide-react';
import ToolHeader from './ToolHeader';
import {
  basename,
  PandocErrorPanel,
  PandocResultPanel,
  PandocRuntimePanel,
  stem,
  usePandocRuntime,
  type PandocConvertOptions,
  type PandocConvertResult,
  type SelectedFile,
} from './PandocRuntime';
import { useToolTheme } from './useToolTheme';

export default function MdPptConvertTool() {
  const ready = useToolTheme();
  const runtimeState = usePandocRuntime();
  const [inputFile, setInputFile] = useState<SelectedFile | null>(null);
  const [referencePptx, setReferencePptx] = useState<SelectedFile | null>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<PandocConvertResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canConvert = !!inputFile && runtimeState.runtimeReady && !processing;

  async function selectInputFile() {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    });
    if (typeof selected !== 'string') return;
    setInputFile({ path: selected, name: basename(selected) });
    setResult(null);
    setError(null);
  }

  async function selectReferencePptx() {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'PPT 样式模板', extensions: ['pptx'] }],
    });
    if (typeof selected !== 'string') return;
    setReferencePptx({ path: selected, name: basename(selected) });
    setResult(null);
    setError(null);
  }

  async function convert() {
    if (!inputFile) return;
    if (!runtimeState.runtimeReady) {
      setError('Pandoc 未就绪，请先下载或选择已安装的 Pandoc。');
      return;
    }
    setProcessing(true);
    setResult(null);
    setError(null);

    try {
      const outputPath = await save({
        defaultPath: `${stem(inputFile.name)}_slides.pptx`,
        filters: [{ name: 'PowerPoint', extensions: ['pptx'] }],
      });
      if (!outputPath) {
        setProcessing(false);
        return;
      }

      const options: PandocConvertOptions = {
        referencePptx: referencePptx?.path || null,
      };
      const converted = await invoke<PandocConvertResult>('pandoc_convert_document', {
        inputPath: inputFile.path,
        outputPath,
        direction: 'mdToPptx',
        options,
      });
      setResult(converted);
      await runtimeState.refreshRuntime();
    } catch (err) {
      setError(String(err));
    } finally {
      setProcessing(false);
    }
  }

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col bg-gray-50 text-gray-800 dark:bg-gray-900 dark:text-gray-100">
      <ToolHeader
        icon="📽️"
        title="Markdown 转 PPT"
        subtitle="用 Markdown 快速生成 PPTX，可套用 reference.pptx 模板"
      />

      <div className="mx-auto w-full max-w-5xl flex-1 space-y-4 overflow-auto p-4">
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <PandocRuntimePanel runtimeState={runtimeState} />
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <FileBox
              label="输入 Markdown（.md / .markdown）"
              file={inputFile}
              empty="未选择 Markdown 文件"
            />
            <button
              onClick={selectInputFile}
              disabled={processing}
              className="flex items-center justify-center gap-1 rounded-lg bg-teal-500 px-4 py-2 text-sm text-white hover:bg-teal-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
            >
              <FolderOpen size={14} />
              选择文件
            </button>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto_auto]">
            <FileBox
              label="可选 PPT 模板（reference.pptx）"
              file={referencePptx}
              empty="未设置模板"
            />
            <button
              onClick={selectReferencePptx}
              disabled={processing}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              选择模板
            </button>
            <button
              onClick={() => setReferencePptx(null)}
              disabled={!referencePptx || processing}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              清除模板
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={convert}
              disabled={!canConvert}
              className="flex items-center gap-2 rounded-lg bg-blue-500 px-5 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
            >
              {processing ? <Loader size={14} className="animate-spin" /> : <FileText size={14} />}
              {processing ? '生成中...' : '生成 PPTX'}
            </button>
            <p className="text-xs text-gray-400">
              Markdown 中的一级/二级标题会作为幻灯片结构，图片和代码块由 Pandoc 写入 PPTX。
            </p>
          </div>
        </section>

        {result && <PandocResultPanel result={result} />}
        {error && <PandocErrorPanel message={error} />}
      </div>
    </div>
  );
}

function FileBox({
  label,
  file,
  empty,
}: {
  label: string;
  file: SelectedFile | null;
  empty: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/40">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-gray-700 dark:text-gray-200">
        {file ? file.name : empty}
      </p>
      {file && <p className="mt-0.5 truncate text-xs text-gray-400 dark:text-gray-500">{file.path}</p>}
    </div>
  );
}
