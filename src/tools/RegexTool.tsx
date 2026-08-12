// 正则表达式工具
import { useState, useEffect } from 'react';
import { Copy, Check, Search, BookOpen, Code, Sparkles, Replace } from 'lucide-react';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';

interface RegexMatch {
  match: string;
  index: number;
  groups?: string[];
}

interface RegexTemplate {
  name: string;
  pattern: string;
  description: string;
  example: string;
  category: string;
}

const REGEX_TEMPLATES: RegexTemplate[] = [
  // 基础验证
  {
    name: '邮箱',
    pattern: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$',
    description: '验证邮箱地址',
    example: 'user@example.com',
    category: '验证',
  },
  {
    name: '手机号',
    pattern: '^1[3-9]\\d{9}$',
    description: '中国大陆手机号',
    example: '13800138000',
    category: '验证',
  },
  {
    name: 'URL',
    pattern:
      '^https?:\\/\\/(www\\.)?[-a-zA-Z0-9@:%._\\+~#=]{1,256}\\.[a-zA-Z0-9()]{1,6}\\b([-a-zA-Z0-9()@:%_\\+.~#?&//=]*)$',
    description: '验证网址',
    example: 'https://example.com',
    category: '验证',
  },
  {
    name: 'IPv4',
    pattern:
      '^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$',
    description: 'IPv4 地址',
    example: '192.168.1.1',
    category: '验证',
  },
  {
    name: '身份证',
    pattern:
      '^[1-9]\\d{5}(18|19|20)\\d{2}((0[1-9])|(1[0-2]))(([0-2][1-9])|10|20|30|31)\\d{3}[0-9Xx]$',
    description: '18位身份证号',
    example: '110101199001011234',
    category: '验证',
  },
  {
    name: '邮政编码',
    pattern: '^[1-9]\\d{5}$',
    description: '中国邮政编码',
    example: '100000',
    category: '验证',
  },
  {
    name: '银行卡',
    pattern: '^[1-9]\\d{9,29}$',
    description: '银行卡号',
    example: '6222021234567890123',
    category: '验证',
  },

  // 数字相关
  { name: '整数', pattern: '^-?\\d+$', description: '正负整数', example: '-123', category: '数字' },
  {
    name: '正整数',
    pattern: '^[1-9]\\d*$',
    description: '正整数（不含0）',
    example: '123',
    category: '数字',
  },
  {
    name: '小数',
    pattern: '^-?\\d+\\.\\d+$',
    description: '小数',
    example: '3.14',
    category: '数字',
  },
  {
    name: '金额',
    pattern: '^(0|[1-9]\\d*)(\\.\\d{1,2})?$',
    description: '金额（最多2位小数）',
    example: '1234.56',
    category: '数字',
  },
  {
    name: '百分比',
    pattern: '^(100|[1-9]?\\d)(\\.\\d+)?%$',
    description: '百分比',
    example: '85.5%',
    category: '数字',
  },

  // 日期时间
  {
    name: '日期 YYYY-MM-DD',
    pattern: '^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$',
    description: '标准日期格式',
    example: '2024-01-01',
    category: '日期',
  },
  {
    name: '日期 YYYY/MM/DD',
    pattern: '^\\d{4}\\/(0[1-9]|1[0-2])\\/(0[1-9]|[12]\\d|3[01])$',
    description: '斜杠日期格式',
    example: '2024/01/01',
    category: '日期',
  },
  {
    name: '时间 HH:MM:SS',
    pattern: '^([01]\\d|2[0-3]):([0-5]\\d):([0-5]\\d)$',
    description: '24小时制时间',
    example: '23:59:59',
    category: '日期',
  },
  {
    name: '日期时间',
    pattern:
      '^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01]) ([01]\\d|2[0-3]):([0-5]\\d):([0-5]\\d)$',
    description: '完整日期时间',
    example: '2024-01-01 12:00:00',
    category: '日期',
  },

  // 字符串
  {
    name: '中文',
    pattern: '^[\\u4e00-\\u9fa5]+$',
    description: '纯中文',
    example: '你好世界',
    category: '字符',
  },
  {
    name: '英文',
    pattern: '^[a-zA-Z]+$',
    description: '纯英文字母',
    example: 'Hello',
    category: '字符',
  },
  {
    name: '字母数字',
    pattern: '^[a-zA-Z0-9]+$',
    description: '字母和数字',
    example: 'abc123',
    category: '字符',
  },
  {
    name: '用户名',
    pattern: '^[a-zA-Z0-9_-]{4,16}$',
    description: '4-16位字母数字下划线',
    example: 'user_name123',
    category: '字符',
  },
  {
    name: '密码强度',
    pattern: '^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]{8,}$',
    description: '至少8位，含大小写字母、数字、特殊字符',
    example: 'Pass@123',
    category: '字符',
  },

  // 提取
  {
    name: '提取邮箱',
    pattern: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}',
    description: '从文本中提取邮箱',
    example: '联系我：user@example.com',
    category: '提取',
  },
  {
    name: '提取URL',
    pattern:
      'https?:\\/\\/(www\\.)?[-a-zA-Z0-9@:%._\\+~#=]{1,256}\\.[a-zA-Z0-9()]{1,6}\\b([-a-zA-Z0-9()@:%_\\+.~#?&//=]*)',
    description: '从文本中提取网址',
    example: '访问 https://example.com',
    category: '提取',
  },
  {
    name: '提取手机号',
    pattern: '1[3-9]\\d{9}',
    description: '从文本中提取手机号',
    example: '电话：13800138000',
    category: '提取',
  },
  {
    name: '提取IP',
    pattern: '((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)',
    description: '从文本中提取IP地址',
    example: '服务器：192.168.1.1',
    category: '提取',
  },
  {
    name: '提取数字',
    pattern: '\\d+',
    description: '提取所有数字',
    example: '价格：123元',
    category: '提取',
  },

  // HTML/代码
  {
    name: 'HTML标签',
    pattern: '<[^>]+>',
    description: '匹配HTML标签',
    example: '<div class="test">内容</div>',
    category: '代码',
  },
  {
    name: '十六进制颜色',
    pattern: '#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}',
    description: '匹配颜色值',
    example: '#FF5733 或 #F57',
    category: '代码',
  },
  {
    name: '变量名',
    pattern: '[a-zA-Z_$][a-zA-Z0-9_$]*',
    description: 'JavaScript变量名',
    example: 'myVariable',
    category: '代码',
  },
];

export default function RegexTool() {
  const ready = useToolTheme();
  const [pattern, setPattern] = useState('');
  const [flags, setFlags] = useState({ g: true, i: false, m: false, s: false, u: false });
  const [testText, setTestText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [matches, setMatches] = useState<RegexMatch[]>([]);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('全部');
  const [showTemplates, setShowTemplates] = useState(true);

  const categories = ['全部', ...Array.from(new Set(REGEX_TEMPLATES.map((t) => t.category)))];

  const filteredTemplates =
    selectedCategory === '全部'
      ? REGEX_TEMPLATES
      : REGEX_TEMPLATES.filter((t) => t.category === selectedCategory);

  // 测试正则
  useEffect(() => {
    if (!pattern || !testText) {
      setMatches([]);
      setError('');
      return;
    }

    try {
      const flagStr = Object.entries(flags)
        .filter(([_, enabled]) => enabled)
        .map(([flag]) => flag)
        .join('');

      const regex = new RegExp(pattern, flagStr);
      const results: RegexMatch[] = [];

      if (flags.g) {
        let match;
        while ((match = regex.exec(testText)) !== null) {
          results.push({
            match: match[0],
            index: match.index,
            groups: match.slice(1),
          });
          if (match.index === regex.lastIndex) {
            regex.lastIndex++;
          }
        }
      } else {
        const match = regex.exec(testText);
        if (match) {
          results.push({
            match: match[0],
            index: match.index,
            groups: match.slice(1),
          });
        }
      }

      setMatches(results);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '正则表达式错误');
      setMatches([]);
    }
  }, [pattern, testText, flags]);

  // 高亮显示匹配
  const highlightMatches = () => {
    if (!testText || matches.length === 0) {
      return testText;
    }

    const parts: JSX.Element[] = [];
    let lastIndex = 0;

    matches.forEach((match, idx) => {
      if (match.index > lastIndex) {
        parts.push(<span key={`text-${idx}`}>{testText.substring(lastIndex, match.index)}</span>);
      }
      parts.push(
        <span key={`match-${idx}`} className="bg-yellow-200 dark:bg-yellow-600 font-semibold">
          {match.match}
        </span>
      );
      lastIndex = match.index + match.match.length;
    });

    if (lastIndex < testText.length) {
      parts.push(<span key="text-end">{testText.substring(lastIndex)}</span>);
    }

    return parts;
  };

  // 执行替换
  const handleReplace = () => {
    if (!pattern || !testText) return;

    try {
      const flagStr = Object.entries(flags)
        .filter(([_, enabled]) => enabled)
        .map(([flag]) => flag)
        .join('');

      const regex = new RegExp(pattern, flagStr);
      const result = testText.replace(regex, replaceText);
      setTestText(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : '替换失败');
    }
  };

  // 使用模板
  const useTemplate = (template: RegexTemplate) => {
    setPattern(template.pattern);
    setTestText(template.example);
    setShowTemplates(false);
  };

  // 复制正则
  const copyPattern = async () => {
    try {
      await navigator.clipboard.writeText(pattern);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      alert('复制失败');
    }
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen bg-white dark:bg-gray-900">
      {/* 左侧：正则测试区 */}
      <div className="flex-1 flex flex-col">
        <ToolHeader
          icon={<Search className="text-purple-500" size={18} />}
          title="正则表达式工具"
          actions={
            <button
              onClick={() => setShowTemplates(!showTemplates)}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                showTemplates
                  ? 'bg-purple-500 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
              }`}
            >
              <BookOpen size={14} className="inline mr-1" />
              模板库
            </button>
          }
        />
        {/* 正则输入 */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">正则表达式</span>
            <button
              onClick={copyPattern}
              disabled={!pattern}
              className="ml-auto flex items-center gap-1 px-2 py-1 text-xs text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded transition-colors disabled:opacity-50"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? '已复制' : '复制'}
            </button>
          </div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-gray-500 dark:text-gray-400 font-mono">/</span>
            <input
              type="text"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              placeholder="输入正则表达式..."
            />
            <span className="text-gray-500 dark:text-gray-400 font-mono">/</span>
          </div>

          {/* 标志 */}
          <div className="flex items-center gap-4 text-sm">
            <span className="text-gray-600 dark:text-gray-400">标志：</span>
            {Object.entries(flags).map(([flag, enabled]) => (
              <label key={flag} className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setFlags({ ...flags, [flag]: e.target.checked })}
                  className="rounded"
                />
                <span className="font-mono text-gray-700 dark:text-gray-300">{flag}</span>
                <span className="text-xs text-gray-500">
                  {flag === 'g' && '全局'}
                  {flag === 'i' && '忽略大小写'}
                  {flag === 'm' && '多行'}
                  {flag === 's' && '单行'}
                  {flag === 'u' && 'Unicode'}
                </span>
              </label>
            ))}
          </div>

          {error && (
            <div className="mt-3 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* 测试文本 */}
        <div className="flex-1 flex flex-col p-4 overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">测试文本</label>
            <span className="text-xs text-gray-500">
              {matches.length > 0 && `找到 ${matches.length} 个匹配`}
            </span>
          </div>
          <div className="flex-1 overflow-auto">
            <textarea
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
              className="w-full h-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
              placeholder="输入要测试的文本..."
            />
          </div>
        </div>

        {/* 匹配结果预览 */}
        {testText && (
          <div className="p-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 max-h-48 overflow-auto">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              高亮预览
            </div>
            <div className="px-3 py-2 bg-white dark:bg-gray-900 rounded-lg border border-gray-300 dark:border-gray-600 font-mono text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words">
              {highlightMatches()}
            </div>
          </div>
        )}

        {/* 替换功能 */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              placeholder="替换为..."
            />
            <button
              onClick={handleReplace}
              disabled={!pattern || !testText}
              className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Replace size={16} />
              替换
            </button>
          </div>
        </div>

        {/* 匹配详情 */}
        {matches.length > 0 && (
          <div className="p-4 border-t border-gray-200 dark:border-gray-800 max-h-40 overflow-auto">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              匹配详情
            </div>
            <div className="space-y-2">
              {matches.map((match, idx) => (
                <div key={idx} className="px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded-lg text-xs">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-purple-600 dark:text-purple-400">
                      #{idx + 1}
                    </span>
                    <span className="text-gray-500">位置: {match.index}</span>
                  </div>
                  <div className="font-mono text-gray-900 dark:text-gray-100">"{match.match}"</div>
                  {match.groups && match.groups.length > 0 && (
                    <div className="mt-1 text-gray-600 dark:text-gray-400">
                      分组: {match.groups.map((g, i) => `$${i + 1}="${g}"`).join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 右侧：模板库 */}
      {showTemplates && (
        <div className="w-96 border-l border-gray-200 dark:border-gray-800 flex flex-col bg-gray-50 dark:bg-gray-800">
          <div className="p-4 border-b border-gray-200 dark:border-gray-800">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="text-purple-500" size={18} />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">常用模板</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1 text-xs rounded-full transition-colors ${
                    selectedCategory === cat
                      ? 'bg-purple-500 text-white'
                      : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-auto p-4 space-y-2">
            {filteredTemplates.map((template, idx) => (
              <button
                key={idx}
                onClick={() => useTemplate(template)}
                className="w-full text-left p-3 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-purple-400 dark:hover:border-purple-500 hover:shadow-md transition-all group"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100 group-hover:text-purple-600 dark:group-hover:text-purple-400">
                    {template.name}
                  </span>
                  <Code size={14} className="text-gray-400" />
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                  {template.description}
                </div>
                <div className="text-xs font-mono text-gray-600 dark:text-gray-500 bg-gray-50 dark:bg-gray-800 px-2 py-1 rounded truncate">
                  {template.pattern}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
