import { useState } from 'react';
import { open, save } from '@tauri-apps/api/dialog';
import { invoke } from '@tauri-apps/api/tauri';
import { BookOpen, FolderOpen, Loader } from 'lucide-react';
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

export default function EpubGeneratorTool() {
  const ready = useToolTheme();
  const runtimeState = usePandocRuntime();
  const [inputFile, setInputFile] = useState<SelectedFile | null>(null);
  const [coverImage, setCoverImage] = useState<SelectedFile | null>(null);
  const [cssFile, setCssFile] = useState<SelectedFile | null>(null);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [toc, setToc] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<PandocConvertResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canConvert = !!inputFile && runtimeState.runtimeReady && !processing;

  async function selectInputFile() {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: '文档',
          extensions: ['md', 'markdown', 'docx', 'html', 'htm', 'txt'],
        },
      ],
    });
    if (typeof selected !== 'string') return;
    const name = basename(selected);
    setInputFile({ path: selected, name });
    if (!title.trim()) setTitle(stem(name));
    setResult(null);
    setError(null);
  }

  async function selectCoverImage() {
    const selected = await open({
      multiple: false,
      filters: [{ name: '封面图片', extensions: ['png', 'jpg', 'jpeg'] }],
    });
    if (typeof selected !== 'string') return;
    setCoverImage({ path: selected, name: basename(selected) });
    setResult(null);
    setError(null);
  }

  async function selectCssFile() {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'CSS 样式', extensions: ['css'] }],
    });
    if (typeof selected !== 'string') return;
    setCssFile({ path: selected, name: basename(selected) });
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
        defaultPath: `${stem(inputFile.name)}.epub`,
        filters: [{ name: 'EPUB 电子书', extensions: ['epub'] }],
      });
      if (!outputPath) {
        setProcessing(false);
        return;
      }

      const options: PandocConvertOptions = {
        metadataTitle: title.trim() || null,
        metadataAuthor: author.trim() || null,
        epubCoverImage: coverImage?.path || null,
        epubCss: cssFile?.path || null,
        toc,
      };
      const converted = await invoke<PandocConvertResult>('pandoc_convert_document', {
        inputPath: inputFile.path,
        outputPath,
        direction: 'toEpub',
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
        icon="📚"
        title="EPUB 电子书生成器"
        subtitle="把 Markdown、DOCX、HTML 或 TXT 转成 EPUB，可设置封面和目录"
      />

      <div className="mx-auto w-full max-w-5xl flex-1 space-y-4 overflow-auto p-4">
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <PandocRuntimePanel runtimeState={runtimeState} />
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <FileBox
              label="输入文档"
              file={inputFile}
              empty="支持 .md / .docx / .html / .txt"
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

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">书名</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-gray-600 dark:bg-gray-700"
                placeholder="默认使用文件名"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">作者</span>
              <input
                value={author}
                onChange={(event) => setAuthor(event.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-gray-600 dark:bg-gray-700"
                placeholder="可选"
              />
            </label>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto_auto]">
            <FileBox label="可选封面图片" file={coverImage} empty="PNG / JPG" />
            <button
              onClick={selectCoverImage}
              disabled={processing}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              选择封面
            </button>
            <button
              onClick={() => setCoverImage(null)}
              disabled={!coverImage || processing}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              清除封面
            </button>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto_auto]">
            <FileBox label="可选 CSS 样式" file={cssFile} empty="自定义 EPUB 阅读样式" />
            <button
              onClick={selectCssFile}
              disabled={processing}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              选择 CSS
            </button>
            <button
              onClick={() => setCssFile(null)}
              disabled={!cssFile || processing}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              清除 CSS
            </button>
          </div>

          <label className="mt-3 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <input
              type="checkbox"
              checked={toc}
              onChange={(event) => setToc(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-500 focus:ring-blue-400"
            />
            根据标题生成目录
          </label>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={convert}
              disabled={!canConvert}
              className="flex items-center gap-2 rounded-lg bg-blue-500 px-5 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
            >
              {processing ? <Loader size={14} className="animate-spin" /> : <BookOpen size={14} />}
              {processing ? '生成中...' : '生成 EPUB'}
            </button>
            <p className="text-xs text-gray-400">
              适合教程、手册、长文章和资料汇编，输出标准 EPUB 文件。
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
