// 文本批量替换工具 - 简化版（仅处理粘贴内容）
import { useState, useEffect } from 'react';
import { Copy, Check, Plus, Trash2, Play, RotateCcw, Eye, Save, Upload } from 'lucide-react';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';
import { useToolDataStore, type ReplaceRule } from '../stores/toolDataStore';

interface ChangeRecord {
  line: number;
  original: string;
  replaced: string;
  matchCount: number;
}

export default function TextBatchReplaceTool() {
  const ready = useToolTheme();
  const { data, loaded, loadData, updateReplaceRules } = useToolDataStore();
  const [inputText, setInputText] = useState('');
  const [outputText, setOutputText] = useState('');
  const [rules, setRules] = useState<ReplaceRule[]>([]);
  const [editingRule, setEditingRule] = useState<ReplaceRule | null>(null);
  const [changes, setChanges] = useState<ChangeRecord[]>([]);
  const [copied, setCopied] = useState(false);
  const [showRuleEditor, setShowRuleEditor] = useState(false);

  // 1. 加载数据
  useEffect(() => {
    if (!loaded) {
      loadData();
    }
  }, [loaded, loadData]);

  // 2. 同步数据到本地状态
  useEffect(() => {
    if (loaded && data.textBatchReplace?.rules) {
      setRules(data.textBatchReplace.rules);
    }
  }, [loaded, data.textBatchReplace]);

  // 3. 保存数据（当 rules 变化时自动保存）
  useEffect(() => {
    if (loaded && rules.length >= 0) {
      updateReplaceRules(rules);
    }
  }, [rules, loaded, updateReplaceRules]);

  // 添加新规则
  const handleAddRule = () => {
    const newRule: ReplaceRule = {
      id: Date.now().toString(),
      enabled: true,
      mode: 'text',
      find: '',
      replace: '',
      caseSensitive: false,
      wholeWord: false,
    };
    setEditingRule(newRule);
    setShowRuleEditor(true);
  };

  // 保存规则
  const handleSaveRule = () => {
    if (!editingRule || !editingRule.find) return;

    const existingIndex = rules.findIndex((r) => r.id === editingRule.id);
    if (existingIndex >= 0) {
      const newRules = [...rules];
      newRules[existingIndex] = editingRule;
      setRules(newRules);
    } else {
      setRules([...rules, editingRule]);
    }

    setEditingRule(null);
    setShowRuleEditor(false);
  };

  // 删除规则
  const handleDeleteRule = (id: string) => {
    setRules(rules.filter((r) => r.id !== id));
  };

  // 切换规则启用状态
  const handleToggleRule = (id: string) => {
    setRules(rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  };

  // 编辑规则
  const handleEditRule = (rule: ReplaceRule) => {
    setEditingRule({ ...rule });
    setShowRuleEditor(true);
  };

  // 执行替换（预览或应用）
  const handleExecute = (_preview: boolean = true) => {
    if (!inputText.trim() || rules.filter((r) => r.enabled).length === 0) {
      alert('请输入文本并添加至少一条启用的规则');
      return;
    }

    let result = inputText;
    const changeRecords: ChangeRecord[] = [];
    const lines = inputText.split('\n');

    // 按顺序执行所有启用的规则
    rules
      .filter((r) => r.enabled)
      .forEach((rule) => {
        try {
          if (rule.mode === 'text') {
            // 普通文本替换
            let searchStr = rule.find;
            let flags = 'g';

            if (!rule.caseSensitive) {
              flags += 'i';
            }

            if (rule.wholeWord) {
              searchStr = `\\b${searchStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`;
            } else {
              searchStr = searchStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            }

            const regex = new RegExp(searchStr, flags);
            const beforeReplace = result;
            result = result.replace(regex, rule.replace);

            // 记录变更
            if (beforeReplace !== result) {
              lines.forEach((line, index) => {
                if (regex.test(line)) {
                  const matches = line.match(regex);
                  changeRecords.push({
                    line: index + 1,
                    original: line,
                    replaced: line.replace(regex, rule.replace),
                    matchCount: matches?.length || 0,
                  });
                }
              });
            }
          } else {
            // 正则表达式替换
            let flags = 'g';
            if (!rule.caseSensitive) {
              flags += 'i';
            }

            const regex = new RegExp(rule.find, flags);
            const beforeReplace = result;
            result = result.replace(regex, rule.replace);

            // 记录变更
            if (beforeReplace !== result) {
              lines.forEach((line, index) => {
                if (regex.test(line)) {
                  const matches = line.match(regex);
                  changeRecords.push({
                    line: index + 1,
                    original: line,
                    replaced: line.replace(regex, rule.replace),
                    matchCount: matches?.length || 0,
                  });
                }
              });
            }
          }
        } catch (error) {
          console.error('规则执行失败:', rule, error);
          alert(`规则执行失败：${rule.description || rule.find}\n错误：${error}`);
        }
      });

    setOutputText(result);
    setChanges(changeRecords);
  };

  // 复制结果
  const handleCopy = () => {
    navigator.clipboard.writeText(outputText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // 清空
  const handleClear = () => {
    setInputText('');
    setOutputText('');
    setChanges([]);
  };

  // 回滚
  const handleRollback = () => {
    setOutputText('');
    setChanges([]);
  };

  // 导出规则
  const handleExportRules = () => {
    const json = JSON.stringify(rules, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `replace-rules-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 导入规则
  const handleImportRules = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const imported = JSON.parse(event.target?.result as string);
            if (Array.isArray(imported)) {
              setRules(imported);
              alert('规则导入成功！');
            }
          } catch (error) {
            alert('导入失败：文件格式错误');
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900">
      {/* Header */}
      <ToolHeader icon="🔄" title="文本批量替换" subtitle="支持正则表达式" />

      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：规则面板 */}
        <div className="w-80 border-r border-gray-200 dark:border-gray-800 flex flex-col">
          <div className="p-4 border-b border-gray-200 dark:border-gray-800">
            <div className="flex gap-2">
              <button
                onClick={handleAddRule}
                className="flex-1 px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center justify-center gap-2 text-sm"
              >
                <Plus size={16} />
                添加规则
              </button>
              <button
                onClick={handleImportRules}
                className="px-3 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                title="导入规则"
              >
                <Upload size={16} />
              </button>
              <button
                onClick={handleExportRules}
                className="px-3 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                title="导出规则"
              >
                <Save size={16} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {rules.length === 0 ? (
              <div className="text-center py-12 text-gray-500 dark:text-gray-400 text-sm">
                <p>还没有添加规则</p>
                <p className="mt-2">点击"添加规则"开始</p>
              </div>
            ) : (
              rules.map((rule, index) => (
                <div
                  key={rule.id}
                  className={`p-3 rounded-lg border-2 transition-all ${
                    rule.enabled
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 opacity-60'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={() => handleToggleRule(rule.id)}
                        className="w-4 h-4"
                      />
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                        规则 {index + 1}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          rule.mode === 'regex'
                            ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
                            : 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
                        }`}
                      >
                        {rule.mode === 'regex' ? '正则' : '文本'}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleEditRule(rule)}
                        className="p-1 text-blue-500 hover:bg-blue-100 dark:hover:bg-blue-900 rounded"
                      >
                        <Eye size={14} />
                      </button>
                      <button
                        onClick={() => handleDeleteRule(rule.id)}
                        className="p-1 text-red-500 hover:bg-red-100 dark:hover:bg-red-900 rounded"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  {rule.description && (
                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                      {rule.description}
                    </p>
                  )}
                  <div className="text-xs space-y-1">
                    <div className="flex items-start gap-2">
                      <span className="text-gray-500 dark:text-gray-400 flex-shrink-0">查找:</span>
                      <code className="flex-1 bg-white dark:bg-gray-900 px-2 py-1 rounded font-mono break-all">
                        {rule.find}
                      </code>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-gray-500 dark:text-gray-400 flex-shrink-0">替换:</span>
                      <code className="flex-1 bg-white dark:bg-gray-900 px-2 py-1 rounded font-mono break-all">
                        {rule.replace}
                      </code>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 中间：输入输出区域 */}
        <div className="flex-1 flex flex-col">
          {/* 操作栏 */}
          <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
            <div className="flex gap-2">
              <button
                onClick={() => handleExecute(true)}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-2"
              >
                <Eye size={16} />
                预览替换
              </button>
              <button
                onClick={() => handleExecute(false)}
                className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors flex items-center gap-2"
              >
                <Play size={16} />
                执行替换
              </button>
              {outputText && (
                <>
                  <button
                    onClick={handleCopy}
                    className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                      copied
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                    }`}
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                    {copied ? '已复制' : '复制结果'}
                  </button>
                  <button
                    onClick={handleRollback}
                    className="px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors flex items-center gap-2"
                  >
                    <RotateCcw size={16} />
                    回滚
                  </button>
                </>
              )}
            </div>
            <button
              onClick={handleClear}
              className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors flex items-center gap-2"
            >
              <Trash2 size={16} />
              清空
            </button>
          </div>

          {/* 输入输出区域 */}
          <div className="flex-1 grid grid-cols-2 gap-4 p-4 overflow-hidden">
            {/* 输入 */}
            <div className="flex flex-col">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                输入文本
              </label>
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="粘贴需要处理的文本..."
                className="flex-1 px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {inputText.split('\n').length} 行 · {inputText.length} 字符
              </div>
            </div>

            {/* 输出 */}
            <div className="flex flex-col">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                输出结果
                {changes.length > 0 && (
                  <span className="ml-2 text-blue-500">({changes.length} 处变更)</span>
                )}
              </label>
              <textarea
                value={outputText}
                readOnly
                placeholder="替换结果将显示在这里..."
                className="flex-1 px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 font-mono text-sm resize-none focus:outline-none"
              />
              <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {outputText.split('\n').length} 行 · {outputText.length} 字符
              </div>
            </div>
          </div>

          {/* 变更记录 */}
          {changes.length > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-800 p-4 max-h-48 overflow-y-auto">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                变更记录
              </h3>
              <div className="space-y-2">
                {changes.slice(0, 10).map((change, index) => (
                  <div key={index} className="text-xs bg-gray-50 dark:bg-gray-800 p-2 rounded">
                    <div className="text-gray-500 dark:text-gray-400 mb-1">
                      第 {change.line} 行 · {change.matchCount} 处匹配
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <span className="text-red-600 dark:text-red-400 line-through">
                          {change.original}
                        </span>
                      </div>
                      <div className="flex-1">
                        <span className="text-green-600 dark:text-green-400">
                          {change.replaced}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
                {changes.length > 10 && (
                  <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
                    还有 {changes.length - 10} 条变更...
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 规则编辑器模态框 */}
      {showRuleEditor && editingRule && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-[600px] max-h-[80vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 dark:border-gray-800">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                {rules.find((r) => r.id === editingRule.id) ? '编辑规则' : '添加规则'}
              </h2>
            </div>

            <div className="p-6 space-y-4">
              {/* 描述 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  规则描述（可选）
                </label>
                <input
                  type="text"
                  value={editingRule.description || ''}
                  onChange={(e) => setEditingRule({ ...editingRule, description: e.target.value })}
                  placeholder="例如：清理多余空格"
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* 模式选择 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  替换模式
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditingRule({ ...editingRule, mode: 'text' })}
                    className={`flex-1 px-4 py-2 rounded-lg transition-colors ${
                      editingRule.mode === 'text'
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    普通文本
                  </button>
                  <button
                    onClick={() => setEditingRule({ ...editingRule, mode: 'regex' })}
                    className={`flex-1 px-4 py-2 rounded-lg transition-colors ${
                      editingRule.mode === 'regex'
                        ? 'bg-purple-500 text-white'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    正则表达式
                  </button>
                </div>
              </div>

              {/* 查找 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  查找内容 *
                </label>
                <input
                  type="text"
                  value={editingRule.find}
                  onChange={(e) => setEditingRule({ ...editingRule, find: e.target.value })}
                  placeholder={editingRule.mode === 'regex' ? '例如：\\s+' : '例如：旧文本'}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* 替换 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  替换为
                </label>
                <input
                  type="text"
                  value={editingRule.replace}
                  onChange={(e) => setEditingRule({ ...editingRule, replace: e.target.value })}
                  placeholder={editingRule.mode === 'regex' ? '例如：$1（捕获组）' : '例如：新文本'}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* 选项 */}
              <div className="space-y-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={editingRule.caseSensitive}
                    onChange={(e) =>
                      setEditingRule({ ...editingRule, caseSensitive: e.target.checked })
                    }
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">区分大小写</span>
                </label>
                {editingRule.mode === 'text' && (
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={editingRule.wholeWord}
                      onChange={(e) =>
                        setEditingRule({ ...editingRule, wholeWord: e.target.checked })
                      }
                      className="w-4 h-4"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">全词匹配</span>
                  </label>
                )}
              </div>

              {/* 提示 */}
              {editingRule.mode === 'regex' && (
                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-xs text-blue-700 dark:text-blue-300">
                  <p className="font-medium mb-1">正则表达式提示：</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>\s+ 匹配一个或多个空白字符</li>
                    <li>\d+ 匹配一个或多个数字</li>
                    <li>(.*) 捕获任意内容，可用 $1 引用</li>
                    <li>^开头 $结尾</li>
                  </ul>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-gray-200 dark:border-gray-800 flex justify-end gap-2">
              <button
                onClick={() => {
                  setEditingRule(null);
                  setShowRuleEditor(false);
                }}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSaveRule}
                disabled={!editingRule.find}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                保存规则
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
