import { useState, useMemo, useRef } from 'react';
import {
  Copy,
  Check,
  RotateCcw,
  ArrowDown,
  ClipboardPaste,
  Lightbulb,
  Upload,
  Image as ImageIcon,
} from 'lucide-react';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';

type ConvertMode = 'text' | 'image';
type OperationType = 'encode' | 'decode';

// 文本转 Base64
function textToBase64(text: string): string {
  if (!text) return '';
  try {
    return btoa(unescape(encodeURIComponent(text)));
  } catch {
    return '';
  }
}

// Base64 转文本
function base64ToText(base64: string): string {
  if (!base64.trim()) return '';
  try {
    return decodeURIComponent(escape(atob(base64.trim())));
  } catch {
    return '解码失败：无效的 Base64 字符串';
  }
}

// 图片文件转 Base64
function imageToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const EXAMPLE_TEXT = '你好，世界！\nHello, World!\n这是一个 Base64 编码示例。';
const EXAMPLE_BASE64 =
  '5L2g5aW977yM5LiW55WM77yBCkhlbGxvLCBXb3JsZCEK6L+Z5piv5LiA5LiqIEJhc2U2NCDnvJbnoIHnpLrkvosuCg==';

export default function Base64Tool() {
  const ready = useToolTheme();
  const [mode, setMode] = useState<ConvertMode>('text');
  const [operation, setOperation] = useState<OperationType>('encode');
  const [textInput, setTextInput] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 文本模式的输出
  const textOutput = useMemo(() => {
    if (mode !== 'text') return '';
    if (operation === 'encode') {
      return textToBase64(textInput);
    } else {
      return base64ToText(textInput);
    }
  }, [mode, operation, textInput]);

  // 图片模式的输出
  const [imageOutput, setImageOutput] = useState('');

  const handleCopy = () => {
    const output = mode === 'text' ? textOutput : imageOutput;
    if (!output) return;
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setTextInput(text);
    } catch {}
  };

  const handleExample = () => {
    if (mode === 'text') {
      setTextInput(operation === 'encode' ? EXAMPLE_TEXT : EXAMPLE_BASE64);
    }
  };

  const handleClear = () => {
    setTextInput('');
    setImageFile(null);
    setImagePreview('');
    setImageOutput('');
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 检查是否为图片
    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件');
      return;
    }

    setImageFile(file);

    if (operation === 'encode') {
      // 编码：显示预览和生成 Base64
      const preview = URL.createObjectURL(file);
      setImagePreview(preview);
      const base64 = await imageToBase64(file);
      setImageOutput(base64);
    } else {
      // 解码模式不需要文件上传
      setImagePreview('');
      setImageOutput('');
    }
  };

  const handleImageDecode = () => {
    if (!textInput.trim()) return;

    try {
      // 验证是否为有效的 Data URL
      if (textInput.startsWith('data:image/')) {
        setImageOutput(textInput);
        setImagePreview(textInput);
      } else {
        // 尝试添加 Data URL 前缀
        const base64Data = textInput.trim();
        const dataUrl = `data:image/png;base64,${base64Data}`;
        setImageOutput(dataUrl);
        setImagePreview(dataUrl);
      }
    } catch {
      alert('无效的 Base64 图片数据');
    }
  };

  const handleModeChange = (newMode: ConvertMode) => {
    setMode(newMode);
    handleClear();
  };

  const handleOperationChange = (newOp: OperationType) => {
    setOperation(newOp);
    handleClear();
  };

  if (!ready) return null;

  const currentOutput = mode === 'text' ? textOutput : imageOutput;

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900 rounded-2xl overflow-hidden shadow-2xl border border-gray-200/50 dark:border-gray-700/50">
      <ToolHeader
        icon="🔐"
        title="Base64 转换"
        subtitle={`${mode === 'text' ? '文本' : '图片'} · ${operation === 'encode' ? '编码' : '解码'}`}
        closeMode="hide"
      />

      <div className="flex-1 flex flex-col p-4 gap-3 min-h-0 overflow-hidden">
        {/* Mode & Operation controls */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Mode toggle */}
          <div className="flex items-center gap-0.5 p-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg">
            <button
              onClick={() => handleModeChange('text')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                mode === 'text'
                  ? 'bg-purple-500 text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              文本转换
            </button>
            <button
              onClick={() => handleModeChange('image')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                mode === 'image'
                  ? 'bg-purple-500 text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              图片转换
            </button>
          </div>

          {/* Operation toggle */}
          <div className="flex items-center gap-0.5 p-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg">
            <button
              onClick={() => handleOperationChange('encode')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                operation === 'encode'
                  ? 'bg-blue-500 text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              转换为 Base64
            </button>
            <button
              onClick={() => handleOperationChange('decode')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                operation === 'decode'
                  ? 'bg-blue-500 text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              Base64 解码
            </button>
          </div>
        </div>

        {/* Content area */}
        {mode === 'text' ? (
          // 文本模式
          <div className="flex-1 grid grid-cols-2 gap-3 min-h-0">
            {/* Input */}
            <div className="flex flex-col gap-1 min-h-0">
              <div className="flex items-center justify-between flex-shrink-0">
                <label className="text-xs text-gray-500 dark:text-gray-400">
                  {operation === 'encode' ? '输入文本' : '输入 Base64'}
                </label>
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleClear}
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  >
                    <RotateCcw size={10} />
                    清空
                  </button>
                  <button
                    onClick={handlePaste}
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  >
                    <ClipboardPaste size={10} />
                    粘贴
                  </button>
                  <button
                    onClick={handleExample}
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  >
                    <Lightbulb size={10} />
                    示例
                  </button>
                </div>
              </div>
              <textarea
                autoFocus
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder={
                  operation === 'encode'
                    ? '在此输入需要编码的文本...'
                    : '在此输入需要解码的 Base64 字符串...'
                }
                className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
              <span className="text-[11px] text-gray-400 dark:text-gray-500 text-right">
                字符数：{textInput.length}
              </span>
            </div>

            {/* Output */}
            <div className="flex flex-col gap-1 min-h-0">
              <div className="flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs text-gray-500 dark:text-gray-400">转换结果</label>
                  <ArrowDown size={10} className="text-blue-400" />
                </div>
                <button
                  onClick={handleCopy}
                  disabled={!textOutput}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    copied
                      ? 'bg-green-500 text-white'
                      : textOutput
                        ? 'bg-blue-500 hover:bg-blue-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  {copied ? <Check size={11} /> : <Copy size={11} />}
                  {copied ? '已复制' : '复制结果'}
                </button>
              </div>
              <textarea
                readOnly
                value={textOutput}
                placeholder={
                  operation === 'encode'
                    ? 'Base64 编码结果将在这里显示...'
                    : '解码后的文本将在这里显示...'
                }
                className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 resize-none focus:outline-none font-mono"
              />
              <span className="text-[11px] text-gray-400 dark:text-gray-500 text-right">
                字符数：{textOutput.length}
              </span>
            </div>
          </div>
        ) : (
          // 图片模式
          <div className="flex-1 grid grid-cols-2 gap-3 min-h-0">
            {/* Input */}
            <div className="flex flex-col gap-2 min-h-0">
              <label className="text-xs text-gray-500 dark:text-gray-400">
                {operation === 'encode' ? '选择图片' : '输入 Base64'}
              </label>

              {operation === 'encode' ? (
                // 编码：上传图片
                <div className="flex-1 flex flex-col gap-2 min-h-0">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
                  >
                    <Upload size={16} className="text-gray-400" />
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      点击选择图片文件
                    </span>
                  </button>

                  {imagePreview && (
                    <div className="flex-1 flex flex-col gap-2 min-h-0 border border-gray-200 dark:border-gray-700 rounded-xl p-3 bg-gray-50 dark:bg-gray-800">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500 dark:text-gray-400">预览</span>
                        <button
                          onClick={handleClear}
                          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        >
                          清除
                        </button>
                      </div>
                      <div className="flex-1 flex items-center justify-center min-h-0 overflow-hidden">
                        <img
                          src={imagePreview}
                          alt="Preview"
                          className="max-w-full max-h-full object-contain rounded-lg"
                        />
                      </div>
                      {imageFile && (
                        <div className="text-[11px] text-gray-400 dark:text-gray-500">
                          {imageFile.name} ({(imageFile.size / 1024).toFixed(2)} KB)
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                // 解码：输入 Base64
                <div className="flex-1 flex flex-col gap-2 min-h-0">
                  <textarea
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    placeholder="在此粘贴图片的 Base64 字符串..."
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                  <button
                    onClick={handleImageDecode}
                    disabled={!textInput.trim()}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      textInput.trim()
                        ? 'bg-blue-500 hover:bg-blue-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    解码为图片
                  </button>
                </div>
              )}
            </div>

            {/* Output */}
            <div className="flex flex-col gap-2 min-h-0">
              <div className="flex items-center justify-between">
                <label className="text-xs text-gray-500 dark:text-gray-400">
                  {operation === 'encode' ? 'Base64 结果' : '图片预览'}
                </label>
                {currentOutput && (
                  <button
                    onClick={handleCopy}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                      copied
                        ? 'bg-green-500 text-white'
                        : 'bg-blue-500 hover:bg-blue-600 text-white'
                    }`}
                  >
                    {copied ? <Check size={11} /> : <Copy size={11} />}
                    {copied ? '已复制' : '复制结果'}
                  </button>
                )}
              </div>

              {operation === 'encode' ? (
                // 编码：显示 Base64 文本
                <div className="flex-1 flex flex-col gap-1 min-h-0">
                  <textarea
                    readOnly
                    value={imageOutput}
                    placeholder="Base64 编码结果将在这里显示..."
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 resize-none focus:outline-none font-mono"
                  />
                  <span className="text-[11px] text-gray-400 dark:text-gray-500 text-right">
                    字符数：{imageOutput.length}
                  </span>
                </div>
              ) : (
                // 解码：显示图片
                <div className="flex-1 flex flex-col gap-2 min-h-0 border border-gray-200 dark:border-gray-700 rounded-xl p-3 bg-gray-50 dark:bg-gray-800">
                  {imagePreview ? (
                    <div className="flex-1 flex items-center justify-center min-h-0 overflow-hidden">
                      <img
                        src={imagePreview}
                        alt="Decoded"
                        className="max-w-full max-h-full object-contain rounded-lg"
                      />
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-500">
                      <div className="flex flex-col items-center gap-2">
                        <ImageIcon size={32} />
                        <span className="text-sm">解码后的图片将在这里显示</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
