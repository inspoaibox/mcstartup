import { useState } from 'react';
import { open, save } from '@tauri-apps/api/dialog';
import { readBinaryFile, writeBinaryFile } from '@tauri-apps/api/fs';
import { PDFDocument } from 'pdf-lib';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import {
  Upload,
  X,
  CheckCircle,
  Loader,
  AlertCircle,
  Eye,
  EyeOff,
  Lock,
  Unlock,
} from 'lucide-react';

type Mode = 'encrypt' | 'decrypt';

export default function PdfEncryptTool() {
  const ready = useToolTheme();
  const [mode, setMode] = useState<Mode>('encrypt');
  const [filePath, setFilePath] = useState('');
  const [fileName, setFileName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectFile = async () => {
    const selected = await open({ filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (!selected || Array.isArray(selected)) return;
    setFilePath(selected);
    setFileName(selected.split(/[\\/]/).pop() || selected);
    setResult(null);
    setError(null);
  };

  const handleProcess = async () => {
    if (!filePath) return;
    if (mode === 'encrypt') {
      if (!password) {
        setError('请输入密码');
        return;
      }
      if (password !== confirmPassword) {
        setError('两次密码不一致');
        return;
      }
    }
    setProcessing(true);
    setError(null);
    setResult(null);

    try {
      const bytes = await readBinaryFile(filePath);
      const stem = fileName.replace(/\.pdf$/i, '');

      if (mode === 'encrypt') {
        // pdf-lib 本身不支持加密，用 owner/user password 方式
        // 实际上 pdf-lib 不支持加密，我们在文件元数据里标记并提示
        // 改用：重新保存时加入密码保护标记（pdf-lib 不支持真正加密）
        // 提示用户这个限制
        setError(
          '注意：pdf-lib 不支持真正的 PDF 加密。建议使用 Ghostscript 进行加密。\n\n安装命令：winget install ArtifexSoftware.GhostScript'
        );
        setProcessing(false);
        return;
      } else {
        // 解密：pdf-lib 用 ignoreEncryption 加载后重新保存即可移除加密
        let doc;
        try {
          doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        } catch (e2: any) {
          throw new Error('无法解密，请检查文件是否损坏');
        }
        const outBytes = await doc.save();
        const outPath = await save({
          defaultPath: `${stem}_decrypted.pdf`,
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });
        if (!outPath) {
          setProcessing(false);
          return;
        }
        await writeBinaryFile(outPath, outBytes);
        setResult(outPath);
      }
    } catch (e: any) {
      setError(e.message || '操作失败');
    } finally {
      setProcessing(false);
    }
  };

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <ToolHeader icon="🔐" title="PDF 加密/解密" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* 模式切换 */}
          <div className="flex gap-2">
            <button
              onClick={() => {
                setMode('encrypt');
                setError(null);
                setResult(null);
              }}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium border transition-colors ${mode === 'encrypt' ? 'bg-red-500 border-red-500 text-white' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300'}`}
            >
              <Lock size={15} />
              加密
            </button>
            <button
              onClick={() => {
                setMode('decrypt');
                setError(null);
                setResult(null);
              }}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium border transition-colors ${mode === 'decrypt' ? 'bg-red-500 border-red-500 text-white' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300'}`}
            >
              <Unlock size={15} />
              解密
            </button>
          </div>

          {/* 文件选择 */}
          {!filePath ? (
            <div
              onClick={selectFile}
              className="h-36 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl cursor-pointer hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"
            >
              <Upload size={28} className="text-gray-400 mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">点击选择 PDF 文件</p>
            </div>
          ) : (
            <div className="flex items-center gap-3 bg-white dark:bg-gray-800 rounded-lg px-3 py-2.5 border border-gray-200 dark:border-gray-700">
              <span className="text-2xl">📄</span>
              <p className="flex-1 text-sm font-medium truncate">{fileName}</p>
              <button
                onClick={() => {
                  setFilePath('');
                  setFileName('');
                  setResult(null);
                  setError(null);
                }}
                className="p-1 text-gray-400 hover:text-red-500 transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* 密码输入 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">
                {mode === 'encrypt' ? '设置密码' : '输入密码'}
              </span>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'encrypt' ? '输入要设置的密码' : '输入 PDF 密码'}
                  className="w-full text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 pr-10 focus:outline-none focus:ring-2 focus:ring-red-400"
                />
                <button
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </label>
            {mode === 'encrypt' && (
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">确认密码</span>
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="再次输入密码"
                  className="w-full text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400"
                />
              </label>
            )}
          </div>

          {result && (
            <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg flex items-center gap-2">
              <CheckCircle size={15} className="text-green-500 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-sm text-green-700 dark:text-green-300">
                  {mode === 'encrypt' ? '加密成功' : '解密成功'}
                </p>
                <p className="text-xs text-green-600 dark:text-green-400 truncate">
                  {result.split(/[\\/]/).pop()}
                </p>
              </div>
            </div>
          )}
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-600 dark:text-red-400 whitespace-pre-line">
                  {error}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex-shrink-0 px-4 py-3 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex items-center gap-3">
          <button
            onClick={selectFile}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
          >
            <Upload size={14} />
            {filePath ? '重新选择' : '选择文件'}
          </button>
          <div className="flex-1" />
          <button
            onClick={handleProcess}
            disabled={!filePath || !password || processing}
            className="flex items-center gap-2 px-5 py-2 bg-red-500 hover:bg-red-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed"
          >
            {processing ? (
              <>
                <Loader size={14} className="animate-spin" />
                处理中...
              </>
            ) : (
              <>{mode === 'encrypt' ? '加密' : '解密'}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
