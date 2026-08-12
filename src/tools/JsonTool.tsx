// JSON 工具箱
import { useState } from 'react';
import {
  Copy,
  Check,
  FileJson,
  GitCompare,
  CheckCircle,
  Code,
  Minimize2,
  Maximize2,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';

type TabType = 'format' | 'diff' | 'validate' | 'toTs' | 'compress';

export default function JsonTool() {
  const ready = useToolTheme();
  const [activeTab, setActiveTab] = useState<TabType>('format');
  const [input, setInput] = useState('');
  const [input2, setInput2] = useState(''); // 用于 diff
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [schema, setSchema] = useState('');

  // JSON 格式化（使用 Prettier 获得更好的输出）
  const formatJson = async () => {
    try {
      // 先验证 JSON 合法性
      JSON.parse(input);
      // 用 Prettier 格式化
      const { format } = await import('prettier/standalone');
      const parserBabel = await import('prettier/plugins/babel');
      const parserEstree = await import('prettier/plugins/estree');
      const formatted = await format(input, {
        parser: 'json',
        plugins: [parserBabel.default, parserEstree.default],
        printWidth: 80,
        tabWidth: 2,
      });
      setOutput(formatted.trim());
      setError('');
    } catch (e) {
      setError(`格式化失败: ${e instanceof Error ? e.message : String(e)}`);
      setOutput('');
    }
  };

  // JSON 压缩
  const compressJson = () => {
    try {
      const parsed = JSON.parse(input);
      const compressed = JSON.stringify(parsed);
      setOutput(compressed);
      setError('');
    } catch (e) {
      setError(`压缩失败: ${e instanceof Error ? e.message : String(e)}`);
      setOutput('');
    }
  };

  // JSON Diff
  const diffJson = () => {
    try {
      const obj1 = JSON.parse(input);
      const obj2 = JSON.parse(input2);
      const differences = findDifferences(obj1, obj2);
      setOutput(JSON.stringify(differences, null, 2));
      setError('');
    } catch (e) {
      setError(`对比失败: ${e instanceof Error ? e.message : String(e)}`);
      setOutput('');
    }
  };

  // 查找差异
  const findDifferences = (obj1: any, obj2: any, path = ''): any => {
    const diffs: any = {};

    // 检查类型
    if (typeof obj1 !== typeof obj2) {
      return {
        path: path || 'root',
        type: 'type_changed',
        from: typeof obj1,
        to: typeof obj2,
        oldValue: obj1,
        newValue: obj2,
      };
    }

    // 如果是基本类型
    if (obj1 !== obj2 && (typeof obj1 !== 'object' || obj1 === null || obj2 === null)) {
      return {
        path: path || 'root',
        type: 'value_changed',
        oldValue: obj1,
        newValue: obj2,
      };
    }

    // 如果是数组
    if (Array.isArray(obj1) && Array.isArray(obj2)) {
      if (obj1.length !== obj2.length) {
        diffs.length_changed = {
          from: obj1.length,
          to: obj2.length,
        };
      }
      const maxLen = Math.max(obj1.length, obj2.length);
      for (let i = 0; i < maxLen; i++) {
        if (i >= obj1.length) {
          diffs[`[${i}]`] = { type: 'added', value: obj2[i] };
        } else if (i >= obj2.length) {
          diffs[`[${i}]`] = { type: 'removed', value: obj1[i] };
        } else if (JSON.stringify(obj1[i]) !== JSON.stringify(obj2[i])) {
          diffs[`[${i}]`] = findDifferences(obj1[i], obj2[i], `${path}[${i}]`);
        }
      }
      return Object.keys(diffs).length > 0 ? diffs : null;
    }

    // 如果是对象
    if (typeof obj1 === 'object' && typeof obj2 === 'object') {
      const keys1 = Object.keys(obj1);
      const keys2 = Object.keys(obj2);
      const allKeys = new Set([...keys1, ...keys2]);

      allKeys.forEach((key) => {
        if (!(key in obj1)) {
          diffs[key] = { type: 'added', value: obj2[key] };
        } else if (!(key in obj2)) {
          diffs[key] = { type: 'removed', value: obj1[key] };
        } else if (JSON.stringify(obj1[key]) !== JSON.stringify(obj2[key])) {
          const subDiff = findDifferences(obj1[key], obj2[key], `${path}.${key}`);
          if (subDiff) {
            diffs[key] = subDiff;
          }
        }
      });

      return Object.keys(diffs).length > 0 ? diffs : null;
    }

    return null;
  };

  // JSON Schema 校验
  const validateJson = () => {
    try {
      const data = JSON.parse(input);
      const schemaObj = JSON.parse(schema);
      const errors = validateAgainstSchema(data, schemaObj);
      if (errors.length === 0) {
        setOutput('✅ JSON 数据符合 Schema 规范');
        setError('');
      } else {
        setError('❌ 校验失败:\n' + errors.join('\n'));
        setOutput('');
      }
    } catch (e) {
      setError(`校验失败: ${e instanceof Error ? e.message : String(e)}`);
      setOutput('');
    }
  };

  // 简单的 Schema 校验
  const validateAgainstSchema = (data: any, schema: any, path = 'root'): string[] => {
    const errors: string[] = [];

    // 检查类型
    if (schema.type) {
      const actualType = Array.isArray(data) ? 'array' : typeof data;
      if (actualType !== schema.type) {
        errors.push(`${path}: 期望类型 ${schema.type}，实际类型 ${actualType}`);
        return errors;
      }
    }

    // 检查必需字段
    if (schema.required && Array.isArray(schema.required)) {
      schema.required.forEach((field: string) => {
        if (!(field in data)) {
          errors.push(`${path}: 缺少必需字段 "${field}"`);
        }
      });
    }

    // 检查属性
    if (schema.properties && typeof data === 'object' && !Array.isArray(data)) {
      Object.keys(schema.properties).forEach((key) => {
        if (key in data) {
          const subErrors = validateAgainstSchema(
            data[key],
            schema.properties[key],
            `${path}.${key}`
          );
          errors.push(...subErrors);
        }
      });
    }

    // 检查数组项
    if (schema.items && Array.isArray(data)) {
      data.forEach((item, index) => {
        const subErrors = validateAgainstSchema(item, schema.items, `${path}[${index}]`);
        errors.push(...subErrors);
      });
    }

    return errors;
  };

  // JSON 转 TypeScript Interface
  const jsonToTs = () => {
    try {
      const parsed = JSON.parse(input);
      const tsInterface = generateTsInterface(parsed, 'Root');
      setOutput(tsInterface);
      setError('');
    } catch (e) {
      setError(`转换失败: ${e instanceof Error ? e.message : String(e)}`);
      setOutput('');
    }
  };

  // 生成 TypeScript Interface
  const generateTsInterface = (obj: any, name: string, indent = 0): string => {
    const indentStr = '  '.repeat(indent);

    if (Array.isArray(obj)) {
      if (obj.length === 0) {
        return 'any[]';
      }
      const itemType = generateTsInterface(obj[0], name, indent);
      return `${itemType}[]`;
    }

    if (typeof obj !== 'object' || obj === null) {
      if (typeof obj === 'string') return 'string';
      if (typeof obj === 'number') return 'number';
      if (typeof obj === 'boolean') return 'boolean';
      return 'any';
    }

    let result = `interface ${name} {\n`;
    Object.keys(obj).forEach((key) => {
      const value = obj[key];
      const safeKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : `"${key}"`;

      if (Array.isArray(value)) {
        if (value.length === 0) {
          result += `${indentStr}  ${safeKey}: any[];\n`;
        } else if (typeof value[0] === 'object' && value[0] !== null) {
          const subName = key.charAt(0).toUpperCase() + key.slice(1).replace(/s$/, '');
          result += `${indentStr}  ${safeKey}: ${subName}[];\n`;
        } else {
          const itemType =
            typeof value[0] === 'string'
              ? 'string'
              : typeof value[0] === 'number'
                ? 'number'
                : 'any';
          result += `${indentStr}  ${safeKey}: ${itemType}[];\n`;
        }
      } else if (typeof value === 'object' && value !== null) {
        const subName = key.charAt(0).toUpperCase() + key.slice(1);
        result += `${indentStr}  ${safeKey}: ${subName};\n`;
      } else {
        const type =
          typeof value === 'string'
            ? 'string'
            : typeof value === 'number'
              ? 'number'
              : typeof value === 'boolean'
                ? 'boolean'
                : 'any';
        result += `${indentStr}  ${safeKey}: ${type};\n`;
      }
    });
    result += `${indentStr}}`;

    // 生成嵌套接口
    Object.keys(obj).forEach((key) => {
      const value = obj[key];
      if (
        Array.isArray(value) &&
        value.length > 0 &&
        typeof value[0] === 'object' &&
        value[0] !== null
      ) {
        const subName = key.charAt(0).toUpperCase() + key.slice(1).replace(/s$/, '');
        result += '\n\n' + generateTsInterface(value[0], subName, indent);
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const subName = key.charAt(0).toUpperCase() + key.slice(1);
        result += '\n\n' + generateTsInterface(value, subName, indent);
      }
    });

    return result;
  };

  // 复制到剪贴板
  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      alert('复制失败');
    }
  };

  // 执行操作
  const handleExecute = async () => {
    setError('');
    setOutput('');

    switch (activeTab) {
      case 'format':
        await formatJson();
        break;
      case 'diff':
        diffJson();
        break;
      case 'validate':
        validateJson();
        break;
      case 'toTs':
        jsonToTs();
        break;
      case 'compress':
        compressJson();
        break;
    }
  };

  if (!ready) return null;

  const tabs = [
    { id: 'format' as TabType, label: '格式化', icon: Maximize2 },
    { id: 'compress' as TabType, label: '压缩', icon: Minimize2 },
    { id: 'diff' as TabType, label: '对比', icon: GitCompare },
    { id: 'validate' as TabType, label: 'Schema 校验', icon: CheckCircle },
    { id: 'toTs' as TabType, label: '转 TS', icon: Code },
  ];

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900">
      <ToolHeader icon={<FileJson className="text-blue-500" size={18} />} title="JSON 工具箱" />

      {/* 标签页 */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400 bg-white dark:bg-gray-900'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-hidden flex flex-col p-4 gap-4">
        {/* 输入区域 */}
        <div className="flex-1 flex gap-4">
          <div className="flex-1 flex flex-col">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {activeTab === 'diff'
                ? 'JSON 1'
                : activeTab === 'validate'
                  ? 'JSON 数据'
                  : 'JSON 输入'}
            </label>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={activeTab === 'validate' ? '输入要校验的 JSON 数据...' : '输入 JSON...'}
            />
          </div>

          {activeTab === 'diff' && (
            <div className="flex-1 flex flex-col">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                JSON 2
              </label>
              <textarea
                value={input2}
                onChange={(e) => setInput2(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="输入第二个 JSON..."
              />
            </div>
          )}

          {activeTab === 'validate' && (
            <div className="flex-1 flex flex-col">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                JSON Schema
              </label>
              <textarea
                value={schema}
                onChange={(e) => setSchema(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder='输入 JSON Schema...\n例如:\n{\n  "type": "object",\n  "required": ["name"],\n  "properties": {\n    "name": { "type": "string" }\n  }\n}'
              />
            </div>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-3">
          <button
            onClick={handleExecute}
            className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium"
          >
            执行
          </button>
          <button
            onClick={() => {
              setInput('');
              setInput2('');
              setOutput('');
              setError('');
              setSchema('');
            }}
            className="px-6 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors font-medium"
          >
            清空
          </button>
        </div>

        {/* 输出区域 */}
        <div className="flex-1 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {activeTab === 'diff'
                ? '差异结果'
                : activeTab === 'toTs'
                  ? 'TypeScript Interface'
                  : '输出结果'}
            </label>
            {output && (
              <button
                onClick={copyToClipboard}
                className="flex items-center gap-1 px-3 py-1 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? '已复制' : '复制'}
              </button>
            )}
          </div>
          <textarea
            value={error || output}
            readOnly
            className={`flex-1 px-3 py-2 border rounded-lg font-mono text-sm resize-none focus:outline-none ${
              error
                ? 'border-red-300 dark:border-red-600 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                : 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            }`}
            placeholder="结果将显示在这里..."
          />
        </div>
      </div>
    </div>
  );
}
