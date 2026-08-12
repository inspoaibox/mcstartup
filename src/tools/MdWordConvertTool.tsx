import { useMemo, useState } from 'react';
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

type ConvertDirection = 'mdToDocx' | 'docxToMd';

const BUILTIN_DOCX_TEMPLATES = [
  { id: 'none', label: '默认样式（不使用模板）' },
  { id: 'general-report', label: '通用报告模板' },
  { id: 'business-proposal', label: '商务方案模板' },
  { id: 'tech-doc', label: '技术文档模板' },
  { id: 'official-simple', label: '公文简洁模板' },
  { id: 'custom', label: '选择本地 reference.docx' },
] as const;

export default function MdWordConvertTool() {
  const ready = useToolTheme();
  const runtimeState = usePandocRuntime();

  const [direction, setDirection] = useState<ConvertDirection>('mdToDocx');
  const [inputFile, setInputFile] = useState<SelectedFile | null>(null);
  const [referenceDocx, setReferenceDocx] = useState<SelectedFile | null>(null);
  const [referenceTemplate, setReferenceTemplate] = useState('none');
  const [extractMedia, setExtractMedia] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<PandocConvertResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canConvert = !!inputFile && runtimeState.runtimeReady && !processing;

  const inputHint = useMemo(
    () =>
      direction === 'mdToDocx'
        ? '输入 Markdown（.md / .markdown）'
        : '输入 Word（.docx）',
    [direction]
  );

  async function selectInputFile() {
    const selected = await open({
      multiple: false,
      filters:
        direction === 'mdToDocx'
          ? [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
          : [{ name: 'Word 文档', extensions: ['docx'] }],
    });
    if (typeof selected !== 'string') return;
    setInputFile({ path: selected, name: basename(selected) });
    setResult(null);
    setError(null);
  }

  async function selectReferenceDocx() {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Word 样式模板', extensions: ['docx'] }],
    });
    if (typeof selected !== 'string') return;
    setReferenceDocx({ path: selected, name: basename(selected) });
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
      const defaultPath =
        direction === 'mdToDocx'
          ? `${stem(inputFile.name)}_converted.docx`
          : `${stem(inputFile.name)}_converted.md`;
      const outputPath = await save({
        defaultPath,
        filters:
          direction === 'mdToDocx'
            ? [{ name: 'Word 文档', extensions: ['docx'] }]
            : [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (!outputPath) {
        setProcessing(false);
        return;
      }

      const options: PandocConvertOptions =
        direction === 'mdToDocx'
          ? {
              referenceDocx: referenceTemplate === 'custom' ? referenceDocx?.path || null : null,
              referenceDocxTemplate: referenceTemplate === 'custom' ? null : referenceTemplate,
            }
          : { extractMedia };

      const converted = await invoke<PandocConvertResult>('pandoc_convert_document', {
        inputPath: inputFile.path,
        outputPath,
        direction,
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
        icon="🧾"
        title="Markdown / Word 互转"
        subtitle="首次使用按需下载 Pandoc，不增加安装包体积"
      />

      <div className="mx-auto w-full max-w-5xl flex-1 space-y-4 overflow-auto p-4">
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <PandocRuntimePanel runtimeState={runtimeState} />
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setDirection('mdToDocx');
                setInputFile(null);
                setResult(null);
                setError(null);
              }}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                direction === 'mdToDocx'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              MD {'->'} DOCX
            </button>
            <button
              type="button"
              onClick={() => {
                setDirection('docxToMd');
                setInputFile(null);
                setResult(null);
                setError(null);
              }}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                direction === 'docxToMd'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              DOCX {'->'} MD
            </button>
            <div className="ml-auto text-xs text-gray-400">不支持 .doc 老格式</div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/40">
              <p className="text-xs text-gray-500 dark:text-gray-400">{inputHint}</p>
              <p className="mt-1 truncate text-sm font-medium text-gray-700 dark:text-gray-200">
                {inputFile ? inputFile.name : '未选择文件'}
              </p>
              {inputFile && (
                <p className="mt-0.5 truncate text-xs text-gray-400 dark:text-gray-500">
                  {inputFile.path}
                </p>
              )}
            </div>
            <button
              onClick={selectInputFile}
              disabled={processing}
              className="flex items-center justify-center gap-1 rounded-lg bg-teal-500 px-4 py-2 text-sm text-white hover:bg-teal-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
            >
              <FolderOpen size={14} />
              选择文件
            </button>
          </div>

          {direction === 'mdToDocx' && (
            <div className="mt-3 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
                  可选样式模板
                </span>
                <select
                  value={referenceTemplate}
                  onChange={(event) => {
                    setReferenceTemplate(event.target.value);
                    if (event.target.value !== 'custom') setReferenceDocx(null);
                  }}
                  disabled={processing}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-gray-600 dark:bg-gray-700"
                >
                  {BUILTIN_DOCX_TEMPLATES.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.label}
                    </option>
                  ))}
                </select>
              </label>

              {referenceTemplate === 'custom' && (
                <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/40">
                    <p className="text-xs text-gray-500 dark:text-gray-400">本地 reference.docx</p>
                    <p className="mt-1 truncate text-sm font-medium text-gray-700 dark:text-gray-200">
                      {referenceDocx ? referenceDocx.name : '未选择本地模板'}
                    </p>
                    {referenceDocx && (
                      <p className="mt-0.5 truncate text-xs text-gray-400 dark:text-gray-500">
                        {referenceDocx.path}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={selectReferenceDocx}
                    disabled={processing}
                    className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    选择模板
                  </button>
                  <button
                    onClick={() => setReferenceDocx(null)}
                    disabled={!referenceDocx || processing}
                    className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    清除模板
                  </button>
                </div>
              )}
            </div>
          )}

          {direction === 'docxToMd' && (
            <label className="mt-3 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <input
                type="checkbox"
                checked={extractMedia}
                onChange={(event) => setExtractMedia(event.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-500 focus:ring-blue-400"
              />
              抽取图片到同目录 `*_media` 文件夹
            </label>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={convert}
              disabled={!canConvert}
              className="flex items-center gap-2 rounded-lg bg-blue-500 px-5 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
            >
              {processing ? <Loader size={14} className="animate-spin" /> : <FileText size={14} />}
              {processing ? '转换中...' : '开始转换'}
            </button>
            <p className="text-xs text-gray-400">
              {direction === 'mdToDocx'
                ? '支持 Markdown 正文、列表、表格、代码块、图片链接。'
                : '输出 Markdown 并尽量保留文档结构。'}
            </p>
          </div>
        </section>

        {result && <PandocResultPanel result={result} />}
        {error && <PandocErrorPanel message={error} />}
      </div>
    </div>
  );
}
