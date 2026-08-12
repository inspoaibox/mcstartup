import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useItemsStore } from '../stores/itemsStore';
import { useSettingsStore } from '../stores/settingsStore';
import {
  Search,
  Globe,
  Folder,
  Terminal,
  Shield,
  Clock,
  TrendingUp,
  Plus,
  Monitor,
  File,
  FolderOpen,
  AlertCircle,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import {
  LaunchItem,
  InstalledProgram,
  EverythingResult,
  EverythingStatus,
  SearchEngine,
  WeatherResult,
} from '../types';
import { appWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import { open as shellOpen } from '@tauri-apps/api/shell';
import WeatherCard from './WeatherCard';
import CalendarCard, { isCalendarQuery, parseCalendarQuery } from './CalendarCard';
import { searchTools, type ToolDefinition } from '../tools/registry';

/** 统一的搜索结果项 */
interface SearchResultItem {
  type: 'local' | 'system' | 'file' | 'search' | 'tool';
  localItem?: LaunchItem;
  systemProgram?: InstalledProgram;
  fileResult?: EverythingResult;
  searchEngine?: SearchEngine;
  searchQuery?: string;
  tool?: ToolDefinition;
  name: string;
  subtitle: string;
  score: number;
}

/** 解析搜索引擎前缀：返回匹配的引擎和搜索词，或 null */
function parseSearchPrefix(
  input: string,
  engines: SearchEngine[]
): { engine: SearchEngine; keyword: string } | null {
  const trimmed = input.trim();
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) return null;

  const prefix = trimmed.slice(0, spaceIdx).toLowerCase();
  const keyword = trimmed.slice(spaceIdx + 1).trim();
  if (!keyword) return null;

  const engine = engines.find((e) => e.enabled && e.prefix.toLowerCase() === prefix);
  if (!engine) return null;

  return { engine, keyword };
}

/** 模糊匹配 */
function fuzzyMatch(query: string, target: string): boolean {
  let qi = 0;
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (query[qi] === target[ti]) qi++;
  }
  return qi === query.length;
}

/**
 * 解析 @ 后面的内容：
 * - 如果以 Windows 盘符开头（C: D: E: ... Z:），识别为文件路径模式
 *   格式：@C:\path\file.ext 问题（问题可选）
 * - 否则为普通 AI 问答
 */
function parseAiInput(raw: string): {
  filePath: string | null;
  question: string;
} {
  // 匹配 Windows 盘符路径：C:\ 或 C:/ 开头
  const filePathMatch = raw.match(/^([C-Zc-z]:[/\\][^\s]*?)(?:\s+(.+))?$/);
  if (filePathMatch) {
    return {
      filePath: filePathMatch[1],
      question: filePathMatch[2]?.trim() || '',
    };
  }
  return { filePath: null, question: raw };
}

export default function QuickLauncherWindow() {
  const { items, loadItems, searchItems, launchItem, addItem, getRecentItems, getFrequentItems } =
    useItemsStore();
  const { loadSettings, searchEngines, qweatherApiKey, qweatherApiHost } = useSettingsStore();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [systemPrograms, setSystemPrograms] = useState<InstalledProgram[]>([]);
  const [everythingStatus, setEverythingStatus] = useState<EverythingStatus | null>(null);
  const [fileResults, setFileResults] = useState<EverythingResult[]>([]);
  const fileSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const everythingRefreshRef = useRef<Promise<EverythingStatus | null> | null>(null);
  const [weatherResult, setWeatherResult] = useState<WeatherResult | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const weatherTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [weatherDays, setWeatherDays] = useState(7);
  const weatherCityRef = useRef<string>('');
  const [calendarDate, setCalendarDate] = useState<Date | null>(null);

  // AI 模式状态
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const aiAbortRef = useRef<AbortController | null>(null);

  // 判断是否是 AI 查询模式（以 @ 开头）
  const isAiMode = query.startsWith('@');
  const aiQuery = isAiMode ? query.slice(1).trim() : '';
  // 解析 @ 后内容：文件路径 or 普通问题
  const { filePath: aiFilePath, question: aiQuestion } = isAiMode
    ? parseAiInput(aiQuery)
    : { filePath: null, question: '' };

  const refreshEverythingStatus = useCallback(async () => {
    if (everythingRefreshRef.current) return everythingRefreshRef.current;
    const refreshPromise = (async () => {
      const status = await invoke<EverythingStatus>('check_everything_status');
      setEverythingStatus(status);
      return status;
    })().catch((e) => {
      console.error('检测 Everything 失败:', e);
      return null;
    });
    everythingRefreshRef.current = refreshPromise;
    try {
      return await refreshPromise;
    } finally {
      everythingRefreshRef.current = null;
    }
  }, []);

  // 初始化
  useEffect(() => {
    const init = async () => {
      await loadSettings();
      await loadItems();
      // 预加载系统已安装程序
      try {
        const programs = await invoke<InstalledProgram[]>('scan_installed_programs');
        setSystemPrograms(programs);
      } catch (e) {
        console.error('加载系统程序失败:', e);
      }
      // 检测 Everything 是否可用
      await refreshEverythingStatus();
      setReady(true);
    };
    init();
  }, [loadItems, loadSettings, refreshEverythingStatus]);

  // 窗口打开时刷新
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen('open-quick-launcher', async () => {
      // 每次打开都重新加载设置，确保拿到主窗口最新保存的配置
      await loadSettings();
      await loadItems();
      await refreshEverythingStatus();
      setQuery('');
      setSelectedIndex(0);
      setWeatherResult(null);
      setWeatherError(null);
      setCalendarDate(null);
      setAiAnswer('');
      setAiError('');
      setAiLoading(false);
      if (aiAbortRef.current) aiAbortRef.current.abort();
      setTimeout(() => inputRef.current?.focus(), 50);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [loadItems, loadSettings, refreshEverythingStatus]);

  // 失焦隐藏
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const setup = async () => {
      unlisten = await appWindow.onFocusChanged(({ payload: focused }) => {
        if (!focused) appWindow.hide();
      });
    };
    setup();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // AI 查询（debounce 500ms，@ 开头触发）
  useEffect(() => {
    if (!isAiMode || !aiQuery) {
      setAiAnswer('');
      setAiError('');
      return;
    }
    if (aiAbortRef.current) aiAbortRef.current.abort();
    const timer = setTimeout(async () => {
      // 每次触发时从 store 实时读取，避免闭包捕获旧值
      const { defaultAiModel: dm, aiProviders: ap } = useSettingsStore.getState();
      if (!dm) {
        setAiError('请先在设置 → AI 聊天中配置默认模型');
        return;
      }
      const [providerId, model] = dm.split('::');
      const provider = ap?.find((p) => p.id === providerId);
      if (!provider) {
        setAiError('默认模型对应的提供商不存在，请重新设置');
        return;
      }

      // 如果是文件路径模式，先读取文件内容
      let finalPrompt = aiQuestion || aiQuery;
      if (aiFilePath) {
        // 文件路径模式：需要有完整路径（至少有扩展名或路径分隔符）
        // 如果路径不完整（用户还在输入），等待
        if (!aiFilePath.includes('.') && !aiFilePath.endsWith('\\') && !aiFilePath.endsWith('/')) {
          return; // 路径还不完整，继续等待
        }
        try {
          const fileInfo = await invoke<{
            content: string;
            fileName: string;
            ext: string;
            sizeKb: number;
            lines: number;
          }>('read_file_for_ai', { path: aiFilePath });

          const langMap: Record<string, string> = {
            rs: 'rust',
            ts: 'typescript',
            tsx: 'typescript',
            js: 'javascript',
            jsx: 'javascript',
            py: 'python',
            go: 'go',
            java: 'java',
            cs: 'csharp',
            cpp: 'cpp',
            c: 'c',
            html: 'html',
            css: 'css',
            json: 'json',
            yaml: 'yaml',
            yml: 'yaml',
            toml: 'toml',
            md: 'markdown',
            sql: 'sql',
            sh: 'bash',
            bat: 'batch',
            ps1: 'powershell',
          };
          const lang = langMap[fileInfo.ext] || fileInfo.ext || 'text';
          const userQuestion = aiQuestion || '请分析这个文件的代码，说明其功能、结构和关键逻辑。';

          finalPrompt = `${userQuestion}\n\n文件：${fileInfo.fileName}（${fileInfo.lines} 行，${fileInfo.sizeKb}KB）\n\n\`\`\`${lang}\n${fileInfo.content}\n\`\`\``;
        } catch (err: any) {
          setAiError(err.message || '读取文件失败');
          setAiLoading(false);
          return;
        }
      }

      const abortController = new AbortController();
      aiAbortRef.current = abortController;
      setAiLoading(true);
      setAiAnswer('');
      setAiError('');
      try {
        const getBaseUrl = (type: string) => {
          switch (type) {
            case 'openai':
              return 'https://api.openai.com/v1';
            case 'sub2api':
              return '';
            case 'anthropic':
              return 'https://api.anthropic.com/v1';
            case 'google':
              return 'https://generativelanguage.googleapis.com/v1beta';
            default:
              return '';
          }
        };
        const baseUrl = provider.baseUrl || getBaseUrl(provider.type);
        const postOpenAiCompatible = async (payload: Record<string, unknown>) => {
          const text = await invoke<string>('http_post_json', {
            url: `${baseUrl}/chat/completions`,
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${provider.apiKey}`,
            },
            body: payload,
            connectionMode: provider.connectionMode || 'auto',
            proxyUrl: provider.proxyUrl || null,
          });
          return JSON.parse(text);
        };
        if (provider.type === 'google') {
          const response = await fetch(
            `${baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${provider.apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: finalPrompt }] }],
                generationConfig: { temperature: 0.7, maxOutputTokens: aiFilePath ? 2048 : 512 },
              }),
              signal: abortController.signal,
            }
          );
          if (!response.ok) throw new Error(`请求失败: ${response.status}`);
          const reader = response.body?.getReader();
          const decoder = new TextDecoder();
          if (!reader) throw new Error('无响应体');
          let full = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            for (const line of decoder.decode(value, { stream: true }).split('\n')) {
              if (line.startsWith('data: ')) {
                try {
                  const text = JSON.parse(line.slice(6)).candidates?.[0]?.content?.parts?.[0]?.text;
                  if (text) {
                    full += text;
                    setAiAnswer(full);
                  }
                } catch {
                  /* ignore */
                }
              }
            }
          }
        } else if (provider.type === 'anthropic') {
          const response = await fetch(`${baseUrl}/messages`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': provider.apiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model,
              max_tokens: aiFilePath ? 2048 : 512,
              messages: [{ role: 'user', content: finalPrompt }],
              stream: true,
            }),
            signal: abortController.signal,
          });
          if (!response.ok) throw new Error(`请求失败: ${response.status}`);
          const reader = response.body?.getReader();
          const decoder = new TextDecoder();
          if (!reader) throw new Error('无响应体');
          let full = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            for (const line of decoder.decode(value, { stream: true }).split('\n')) {
              if (line.startsWith('data: ')) {
                try {
                  const text = JSON.parse(line.slice(6)).delta?.text;
                  if (text) {
                    full += text;
                    setAiAnswer(full);
                  }
                } catch {
                  /* ignore */
                }
              }
            }
          }
        } else {
          // OpenAI / custom / Sub2API
          const data = await postOpenAiCompatible({
            model,
            messages: [{ role: 'user', content: finalPrompt }],
            stream: false,
            max_tokens: aiFilePath ? 2048 : 512,
            temperature: 0.7,
          });
          const content = data?.choices?.[0]?.message?.content;
          setAiAnswer(typeof content === 'string' ? content : '');
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') setAiError(err.message || 'AI 请求失败');
      } finally {
        setAiLoading(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [aiQuery, isAiMode, aiFilePath, aiQuestion]);

  // 已添加的 exe 路径集合（用于标记系统程序是否已导入）
  const addedPaths = useMemo(() => new Set(items.map((i) => i.targetPath.toLowerCase())), [items]);

  // 合并搜索：本地项目 + 系统程序
  const searchResults = useMemo((): SearchResultItem[] => {
    if (!query.trim() || isAiMode) return [];
    const q = query.toLowerCase();
    const results: SearchResultItem[] = [];

    // 0. 搜索引擎前缀匹配（最高优先级）
    const searchMatch = parseSearchPrefix(query, searchEngines || []);
    if (searchMatch) {
      results.push({
        type: 'search',
        searchEngine: searchMatch.engine,
        searchQuery: searchMatch.keyword,
        name: `${searchMatch.engine.name}：${searchMatch.keyword}`,
        subtitle: `用 ${searchMatch.engine.name} 搜索 "${searchMatch.keyword}"`,
        score: 200,
      });
    }

    // 0.5 工具匹配（优先级仅次于搜索引擎）
    const toolMatches = searchTools(q);
    for (const tool of toolMatches.slice(0, 3)) {
      results.push({
        type: 'tool',
        tool,
        name: tool.name,
        subtitle: tool.description,
        score: 150,
      });
    }

    // 1. 本地项目搜索（带评分）
    const localResults = searchItems(query);
    for (const item of localResults.slice(0, 8)) {
      results.push({
        type: 'local',
        localItem: item,
        name: item.name,
        subtitle: item.alias,
        score: 100,
      });
    }

    // 2. 系统程序搜索（排除已添加的）
    const localCount = results.length;
    if (q.length >= 2) {
      for (const prog of systemPrograms) {
        if (addedPaths.has(prog.targetPath.toLowerCase())) continue;

        const nameLower = prog.name.toLowerCase();
        let score = 0;
        if (nameLower === q) score = 50;
        else if (nameLower.startsWith(q)) score = 40;
        else if (nameLower.includes(q)) score = 30;
        else if (fuzzyMatch(q, nameLower)) score = 20;

        if (score > 0) {
          results.push({
            type: 'system',
            systemProgram: prog,
            name: prog.name,
            subtitle: prog.targetPath,
            score,
          });
        }
      }
    }

    const localPart = results.slice(0, localCount);
    const systemPart = results
      .slice(localCount)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    // 3. Everything 文件结果
    const filePart: SearchResultItem[] = fileResults.map((f) => ({
      type: 'file' as const,
      fileResult: f,
      name: f.name,
      subtitle: f.fullPath,
      score: 10,
    }));

    // 搜索引擎建议放最前面（如果有）
    const searchPart = results.filter((r) => r.type === 'search');
    const otherPart = [...localPart.filter((r) => r.type !== 'search'), ...systemPart, ...filePart];

    return [...searchPart, ...otherPart];
  }, [query, searchItems, systemPrograms, addedPaths, fileResults, searchEngines]);

  const recentItems = getRecentItems(5);
  const frequentItems = getFrequentItems(5);
  const showSuggestions = !query.trim() && (recentItems.length > 0 || frequentItems.length > 0);

  const suggestionDisplayItems = useMemo((): SearchResultItem[] => {
    if (query.trim()) return [];
    const seen = new Set<string>();
    const list: SearchResultItem[] = [];
    for (const item of [...recentItems, ...frequentItems]) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        list.push({
          type: 'local',
          localItem: item,
          name: item.name,
          subtitle: item.alias,
          score: 0,
        });
      }
    }
    return list;
  }, [query, recentItems, frequentItems]);

  const displayItems = query.trim() ? searchResults : suggestionDisplayItems;
  const maxIndex = displayItems.length - 1;

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Everything 文件搜索（防抖 300ms）
  useEffect(() => {
    if (fileSearchTimerRef.current) clearTimeout(fileSearchTimerRef.current);

    if (!query.trim() || query.trim().length < 2) {
      setFileResults([]);
      return;
    }

    fileSearchTimerRef.current = setTimeout(async () => {
      try {
        if (!everythingStatus?.available) {
          const status = await refreshEverythingStatus();
          if (!status?.available) {
            setFileResults([]);
            return;
          }
        }
        const results = await invoke<EverythingResult[]>('search_everything', {
          query: query.trim(),
          maxResults: 8,
        });
        setFileResults(results);
        if (!everythingStatus?.available) {
          setEverythingStatus({ available: true, message: 'Everything 已就绪' });
        }
      } catch (e) {
        const status = await refreshEverythingStatus();
        if (!status?.available) {
          setFileResults([]);
          return;
        }
        setFileResults([]);
      }
    }, 300);

    return () => {
      if (fileSearchTimerRef.current) clearTimeout(fileSearchTimerRef.current);
    };
  }, [query, everythingStatus?.available, refreshEverythingStatus]);

  // 天气查询（防抖 500ms，识别"XX天气"意图）
  useEffect(() => {
    if (weatherTimerRef.current) clearTimeout(weatherTimerRef.current);

    const trimmed = query.trim();
    const weatherMatch = trimmed.match(/^(.+?)\s*天气$/) || trimmed.match(/^weather\s+(.+)$/i);

    if (!weatherMatch) {
      setWeatherResult(null);
      setWeatherError(null);
      return;
    }

    const cityName = weatherMatch[1].trim();
    if (!cityName) return;

    // 等待初始化完成后再检查 key，避免 loadSettings 还没完成就报错
    if (!ready) return;

    if (!qweatherApiKey) {
      setWeatherError('请先在设置 → 天气 中配置和风天气 API Key 和 API Host');
      setWeatherResult(null);
      return;
    }

    if (!qweatherApiHost) {
      setWeatherError('请先在设置 → 天气 中配置和风天气 API Host');
      setWeatherResult(null);
      return;
    }

    setWeatherLoading(true);
    setWeatherError(null);
    weatherCityRef.current = cityName;

    weatherTimerRef.current = setTimeout(async () => {
      try {
        const result = await invoke<WeatherResult>('query_weather', {
          city: cityName,
          apiKey: qweatherApiKey,
          apiHost: qweatherApiHost,
          days: weatherDays,
        });
        setWeatherResult(result);
        setWeatherError(null);
      } catch (e) {
        setWeatherError(String(e));
        setWeatherResult(null);
      } finally {
        setWeatherLoading(false);
      }
    }, 500);

    return () => {
      if (weatherTimerRef.current) clearTimeout(weatherTimerRef.current);
    };
  }, [query, qweatherApiKey, qweatherApiHost, weatherDays, ready]);

  // 日历查询（同步，无需防抖）
  useEffect(() => {
    if (isCalendarQuery(query)) {
      const d = parseCalendarQuery(query);
      setCalendarDate(d);
    } else {
      setCalendarDate(null);
    }
  }, [query]);

  useEffect(() => {
    if (listRef.current) {
      const el = listRef.current.querySelector('[data-selected="true"]');
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const handleClose = useCallback(() => {
    appWindow.hide();
  }, []);

  // 启动本地项目
  const handleLaunchLocal = useCallback(
    async (item: LaunchItem) => {
      try {
        await launchItem(item.id);
        handleClose();
      } catch (error) {
        console.error('启动失败:', error);
      }
    },
    [launchItem, handleClose]
  );

  // 直接启动系统程序（不导入，用 cmd start）
  const handleLaunchSystem = useCallback(
    async (prog: InstalledProgram) => {
      try {
        // 用后端的通用启动方式
        await invoke('launch_system_program', { targetPath: prog.targetPath });
        handleClose();
      } catch (error) {
        console.error('启动系统程序失败:', error);
      }
    },
    [handleClose]
  );

  // 用搜索引擎搜索
  const handleSearchWithEngine = useCallback(
    async (engine: SearchEngine, keyword: string) => {
      const url = engine.url.replace('{query}', encodeURIComponent(keyword));
      try {
        await shellOpen(url);
        handleClose();
      } catch (error) {
        console.error('打开搜索 URL 失败:', error);
      }
    },
    [handleClose]
  );

  // 打开 Everything 搜索到的文件/文件夹
  const handleOpenFile = useCallback(
    async (result: EverythingResult) => {
      try {
        await invoke('open_path', { targetPath: result.fullPath });
        handleClose();
      } catch (error) {
        console.error('打开文件失败:', error);
      }
    },
    [handleClose]
  );

  // 打开文件所在目录
  const handleOpenFileLocation = useCallback(
    async (result: EverythingResult, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        // 如果是文件夹，直接打开
        if (result.isFolder) {
          await invoke('open_path', { targetPath: result.fullPath });
        } else {
          // 如果是文件，打开所在目录并选中文件
          const dirPath = result.fullPath.substring(0, result.fullPath.lastIndexOf('\\'));
          await invoke('open_path', { targetPath: dirPath });
        }
        handleClose();
      } catch (error) {
        console.error('打开文件位置失败:', error);
      }
    },
    [handleClose]
  );

  // 快速导入系统程序到 McStartUP
  const handleQuickAdd = useCallback(
    async (prog: InstalledProgram) => {
      const alias =
        prog.name
          .toLowerCase()
          .replace(/\s+/g, '')
          .replace(/[^a-z0-9]/gi, '')
          .slice(0, 20) || 'app';
      try {
        await addItem({
          name: prog.name,
          alias,
          targetPath: prog.targetPath,
          itemType: 'app',
          runAsAdmin: false,
          startupEnabled: false,
        });
      } catch (error) {
        console.error('添加失败:', error);
      }
    },
    [addItem]
  );

  const handleSelect = useCallback(
    (item: SearchResultItem) => {
      if (item.type === 'local' && item.localItem) {
        handleLaunchLocal(item.localItem);
      } else if (item.type === 'system' && item.systemProgram) {
        handleLaunchSystem(item.systemProgram);
      } else if (item.type === 'file' && item.fileResult) {
        handleOpenFile(item.fileResult);
      } else if (item.type === 'search' && item.searchEngine && item.searchQuery) {
        handleSearchWithEngine(item.searchEngine, item.searchQuery);
      } else if (item.type === 'tool' && item.tool) {
        const tool = item.tool;
        handleClose();
        if (tool.type === 'window' && tool.windowLabel) {
          invoke('show_tool_window', { label: tool.windowLabel }).catch(console.error);
        } else if (tool.type === 'link' && tool.linkUrl) {
          shellOpen(tool.linkUrl);
        }
      }
    },
    [handleLaunchLocal, handleLaunchSystem, handleOpenFile, handleSearchWithEngine, handleClose]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
        return;
      }
      // AI 模式下不做键盘导航
      if (isAiMode) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, maxIndex));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === 'Enter' && displayItems.length > 0) {
        e.preventDefault();
        const item = displayItems[selectedIndex];
        if (item) handleSelect(item);
        return;
      }
    },
    [maxIndex, displayItems, selectedIndex, handleSelect, handleClose, isAiMode]
  );

  if (!ready) {
    return (
      <div className="h-screen bg-transparent flex items-center justify-center">
        <div className="text-gray-400 text-sm">加载中...</div>
      </div>
    );
  }

  return (
    <div
      className="h-screen bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl rounded-2xl overflow-hidden flex flex-col shadow-2xl border border-gray-200 dark:border-gray-700"
      data-tauri-drag-region
    >
      {/* 搜索输入 */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-200 dark:border-gray-700">
        <Search size={22} className="text-gray-400 flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="搜索项目或系统程序，@ 开头提问 AI..."
          className="flex-1 bg-transparent text-lg text-gray-900 dark:text-white placeholder-gray-400 outline-none"
          autoFocus
        />
        {isAiMode && aiLoading && (
          <div className="size-5 rounded-full border-2 border-blue-400 border-t-transparent animate-spin flex-shrink-0" />
        )}
        {isAiMode && aiLoading && (
          <button
            onClick={() => {
              aiAbortRef.current?.abort();
              setAiLoading(false);
            }}
            className="p-1 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
            title="停止"
          >
            <Square size={13} fill="currentColor" />
          </button>
        )}
        <kbd className="inline-flex items-center px-2 py-0.5 text-xs font-mono text-gray-400 bg-gray-100 dark:bg-gray-800 rounded">
          ESC
        </kbd>
        <button
          onClick={handleClose}
          className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors flex-shrink-0"
          title="关闭"
        >
          <X size={16} />
        </button>
      </div>

      {/* 天气卡片 */}
      {(weatherLoading || weatherResult || weatherError) && (
        <div className="border-b border-gray-100 dark:border-gray-800">
          {weatherLoading && (
            <div className="flex items-center gap-2 px-5 py-3 text-sm text-gray-400">
              <span className="animate-spin text-base">⏳</span>
              正在查询天气...
            </div>
          )}
          {weatherError && !weatherLoading && (
            <div className="flex items-center gap-2 px-5 py-3 text-sm text-amber-500">
              <span>⚠️</span>
              {weatherError}
            </div>
          )}
          {weatherResult && !weatherLoading && (
            <WeatherCard
              weather={weatherResult}
              days={weatherDays}
              onChangeDays={(d) => setWeatherDays(d)}
              loading={weatherLoading}
            />
          )}
        </div>
      )}

      {/* 日历卡片 */}
      {calendarDate && (
        <div className="border-b border-gray-100 dark:border-gray-800">
          <CalendarCard date={calendarDate} />
        </div>
      )}

      {/* AI 模式结果区域 */}
      {isAiMode && (
        <div className="px-5 py-4 flex-1 overflow-y-auto">
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600">
              <Sparkles size={12} className="text-white" />
            </div>
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">AI 回答</span>
            {aiFilePath && (
              <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/40">
                <File size={10} />
                {aiFilePath.split(/[/\\]/).pop()}
              </span>
            )}
            {!useSettingsStore.getState().defaultAiModel && !aiLoading && !aiAnswer && !aiError && (
              <span className="text-xs text-amber-500">— 未配置默认模型</span>
            )}
          </div>
          {!aiQuery && (
            <p className="text-sm text-gray-400 dark:text-gray-500">
              继续输入你的问题，或输入文件路径（如 C:\path\file.py）...
            </p>
          )}
          {aiFilePath &&
            !aiQuestion &&
            !aiLoading &&
            !aiAnswer &&
            !aiError &&
            aiQuery.includes('.') && (
              <p className="text-sm text-gray-400 dark:text-gray-500">
                检测到文件路径，回车后将自动分析文件内容。也可在路径后加空格输入具体问题。
              </p>
            )}
          {aiError && (
            <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3">
              <p className="text-sm text-red-600 dark:text-red-400">{aiError}</p>
            </div>
          )}
          {aiLoading && !aiAnswer && (
            <div className="flex items-center gap-2 py-2">
              <span className="size-2 rounded-full bg-blue-400 animate-bounce [animation-delay:-0.3s]" />
              <span className="size-2 rounded-full bg-blue-400 animate-bounce [animation-delay:-0.15s]" />
              <span className="size-2 rounded-full bg-blue-400 animate-bounce" />
            </div>
          )}
          {aiAnswer && (
            <div className="rounded-xl bg-blue-50/60 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800/30 px-4 py-3">
              <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
                {aiAnswer}
                {aiLoading && (
                  <span className="ml-1 inline-block animate-pulse text-blue-500">▊</span>
                )}
              </p>
            </div>
          )}
        </div>
      )}

      {/* 搜索结果 */}
      {!isAiMode && displayItems.length > 0 && (
        <div ref={listRef} className="flex-1 overflow-y-auto custom-scrollbar">
          {/* 分组标题 */}
          {query.trim() && searchResults.some((r) => r.type === 'local') && (
            <div className="flex items-center gap-2 px-5 py-1.5 text-xs font-medium text-gray-400 uppercase tracking-wider">
              <Terminal size={11} />
              已添加
            </div>
          )}
          {displayItems.map((item, index) => {
            // 在本地和系统之间插入分隔标题
            const showSystemHeader =
              query.trim() &&
              item.type === 'system' &&
              (index === 0 || displayItems[index - 1]?.type === 'local');

            const showFileHeader =
              query.trim() &&
              item.type === 'file' &&
              (index === 0 || displayItems[index - 1]?.type !== 'file');

            return (
              <div key={`${item.type}-${item.name}-${index}`}>
                {showSystemHeader && (
                  <div className="flex items-center gap-2 px-5 py-1.5 text-xs font-medium text-gray-400 uppercase tracking-wider mt-1 border-t border-gray-100 dark:border-gray-800">
                    <Monitor size={11} />
                    系统程序
                  </div>
                )}
                {showFileHeader && (
                  <div className="flex items-center gap-2 px-5 py-1.5 text-xs font-medium text-gray-400 uppercase tracking-wider mt-1 border-t border-gray-100 dark:border-gray-800">
                    <File size={11} />
                    本地文件
                  </div>
                )}
                <button
                  data-selected={index === selectedIndex}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors ${
                    index === selectedIndex
                      ? 'bg-[#0066ff]/10 dark:bg-[#0066ff]/20'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                  }`}
                >
                  {/* 图标 */}
                  {item.type === 'search' ? (
                    <Globe size={16} className="text-[#0066ff] flex-shrink-0" />
                  ) : item.type === 'tool' ? (
                    <span className="text-base flex-shrink-0">{item.tool?.icon}</span>
                  ) : item.type === 'local' ? (
                    item.localItem?.itemType === 'url' ? (
                      <Globe size={16} className="text-blue-500 flex-shrink-0" />
                    ) : item.localItem?.itemType === 'folder' ? (
                      <Folder size={16} className="text-yellow-500 flex-shrink-0" />
                    ) : (
                      <Terminal size={16} className="text-green-500 flex-shrink-0" />
                    )
                  ) : item.type === 'file' ? (
                    item.fileResult?.isFolder ? (
                      <FolderOpen size={16} className="text-yellow-500 flex-shrink-0" />
                    ) : (
                      <File size={16} className="text-blue-400 flex-shrink-0" />
                    )
                  ) : (
                    <Monitor size={16} className="text-gray-400 flex-shrink-0" />
                  )}

                  {/* 名称和副标题 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 dark:text-white truncate text-sm">
                        {item.name}
                      </span>
                      {item.type === 'local' && item.localItem?.runAsAdmin && (
                        <Shield size={11} className="text-yellow-500 flex-shrink-0" />
                      )}
                      {item.type === 'search' && (
                        <span className="text-xs px-1.5 py-0 rounded bg-[#0066ff]/10 text-[#0066ff]">
                          搜索
                        </span>
                      )}
                      {item.type === 'tool' && (
                        <span className="text-xs px-1.5 py-0 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-500">
                          工具
                        </span>
                      )}
                      {item.type === 'system' && (
                        <span className="text-xs px-1.5 py-0 rounded bg-gray-100 dark:bg-gray-800 text-gray-400">
                          系统
                        </span>
                      )}
                      {item.type === 'file' && (
                        <span className="text-xs px-1.5 py-0 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-400">
                          {item.fileResult?.isFolder ? '文件夹' : '文件'}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                      {item.type === 'local' ? item.localItem?.alias : item.subtitle}
                    </p>
                  </div>

                  {/* 右侧操作 */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {item.type === 'system' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleQuickAdd(item.systemProgram!);
                        }}
                        className="p-1 text-gray-400 hover:text-[#0066ff] hover:bg-[#0066ff]/10 rounded transition-colors"
                        title="添加到 McStartUP"
                      >
                        <Plus size={14} />
                      </button>
                    )}
                    {item.type === 'file' && !item.fileResult?.isFolder && (
                      <button
                        onClick={(e) => handleOpenFileLocation(item.fileResult!, e)}
                        className="p-1 text-gray-400 hover:text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 rounded transition-colors"
                        title="打开文件所在目录"
                      >
                        <FolderOpen size={14} />
                      </button>
                    )}
                    {index === selectedIndex && (
                      <span className="text-xs text-gray-400 ml-1">↵</span>
                    )}
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* 无结果 */}
      {!isAiMode && query.trim() && searchResults.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-gray-400">
          <p>没有找到匹配的项目或程序</p>
        </div>
      )}

      {/* 建议区域（无搜索时） */}
      {!isAiMode && showSuggestions && !query.trim() && (
        <div ref={listRef} className="flex-1 overflow-y-auto custom-scrollbar">
          {recentItems.length > 0 && (
            <div>
              <div className="flex items-center gap-2 px-5 py-1.5 text-xs font-medium text-gray-400 uppercase tracking-wider">
                <Clock size={11} />
                最近使用
              </div>
              {recentItems.map((item) => {
                const idx = suggestionDisplayItems.findIndex((s) => s.localItem?.id === item.id);
                return (
                  <button
                    key={item.id}
                    data-selected={idx === selectedIndex}
                    onClick={() => handleLaunchLocal(item)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors ${
                      idx === selectedIndex
                        ? 'bg-[#0066ff]/10 dark:bg-[#0066ff]/20'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                    }`}
                  >
                    <Terminal size={14} className="text-green-500 flex-shrink-0" />
                    <span className="font-medium text-gray-900 dark:text-white truncate text-sm">
                      {item.name}
                    </span>
                    <span className="text-xs font-mono text-gray-400">{item.alias}</span>
                  </button>
                );
              })}
            </div>
          )}
          {frequentItems.length > 0 && (
            <div>
              <div className="flex items-center gap-2 px-5 py-1.5 text-xs font-medium text-gray-400 uppercase tracking-wider">
                <TrendingUp size={11} />
                最常使用
              </div>
              {frequentItems.map((item) => {
                const idx = suggestionDisplayItems.findIndex((s) => s.localItem?.id === item.id);
                if (recentItems.some((r) => r.id === item.id)) return null;
                return (
                  <button
                    key={`freq-${item.id}`}
                    data-selected={idx === selectedIndex}
                    onClick={() => handleLaunchLocal(item)}
                    onMouseEnter={() => setSelectedIndex(idx >= 0 ? idx : 0)}
                    className={`w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors ${
                      idx === selectedIndex
                        ? 'bg-[#0066ff]/10 dark:bg-[#0066ff]/20'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                    }`}
                  >
                    <Terminal size={14} className="text-green-500 flex-shrink-0" />
                    <span className="font-medium text-gray-900 dark:text-white truncate text-sm">
                      {item.name}
                    </span>
                    <span className="text-xs font-mono text-gray-400">{item.alias}</span>
                    <span className="text-xs text-gray-300 dark:text-gray-600 ml-auto">
                      {item.launchCount || 0}次
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 搜索引擎提示（无搜索时显示可用前缀） */}
      {!isAiMode &&
        !query.trim() &&
        searchEngines &&
        searchEngines.filter((e) => e.enabled).length > 0 && (
          <div className="px-5 py-2 border-t border-gray-100 dark:border-gray-800 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-400">搜索：</span>
            {searchEngines
              .filter((e) => e.enabled)
              .slice(0, 6)
              .map((e) => (
                <span
                  key={e.prefix}
                  className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 font-mono"
                  title={e.name}
                >
                  {e.prefix}
                </span>
              ))}
            <span className="text-xs text-gray-300 dark:text-gray-600">+ 空格 + 关键词</span>
          </div>
        )}

      {/* Everything 未安装/未运行提示 */}
      {everythingStatus && !everythingStatus.available && query.trim().length >= 2 && (
        <div className="flex items-center gap-2 px-5 py-1.5 bg-amber-50 dark:bg-amber-900/10 text-xs text-amber-600 dark:text-amber-400">
          <AlertCircle size={12} />
          <span>{everythingStatus.message}</span>
        </div>
      )}

      {/* 底部 */}
      <div className="flex items-center gap-4 px-5 py-2 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400">
        {isAiMode ? (
          <>
            <span className="flex items-center gap-1">
              <Sparkles size={11} /> AI 模式
            </span>
            <span>输入问题后自动回答</span>
            <span>Esc 关闭</span>
          </>
        ) : (
          <>
            <span>↑↓ 导航</span>
            <span>↵ 启动</span>
            <span>@ 提问 AI</span>
          </>
        )}
        <span className="ml-auto text-gray-300 dark:text-gray-600">
          {items.length} 项目 · {systemPrograms.length} 系统
          {everythingStatus?.available && ' · Everything ✓'}
        </span>
      </div>
    </div>
  );
}
