import { useState, useMemo } from 'react';
import { Copy, Check, RotateCcw, Link, Filter, ChevronDown, ChevronUp } from 'lucide-react';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';

// ─── URL 提取核心逻辑 ─────────────────────────────────────────────

const URL_REGEX = /https?:\/\/(?:[-\w]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s"'<>()[\]{}|\\^`]*)?/gi;

function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX) ?? [];
  // 去重
  return [...new Set(matches.map((u) => u.replace(/[.,;:!?)]+$/, '').trim()))];
}

function getExtension(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const dot = pathname.lastIndexOf('.');
    if (dot === -1) return '';
    return pathname
      .slice(dot + 1)
      .toLowerCase()
      .split('?')[0];
  } catch {
    return '';
  }
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// ─── 预设扩展名分组 ───────────────────────────────────────────────

const EXT_PRESETS: { label: string; exts: string[] }[] = [
  { label: '图片', exts: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'] },
  { label: '视频', exts: ['mp4', 'webm', 'mov', 'avi', 'mkv', 'flv', 'm3u8', 'ts'] },
  { label: '音频', exts: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'] },
  { label: '文档', exts: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md'] },
  { label: '压缩包', exts: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'] },
  { label: '代码', exts: ['js', 'ts', 'css', 'html', 'json', 'xml', 'yaml', 'yml'] },
];

// ─── 主组件 ───────────────────────────────────────────────────────

export default function UrlExtractorTool() {
  const ready = useToolTheme();

  const [input, setInput] = useState('');
  const [extFilter, setExtFilter] = useState(''); // 逗号分隔的扩展名
  const [domainFilter, setDomainFilter] = useState(''); // 逗号分隔的域名
  const [domainMode, setDomainMode] = useState<'include' | 'exclude'>('include'); // 域名模式：仅包含 / 排除
  const [showNoExt, setShowNoExt] = useState(true); // 是否显示无扩展名的 URL
  const [outputFormat, setOutputFormat] = useState<'line' | 'comma' | 'json'>('line');
  const [copied, setCopied] = useState(false);
  const [showFilter, setShowFilter] = useState(true);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);

  // 解析过滤条件
  const extList = useMemo(
    () =>
      extFilter
        .split(/[,，\s]+/)
        .map((e) => e.trim().toLowerCase().replace(/^\./, ''))
        .filter(Boolean),
    [extFilter]
  );

  const domainList = useMemo(
    () =>
      domainFilter
        .split(/[,，\s]+/)
        .map((d) =>
          d
            .trim()
            .toLowerCase()
            .replace(/^www\./, '')
        )
        .filter(Boolean),
    [domainFilter]
  );

  // 提取 + 过滤
  const allUrls = useMemo(() => extractUrls(input), [input]);

  const filteredUrls = useMemo(() => {
    return allUrls.filter((url) => {
      const ext = getExtension(url);
      const domain = getDomain(url);

      // 域名过滤
      if (domainList.length > 0) {
        const matched = domainList.some((d) => domain === d || domain.endsWith('.' + d));
        if (domainMode === 'include' && !matched) return false; // 仅包含：不匹配则排除
        if (domainMode === 'exclude' && matched) return false; // 排除：匹配则排除
      }

      // 扩展名过滤
      if (extList.length > 0) {
        if (!ext) return showNoExt;
        return extList.includes(ext);
      }

      return true;
    });
  }, [allUrls, extList, domainList, domainMode, showNoExt]);

  // 输出格式化
  const output = useMemo(() => {
    if (filteredUrls.length === 0) return '';
    switch (outputFormat) {
      case 'comma':
        return filteredUrls.join(', ');
      case 'json':
        return JSON.stringify(filteredUrls, null, 2);
      default:
        return filteredUrls.join('\n');
    }
  }, [filteredUrls, outputFormat]);

  // 统计各扩展名数量
  const extStats = useMemo(() => {
    const map: Record<string, number> = {};
    allUrls.forEach((url) => {
      const ext = getExtension(url) || '(无扩展名)';
      map[ext] = (map[ext] ?? 0) + 1;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [allUrls]);

  const handleCopy = () => {
    if (!output) return;
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleClear = () => {
    setInput('');
    setExtFilter('');
    setDomainFilter('');
    setSelectedPreset(null);
  };

  const applyPreset = (preset: { label: string; exts: string[] }) => {
    if (selectedPreset === preset.label) {
      setExtFilter('');
      setSelectedPreset(null);
    } else {
      setExtFilter(preset.exts.join(', '));
      setSelectedPreset(preset.label);
    }
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900 rounded-2xl overflow-hidden shadow-2xl border border-gray-200/50 dark:border-gray-700/50">
      <ToolHeader
        icon="🔗"
        title="URL 提取器"
        subtitle={
          allUrls.length > 0
            ? `共 ${allUrls.length} 条${filteredUrls.length !== allUrls.length ? ` · 过滤后 ${filteredUrls.length} 条` : ''}`
            : undefined
        }
        closeMode="hide"
        actions={
          <button
            onClick={() => setShowFilter((v) => !v)}
            title="过滤选项"
            className={`p-1.5 rounded-lg transition-colors ${showFilter ? 'text-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
          >
            <Filter size={14} />
          </button>
        }
      />

      <div className="flex-1 flex min-h-0">
        {/* 主内容 */}
        <div className="flex-1 flex flex-col p-4 gap-3 min-h-0 overflow-hidden">
          {/* 过滤面板 */}
          {showFilter && (
            <div className="flex-shrink-0 space-y-2.5 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700">
              {/* 预设快捷按钮 */}
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                  快速筛选类型
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {EXT_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      onClick={() => applyPreset(preset)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                        selectedPreset === preset.label
                          ? 'bg-blue-500 text-white'
                          : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-600 hover:border-blue-400 hover:text-blue-600'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {/* 扩展名过滤 */}
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    扩展名过滤
                    <span className="text-gray-400 font-normal ml-1">
                      （逗号分隔，如 jpg, png）
                    </span>
                  </label>
                  <input
                    type="text"
                    value={extFilter}
                    onChange={(e) => {
                      setExtFilter(e.target.value);
                      setSelectedPreset(null);
                    }}
                    placeholder="jpg, png, pdf ..."
                    className="w-full px-2.5 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* 域名过滤 */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs text-gray-500 dark:text-gray-400">
                      域名
                      <span className="text-gray-400 font-normal ml-1">（逗号分隔）</span>
                    </label>
                    {/* 仅包含 / 排除 切换 */}
                    <div className="flex items-center gap-0.5 p-0.5 bg-gray-100 dark:bg-gray-600 rounded-md">
                      <button
                        onClick={() => setDomainMode('include')}
                        className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                          domainMode === 'include'
                            ? 'bg-blue-500 text-white shadow-sm'
                            : 'text-gray-500 dark:text-gray-300 hover:text-gray-700'
                        }`}
                      >
                        仅包含
                      </button>
                      <button
                        onClick={() => setDomainMode('exclude')}
                        className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                          domainMode === 'exclude'
                            ? 'bg-orange-500 text-white shadow-sm'
                            : 'text-gray-500 dark:text-gray-300 hover:text-gray-700'
                        }`}
                      >
                        排除
                      </button>
                    </div>
                  </div>
                  <input
                    type="text"
                    value={domainFilter}
                    onChange={(e) => setDomainFilter(e.target.value)}
                    placeholder={
                      domainMode === 'include'
                        ? '只保留这些域名，如 github.com'
                        : '排除这些域名，如 ads.com'
                    }
                    className={`w-full px-2.5 py-1.5 text-sm border rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 transition-colors ${
                      domainMode === 'exclude'
                        ? 'border-orange-300 dark:border-orange-600 focus:ring-orange-400'
                        : 'border-gray-200 dark:border-gray-600 focus:ring-blue-500'
                    }`}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showNoExt}
                    onChange={(e) => setShowNoExt(e.target.checked)}
                    className="w-3.5 h-3.5 rounded text-blue-500"
                  />
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    包含无扩展名的 URL（仅在设置了扩展名过滤时生效）
                  </span>
                </label>

                {/* 输出格式 */}
                <div className="flex items-center gap-1 p-0.5 bg-white dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
                  {(['line', 'comma', 'json'] as const).map((fmt) => (
                    <button
                      key={fmt}
                      onClick={() => setOutputFormat(fmt)}
                      className={`px-2 py-0.5 rounded text-xs transition-colors ${
                        outputFormat === fmt
                          ? 'bg-blue-500 text-white'
                          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
                      }`}
                    >
                      {fmt === 'line' ? '换行' : fmt === 'comma' ? '逗号' : 'JSON'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 双栏编辑区 */}
          <div className="flex-1 grid grid-cols-2 gap-3 min-h-0">
            {/* 输入 */}
            <div className="flex flex-col gap-1 min-h-0">
              <div className="flex items-center justify-between flex-shrink-0">
                <label className="text-xs text-gray-500 dark:text-gray-400">粘贴文本内容</label>
                <button
                  onClick={handleClear}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                >
                  <RotateCcw size={10} />
                  清空
                </button>
              </div>
              <textarea
                autoFocus
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  '将包含 URL 的文本粘贴到这里...\n\n支持从网页源码、日志、文章等任意文本中提取 http/https 链接，自动去重。'
                }
                className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
            </div>

            {/* 输出 */}
            <div className="flex flex-col gap-1 min-h-0">
              <div className="flex items-center justify-between flex-shrink-0">
                <label className="text-xs text-gray-500 dark:text-gray-400">
                  提取结果
                  {filteredUrls.length > 0 && (
                    <span className="ml-1 text-blue-500">{filteredUrls.length} 条</span>
                  )}
                </label>
                <button
                  onClick={handleCopy}
                  disabled={!output}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    copied
                      ? 'bg-green-500 text-white'
                      : output
                        ? 'bg-blue-500 hover:bg-blue-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  {copied ? <Check size={11} /> : <Copy size={11} />}
                  {copied ? '已复制' : '复制全部'}
                </button>
              </div>
              <div className="flex-1 overflow-auto px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 min-h-0">
                {filteredUrls.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-gray-300 dark:text-gray-600 gap-2">
                    <Link size={28} className="opacity-40" />
                    <p className="text-xs">
                      {input.trim()
                        ? allUrls.length === 0
                          ? '未找到 URL'
                          : '过滤后无结果，请调整过滤条件'
                        : '提取结果将在这里显示'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {filteredUrls.map((url, i) => (
                      <UrlItem key={i} url={url} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 统计侧栏 */}
        {allUrls.length > 0 && <ExtStatsSidebar stats={extStats} total={allUrls.length} />}
      </div>
    </div>
  );
}

// ─── URL 条目组件 ─────────────────────────────────────────────────

function UrlItem({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const ext = getExtension(url);
  const domain = getDomain(url);

  return (
    <div className="group flex items-start gap-2 py-1 px-1 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="text-xs font-mono text-blue-600 dark:text-blue-400 break-all leading-relaxed">
          {url}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[10px] text-gray-400">{domain}</span>
          {ext && (
            <span className="text-[10px] px-1 py-0 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded">
              .{ext}
            </span>
          )}
        </div>
      </div>
      <button
        onClick={handleCopy}
        className="flex-shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 transition-all text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
        title="复制此 URL"
      >
        {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
      </button>
    </div>
  );
}

// ─── 扩展名统计侧栏 ───────────────────────────────────────────────

function ExtStatsSidebar({ stats, total }: { stats: [string, number][]; total: number }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      className={`border-l border-gray-100 dark:border-gray-800 flex flex-col flex-shrink-0 transition-all ${collapsed ? 'w-8' : 'w-44'}`}
    >
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center justify-between px-2 py-2.5 border-b border-gray-100 dark:border-gray-800 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
      >
        {!collapsed && <span>类型统计</span>}
        {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
      </button>

      {!collapsed && (
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {stats.map(([ext, count]) => (
            <div key={ext} className="flex items-center justify-between gap-1">
              <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate font-mono">
                {ext}
              </span>
              <div className="flex items-center gap-1 flex-shrink-0">
                <div
                  className="h-1.5 bg-blue-400 dark:bg-blue-500 rounded-full"
                  style={{ width: `${Math.max(4, (count / total) * 48)}px` }}
                />
                <span className="text-[11px] text-gray-400 w-5 text-right">{count}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
