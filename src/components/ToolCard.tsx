import { useState } from 'react';
import { ChevronDown, ChevronRight, Wrench, CheckCircle, XCircle, Eye } from 'lucide-react';

interface ToolCardProps {
  toolName: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  isRunning?: boolean;
}

export default function ToolCard({ toolName, args, result, isError, isRunning }: ToolCardProps) {
  const [argsExpanded, setArgsExpanded] = useState(false);
  const [resultExpanded, setResultExpanded] = useState(false);

  // 从命名空间化名称中提取服务器名和工具名
  const slashIdx = toolName.indexOf('/');
  const serverName = slashIdx >= 0 ? toolName.slice(0, slashIdx) : '';
  const displayName = slashIdx >= 0 ? toolName.slice(slashIdx + 1) : toolName;

  // 状态判断
  const status = isRunning
    ? 'running'
    : isError
      ? 'error'
      : result !== undefined
        ? 'success'
        : 'pending';

  // 结果摘要
  const resultStr =
    result !== undefined ? (typeof result === 'string' ? result : JSON.stringify(result)) : '';
  const resultSummary = String(
    resultStr.length > 100 ? resultStr.slice(0, 100) + '...' : resultStr
  );

  // 参数摘要
  const argsStr = args !== undefined ? JSON.stringify(args, null, 2) : '';
  const argsSummary: string =
    args && typeof args === 'object' && args !== null
      ? Object.keys(args as object).join(', ')
      : argsStr.slice(0, 50);

  // 边框颜色
  const borderColor = {
    running: 'border-blue-400 dark:border-blue-500',
    success: 'border-green-400 dark:border-green-500',
    error: 'border-red-400 dark:border-red-500',
    pending: 'border-gray-300 dark:border-gray-600',
  }[status];

  const serverNameBadge = serverName ? (
    <span className="text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
      {serverName}
    </span>
  ) : null;

  return (
    <div
      className={`my-2 rounded-lg border ${borderColor} bg-blue-50/50 dark:bg-blue-900/10 overflow-hidden text-sm`}
    >
      {/* 标题行 */}
      <div className="flex items-center gap-2 px-3 py-2">
        {/* 状态图标 */}
        {status === 'running' ? (
          <div className="flex items-center gap-0.5">
            <span className="size-1.5 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.3s]" />
            <span className="size-1.5 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.15s]" />
            <span className="size-1.5 rounded-full bg-blue-500 animate-bounce" />
          </div>
        ) : null}
        {status === 'success' ? (
          <CheckCircle size={14} className="text-green-500 flex-shrink-0" />
        ) : null}
        {status === 'error' ? <XCircle size={14} className="text-red-500 flex-shrink-0" /> : null}
        {status === 'pending' ? <Wrench size={14} className="text-gray-400 flex-shrink-0" /> : null}

        {/* 工具名称 */}
        <span className="font-medium text-gray-800 dark:text-gray-200">{displayName}</span>

        {/* 服务器名称 */}
        {serverNameBadge}

        {/* 状态文字 */}
        <span
          className={`ml-auto text-xs ${
            status === 'running'
              ? 'text-blue-500'
              : status === 'success'
                ? 'text-green-500'
                : status === 'error'
                  ? 'text-red-500'
                  : 'text-gray-400'
          }`}
        >
          {status === 'running'
            ? '执行中'
            : status === 'success'
              ? '成功'
              : status === 'error'
                ? '失败'
                : '待执行'}
        </span>

        {/* render_html 成功时显示"查看预览"按钮 */}
        {displayName === 'render_html' &&
        status === 'success' &&
        args &&
        (args as { code?: string }).code ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              const code = (args as { code: string }).code;
              window.dispatchEvent(new CustomEvent('artifact-render', { detail: code }));
            }}
            className="ml-1 flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-blue-500 hover:bg-blue-600 text-white transition-colors"
          >
            <Eye size={11} />
            查看
          </button>
        ) : null}
      </div>

      {/* 参数区域（可折叠） */}
      {args !== undefined ? (
        <div
          className="border-t border-gray-200 dark:border-gray-700 cursor-pointer"
          onClick={() => setArgsExpanded(!argsExpanded)}
        >
          <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            {argsExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span className="font-medium">参数</span>
            {!argsExpanded ? <span className="text-gray-400 truncate">{argsSummary}</span> : null}
          </div>
          {argsExpanded ? (
            <pre className="px-3 pb-2 text-xs text-gray-700 dark:text-gray-300 overflow-x-auto whitespace-pre-wrap break-words">
              {argsStr}
            </pre>
          ) : null}
        </div>
      ) : null}

      {/* 结果区域（可折叠） */}
      {result !== undefined ? (
        <div
          className="border-t border-gray-200 dark:border-gray-700 cursor-pointer"
          onClick={() => setResultExpanded(!resultExpanded)}
        >
          <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            {resultExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span className="font-medium">{isError ? '错误' : '结果'}</span>
            {!resultExpanded ? (
              <span className={`truncate ${isError ? 'text-red-400' : 'text-gray-400'}`}>
                {resultSummary}
              </span>
            ) : null}
          </div>
          {resultExpanded ? (
            <pre
              className={`px-3 pb-2 text-xs overflow-x-auto whitespace-pre-wrap break-words ${
                isError ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'
              }`}
            >
              {resultStr}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
