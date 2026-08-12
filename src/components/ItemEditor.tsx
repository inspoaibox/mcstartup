import { useState, useEffect, useRef } from 'react';
import { useItemsStore } from '../stores/itemsStore';
import { useGroupsStore } from '../stores/groupsStore';
import { X, FolderOpen, Plus, Trash2 } from 'lucide-react';
import { open } from '@tauri-apps/api/dialog';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import { LaunchItem, LaunchProfile } from '../types';

/** 根据配置名称自动生成别名后缀 */
function autoAlias(profileName: string, baseAlias: string): string {
  if (!profileName) return '';
  const suffix = profileName
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 8);
  return suffix ? `${baseAlias}-${suffix}` : '';
}

interface ItemEditorProps {
  onClose: () => void;
  itemId?: string;
  defaultGroupId?: string;
  prefillData?: {
    name?: string;
    alias?: string;
    targetPath?: string;
    groupId?: string;
    itemType?: NonNullable<LaunchItem['itemType']>;
  };
}

export default function ItemEditor({
  onClose,
  itemId,
  defaultGroupId,
  prefillData,
}: ItemEditorProps) {
  const { addItem, updateItem, items } = useItemsStore();
  const { groups } = useGroupsStore();

  // 防止拖放松手时触发遮罩层关闭
  const justDroppedRef = useRef(false);
  const isDraggingRef = useRef(false);

  useEffect(() => {
    // 监听 Tauri 文件拖放事件，标记刚刚发生了拖放
    const handleFileDrop = () => {
      justDroppedRef.current = true;
      // 500ms 后重置，确保拖放完成
      setTimeout(() => {
        justDroppedRef.current = false;
      }, 500);
    };

    // 监听原生 drop 事件（HTML5 拖放）
    const handleNativeDrop = () => {
      justDroppedRef.current = true;
      setTimeout(() => {
        justDroppedRef.current = false;
      }, 500);
    };

    // 监听拖拽开始和结束
    const handleDragEnter = () => {
      isDraggingRef.current = true;
    };

    const handleDragLeave = () => {
      isDraggingRef.current = false;
    };

    window.addEventListener('drop', handleNativeDrop, true);
    window.addEventListener('dragenter', handleDragEnter, true);
    window.addEventListener('dragleave', handleDragLeave, true);

    // 也监听 Tauri 的文件拖放事件
    let unlistenFileDrop: (() => void) | undefined;
    listen('tauri://file-drop', handleFileDrop).then((fn) => {
      unlistenFileDrop = fn;
    });

    return () => {
      window.removeEventListener('drop', handleNativeDrop, true);
      window.removeEventListener('dragenter', handleDragEnter, true);
      window.removeEventListener('dragleave', handleDragLeave, true);
      if (unlistenFileDrop) unlistenFileDrop();
    };
  }, []);

  const existingItem = itemId ? items.find((i) => i.id === itemId) : null;

  const [itemType, setItemType] = useState<'app' | 'url' | 'folder' | 'script'>(
    existingItem?.itemType ||
      prefillData?.itemType ||
      (prefillData?.targetPath?.startsWith('http')
        ? 'url'
        : prefillData?.targetPath?.match(/\.(cmd|bat|ps1|ahk)$/i)
          ? 'script'
          : prefillData?.targetPath && !prefillData.targetPath.match(/\.(exe|bat|cmd|ps1|lnk)$/i)
            ? 'folder'
            : 'app')
  );
  const [formData, setFormData] = useState({
    name: existingItem?.name || prefillData?.name || '',
    alias: existingItem?.alias || prefillData?.alias || '',
    targetPath: existingItem?.targetPath || prefillData?.targetPath || '',
    arguments: existingItem?.arguments || '',
    workingDir: existingItem?.workingDir || '',
    description: existingItem?.description || '',
    groupId: existingItem?.groupId || prefillData?.groupId || defaultGroupId || '',
    runAsAdmin: existingItem?.runAsAdmin || false,
    startupEnabled: existingItem?.startupEnabled || false,
    hotkey: existingItem?.hotkey || '',
    scriptShowWindow: existingItem?.scriptShowWindow ?? true,
    scriptContent: existingItem?.scriptContent || '',
    scriptType: (existingItem?.scriptType as 'bat' | 'ps1' | 'ahk' | undefined) || 'bat',
  });

  const [scriptInputMode, setScriptInputMode] = useState<'file' | 'content'>(
    existingItem?.scriptContent ? 'content' : 'file'
  );

  const [profiles, setProfiles] = useState<LaunchProfile[]>(existingItem?.launchProfiles || []);
  const [isSaving, setIsSaving] = useState(false);

  const [isComposing, setIsComposing] = useState({
    name: false,
    alias: false,
    description: false,
  });
  const [compositionValues, setCompositionValues] = useState({
    name: '',
    alias: '',
    description: '',
  });

  // 检查是否是首次添加项目（用于显示 Win+R 提示）
  useEffect(() => {
    // 预留：未来可以在这里添加首次使用提示逻辑
  }, [itemId, items.length]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving || isComposing.name || isComposing.alias || isComposing.description) return;

    try {
      // 检查别名冲突（编辑模式下排除自己）
      const existingItem = items.find(
        (item) => item.alias.toLowerCase() === formData.alias.toLowerCase() && item.id !== itemId
      );

      if (existingItem) {
        alert(
          `❌ 别名冲突\n\n` +
            `别名"${formData.alias}"已被项目"${existingItem.name}"使用。\n\n` +
            `每个别名必须唯一，请使用其他别名。\n\n` +
            `建议：${formData.alias}2、${formData.alias}_new、my${formData.alias}`
        );
        return;
      }

      // URL 类型验证
      if (itemType === 'url') {
        let url = formData.targetPath.trim();

        // 如果没有协议，自动添加 https://
        if (!url.match(/^https?:\/\//i)) {
          url = 'https://' + url;
          setFormData((prev) => ({ ...prev, targetPath: url }));
        }

        // 验证 URL 格式
        try {
          new URL(url);
        } catch {
          alert(
            `❌ 网址格式错误\n\n` +
              `请输入有效的网址。\n\n` +
              `正确示例：\n` +
              `• https://www.google.com\n` +
              `• www.baidu.com\n` +
              `• github.com/username`
          );
          return;
        }
      }

      // 文件夹类型验证
      if (itemType === 'folder') {
        const isValid = await invoke<boolean>('validate_path', {
          path: formData.targetPath,
          pathType: 'folder',
        });

        if (!isValid) {
          const confirmed = window.confirm(
            `⚠️ 文件夹路径不存在\n\n` +
              `路径：${formData.targetPath}\n\n` +
              `是否仍要添加？\n` +
              `（启动时可能会失败）`
          );
          if (!confirmed) return;
        }
      }

      const isFirstItem = items.length === 0 && !itemId;

      const itemData = {
        ...formData,
        itemType,
        launchProfiles: profiles.length > 0 ? profiles : undefined,
        scriptShowWindow: itemType === 'script' ? formData.scriptShowWindow : undefined,
        scriptContent:
          itemType === 'script' && scriptInputMode === 'content'
            ? formData.scriptContent
            : undefined,
        scriptType:
          itemType === 'script' && scriptInputMode === 'content' ? formData.scriptType : undefined,
        targetPath:
          itemType === 'script' && scriptInputMode === 'content'
            ? `[内联脚本: ${formData.scriptType}]`
            : formData.targetPath,
      };

      setIsSaving(true);
      if (itemId) {
        // 编辑模式：只传递变更的字段，后端负责 merge
        await updateItem(itemId, itemData);
      } else {
        await addItem(itemData);
      }

      // 如果是首次添加项目，显示 Win+R 提示
      if (isFirstItem) {
        const batchDir = await invoke<string>('get_batch_dir');
        const typeText =
          itemType === 'url'
            ? '打开网址'
            : itemType === 'folder'
              ? '打开文件夹'
              : itemType === 'script'
                ? '执行脚本'
                : '启动应用';
        alert(
          `✅ 项目添加成功！\n\n` +
            `💡 首次使用提示：\n\n` +
            `要使用 Win+R 快捷启动，需要重启资源管理器：\n` +
            `1. 按 Ctrl+Shift+Esc 打开任务管理器\n` +
            `2. 右键"Windows 资源管理器" → 重新启动\n\n` +
            `之后按 Win+R，输入"${formData.alias}"即可${typeText}！\n\n` +
            `✨ 支持应用、网址、文件夹、脚本四种类型\n` +
            `📁 启动器位置：${batchDir}\n\n` +
            `（此操作只需做一次）`
        );
      }

      onClose();
    } catch (error) {
      console.error('Failed to save item:', error);
      alert(`保存失败：${error}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (!isComposing.name) {
      setFormData({ ...formData, name: value });
    }
    setCompositionValues({ ...compositionValues, name: value });
  };

  const handleNameCompositionEnd = (e: React.CompositionEvent<HTMLInputElement>) => {
    setIsComposing({ ...isComposing, name: false });
    const value = (e.target as HTMLInputElement).value;
    setFormData({ ...formData, name: value });
  };

  const handleAliasChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (!isComposing.alias) {
      setFormData({ ...formData, alias: value });
    }
    setCompositionValues({ ...compositionValues, alias: value });
  };

  const handleAliasCompositionEnd = (e: React.CompositionEvent<HTMLInputElement>) => {
    setIsComposing({ ...isComposing, alias: false });
    const value = (e.target as HTMLInputElement).value;
    setFormData({ ...formData, alias: value });
  };

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    if (!isComposing.description) {
      setFormData({ ...formData, description: value });
    }
    setCompositionValues({ ...compositionValues, description: value });
  };

  const handleDescriptionCompositionEnd = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
    setIsComposing({ ...isComposing, description: false });
    const value = (e.target as HTMLTextAreaElement).value;
    setFormData({ ...formData, description: value });
  };

  const handleBrowse = async () => {
    if (itemType === 'folder') {
      const selected = await open({ multiple: false, directory: true });
      if (selected && typeof selected === 'string') {
        setFormData({ ...formData, targetPath: selected });
        if (!formData.name) {
          const folderName = selected.split('\\').pop()?.split('/').pop() || '';
          setFormData((prev) => ({
            ...prev,
            targetPath: selected,
            name: folderName,
            alias: prev.alias || folderName.toLowerCase().replace(/\s+/g, ''),
          }));
        }
      }
    } else if (itemType === 'script') {
      const selected = await open({
        multiple: false,
        filters: [
          { name: '脚本文件', extensions: ['cmd', 'bat', 'ps1', 'ahk'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      });
      if (selected && typeof selected === 'string') {
        setFormData({ ...formData, targetPath: selected });
        if (!formData.name) {
          const fileName = selected.split('\\').pop()?.split('/').pop() || '';
          const nameWithoutExt = fileName.replace(/\.(cmd|bat|ps1|ahk)$/i, '');
          setFormData((prev) => ({
            ...prev,
            targetPath: selected,
            name: nameWithoutExt || fileName,
            alias:
              prev.alias ||
              nameWithoutExt
                .toLowerCase()
                .replace(/\s+/g, '')
                .replace(/[^a-z0-9]/gi, ''),
          }));
        }
      }
    } else {
      const selected = await open({
        multiple: false,
        filters: [
          { name: 'Executable', extensions: ['exe', 'bat', 'cmd', 'ps1'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (selected && typeof selected === 'string') {
        setFormData({ ...formData, targetPath: selected });
        if (!formData.name) {
          const fileName = selected.split('\\').pop()?.split('/').pop() || '';
          const nameWithoutExt = fileName.replace(/\.(exe|bat|cmd|ps1)$/i, '');
          const cleanName = nameWithoutExt
            .replace(/[-_](x64|x86|win|windows|setup|installer)$/i, '')
            .replace(/[-_]/g, ' ')
            .trim();
          const formattedName = cleanName
            .split(' ')
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
          setFormData((prev) => ({
            ...prev,
            targetPath: selected,
            name: formattedName || fileName,
            alias: prev.alias || cleanName.toLowerCase().replace(/\s+/g, ''),
          }));
        }
      }
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onMouseDown={(e) => {
        // 只有在点击背景时才关闭，且不在拖拽或刚拖放完成时
        if (e.target === e.currentTarget && !justDroppedRef.current && !isDraggingRef.current) {
          onClose();
        }
      }}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            {itemId ? '编辑项目' : '添加新项目'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          <div className="space-y-4">
            {/* 类型选择 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                项目类型 *
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setItemType('app')}
                  className={`px-4 py-2 rounded-lg border-2 transition-all ${
                    itemType === 'app'
                      ? 'border-[#0066ff] bg-[#0066ff]/5 text-[#0066ff] font-medium'
                      : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                  }`}
                >
                  应用程序
                </button>
                <button
                  type="button"
                  onClick={() => setItemType('url')}
                  className={`px-4 py-2 rounded-lg border-2 transition-all ${
                    itemType === 'url'
                      ? 'border-[#0066ff] bg-[#0066ff]/5 text-[#0066ff] font-medium'
                      : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                  }`}
                >
                  网址
                </button>
                <button
                  type="button"
                  onClick={() => setItemType('folder')}
                  className={`px-4 py-2 rounded-lg border-2 transition-all ${
                    itemType === 'folder'
                      ? 'border-[#0066ff] bg-[#0066ff]/5 text-[#0066ff] font-medium'
                      : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                  }`}
                >
                  文件夹
                </button>
                <button
                  type="button"
                  onClick={() => setItemType('script')}
                  className={`px-4 py-2 rounded-lg border-2 transition-all ${
                    itemType === 'script'
                      ? 'border-[#0066ff] bg-[#0066ff]/5 text-[#0066ff] font-medium'
                      : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                  }`}
                >
                  脚本
                </button>
              </div>
            </div>

            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                名称 *
              </label>
              <input
                type="text"
                required
                value={isComposing.name ? compositionValues.name : formData.name}
                onChange={handleNameChange}
                onCompositionStart={() => setIsComposing({ ...isComposing, name: true })}
                onCompositionEnd={handleNameCompositionEnd}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>

            {/* Alias */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                别名（用于 Win+R 快速启动）*
              </label>
              <input
                type="text"
                required
                value={isComposing.alias ? compositionValues.alias : formData.alias}
                onChange={handleAliasChange}
                onCompositionStart={() => setIsComposing({ ...isComposing, alias: true })}
                onCompositionEnd={handleAliasCompositionEnd}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono"
                placeholder={
                  itemType === 'url'
                    ? '建议用英文，如：google, baidu'
                    : itemType === 'folder'
                      ? '建议用英文，如：downloads, docs'
                      : itemType === 'script'
                        ? '例如：backup, cleanup, deploy'
                        : '例如：chrome, vscode, wechat'
                }
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {itemType === 'url'
                  ? '按 Win+R 输入别名，自动用默认浏览器打开网址（建议使用英文字母）'
                  : itemType === 'folder'
                    ? '按 Win+R 输入别名，自动在资源管理器中打开文件夹（建议使用英文字母）'
                    : itemType === 'script'
                      ? '按 Win+R 输入别名，快速执行脚本（建议使用英文字母）'
                      : '按 Win+R 输入别名，快速启动应用程序（支持中文，但建议用英文）'}
              </p>
            </div>

            {/* Target Path / URL */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {itemType === 'url'
                  ? '网址 *'
                  : itemType === 'folder'
                    ? '文件夹路径 *'
                    : itemType === 'script'
                      ? '脚本 *'
                      : '目标路径 *'}
              </label>

              {/* 脚本类型：输入模式切换 */}
              {itemType === 'script' && (
                <div className="flex gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setScriptInputMode('file')}
                    className={`flex-1 px-3 py-1.5 text-sm rounded border transition-all ${
                      scriptInputMode === 'file'
                        ? 'border-[#0066ff] bg-[#0066ff]/5 text-[#0066ff] font-medium'
                        : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'
                    }`}
                  >
                    📁 文件路径
                  </button>
                  <button
                    type="button"
                    onClick={() => setScriptInputMode('content')}
                    className={`flex-1 px-3 py-1.5 text-sm rounded border transition-all ${
                      scriptInputMode === 'content'
                        ? 'border-[#0066ff] bg-[#0066ff]/5 text-[#0066ff] font-medium'
                        : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'
                    }`}
                  >
                    ✏️ 直接输入
                  </button>
                </div>
              )}

              {/* 脚本内容输入 */}
              {itemType === 'script' && scriptInputMode === 'content' ? (
                <>
                  <div className="flex gap-2 mb-2">
                    <select
                      value={formData.scriptType}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          scriptType: e.target.value as 'bat' | 'ps1' | 'ahk',
                        })
                      }
                      className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="bat">批处理 (.bat)</option>
                      <option value="ps1">PowerShell (.ps1)</option>
                      <option value="ahk">AutoHotkey (.ahk)</option>
                    </select>
                  </div>
                  <textarea
                    required
                    value={formData.scriptContent}
                    onChange={(e) => setFormData({ ...formData, scriptContent: e.target.value })}
                    rows={10}
                    placeholder={
                      formData.scriptType === 'ps1'
                        ? '# PowerShell 脚本\nWrite-Host "Hello World"\npause'
                        : formData.scriptType === 'ahk'
                          ? '; AutoHotkey 脚本\nMsgBox, Hello World!'
                          : '@echo off\necho Hello World\npause'
                    }
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    💡 脚本内容将保存在配置中，执行时自动创建临时文件
                  </p>
                </>
              ) : (
                <>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required={itemType !== 'script' || scriptInputMode === 'file'}
                      value={formData.targetPath}
                      onChange={(e) => setFormData({ ...formData, targetPath: e.target.value })}
                      placeholder={
                        itemType === 'url'
                          ? 'https://example.com'
                          : itemType === 'folder'
                            ? 'C:\\Users\\...'
                            : itemType === 'script'
                              ? 'C:\\Scripts\\example.bat'
                              : 'C:\\Program Files\\...'
                      }
                      className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    {(itemType === 'app' || itemType === 'folder' || itemType === 'script') && (
                      <button
                        type="button"
                        onClick={handleBrowse}
                        className="px-3 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-lg transition-colors"
                      >
                        <FolderOpen size={20} />
                      </button>
                    )}
                  </div>
                  {itemType === 'script' && (
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      支持的脚本类型：.cmd、.bat、.ps1、.ahk
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Arguments + Working Directory - 仅应用程序且无额外配置时显示 */}
            {itemType === 'app' && profiles.length === 0 && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    命令行参数
                  </label>
                  <input
                    type="text"
                    value={formData.arguments}
                    onChange={(e) => setFormData({ ...formData, arguments: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono"
                    placeholder="例如：--incognito"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    工作目录
                  </label>
                  <input
                    type="text"
                    value={formData.workingDir}
                    onChange={(e) => setFormData({ ...formData, workingDir: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </>
            )}

            {/* 脚本参数和工作目录 - 仅脚本类型 */}
            {itemType === 'script' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    脚本参数
                  </label>
                  <input
                    type="text"
                    value={formData.arguments}
                    onChange={(e) => setFormData({ ...formData, arguments: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono"
                    placeholder="例如：arg1 arg2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    工作目录
                  </label>
                  <input
                    type="text"
                    value={formData.workingDir}
                    onChange={(e) => setFormData({ ...formData, workingDir: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="留空则使用脚本所在目录"
                  />
                </div>
              </>
            )}

            {/* 启动配置 - 仅应用程序 */}
            {itemType === 'app' && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    启动配置{profiles.length > 0 ? '' : '（可选）'}
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      if (profiles.length === 0) {
                        // 第一次添加：把当前默认参数移入第一个配置
                        const defaultProfile: LaunchProfile = {
                          name: '默认',
                          alias: formData.alias,
                          arguments: formData.arguments,
                          workingDir: formData.workingDir,
                        };
                        setProfiles([
                          defaultProfile,
                          { name: '', alias: '', arguments: '', workingDir: '' },
                        ]);
                        setFormData({ ...formData, arguments: '', workingDir: '' });
                      } else {
                        setProfiles([
                          ...profiles,
                          { name: '', alias: '', arguments: '', workingDir: '' },
                        ]);
                      }
                    }}
                    className="flex items-center gap-1 text-xs text-[#0066ff] hover:underline"
                  >
                    <Plus size={12} />
                    添加配置
                  </button>
                </div>
                {profiles.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    为同一程序添加不同启动方式，每个配置有独立的 Win+R 别名。
                    <br />
                    例如：chrome → 正常启动，chrome-i → 无痕模式
                  </p>
                ) : (
                  <div className="space-y-3">
                    {profiles.map((profile, index) => (
                      <div
                        key={index}
                        className="p-3 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700/50 space-y-2"
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={profile.name}
                            onChange={(e) => {
                              const updated = [...profiles];
                              updated[index] = { ...updated[index], name: e.target.value };
                              // 自动生成别名建议
                              if (
                                !profile.alias ||
                                profile.alias ===
                                  autoAlias(profiles[index]?.name || '', formData.alias)
                              ) {
                                updated[index].alias = autoAlias(e.target.value, formData.alias);
                              }
                              setProfiles(updated);
                            }}
                            placeholder={index === 0 ? '默认配置' : '配置名称（如：无痕模式）'}
                            className="flex-1 px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-primary-500"
                          />
                          {index === 0 ? (
                            <button
                              type="button"
                              onClick={() => {
                                // 还原默认参数，清空所有配置
                                setFormData({
                                  ...formData,
                                  arguments: profiles[0].arguments || '',
                                  workingDir: profiles[0].workingDir || '',
                                });
                                setProfiles([]);
                              }}
                              className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
                              title="取消多配置模式"
                            >
                              <Trash2 size={14} />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setProfiles(profiles.filter((_, i) => i !== index))}
                              className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400 flex-shrink-0">Win+R:</span>
                          <input
                            type="text"
                            value={profile.alias || ''}
                            onChange={(e) => {
                              const updated = [...profiles];
                              updated[index] = { ...updated[index], alias: e.target.value };
                              setProfiles(updated);
                            }}
                            placeholder={index === 0 ? formData.alias : `${formData.alias}-xxx`}
                            className="flex-1 px-2 py-1.5 text-sm font-mono border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-primary-500"
                          />
                        </div>
                        <input
                          type="text"
                          value={profile.arguments || ''}
                          onChange={(e) => {
                            const updated = [...profiles];
                            updated[index] = { ...updated[index], arguments: e.target.value };
                            setProfiles(updated);
                          }}
                          placeholder="命令行参数（如：--incognito）"
                          className="w-full px-2 py-1.5 text-sm font-mono border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-primary-500"
                        />
                        <input
                          type="text"
                          value={profile.workingDir || ''}
                          onChange={(e) => {
                            const updated = [...profiles];
                            updated[index] = { ...updated[index], workingDir: e.target.value };
                            setProfiles(updated);
                          }}
                          placeholder="工作目录（可选）"
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-primary-500"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Group */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                分组
              </label>
              <select
                value={formData.groupId}
                onChange={(e) => setFormData({ ...formData, groupId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">无分组</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                描述
              </label>
              <textarea
                value={
                  isComposing.description ? compositionValues.description : formData.description
                }
                onChange={handleDescriptionChange}
                onCompositionStart={() => setIsComposing({ ...isComposing, description: true })}
                onCompositionEnd={handleDescriptionCompositionEnd}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>

            {/* Checkboxes */}
            <div className="space-y-2">
              {(itemType === 'app' || itemType === 'script') && (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.runAsAdmin}
                    onChange={(e) => setFormData({ ...formData, runAsAdmin: e.target.checked })}
                    className="w-4 h-4 text-primary-600 rounded focus:ring-2 focus:ring-primary-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">以管理员身份运行</span>
                </label>
              )}
              {itemType === 'script' && (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.scriptShowWindow}
                    onChange={(e) =>
                      setFormData({ ...formData, scriptShowWindow: e.target.checked })
                    }
                    className="w-4 h-4 text-primary-600 rounded focus:ring-2 focus:ring-primary-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    显示执行窗口（推荐勾选，方便查看输出）
                  </span>
                </label>
              )}
              {itemType === 'app' && (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.startupEnabled}
                    onChange={(e) => setFormData({ ...formData, startupEnabled: e.target.checked })}
                    className="w-4 h-4 text-primary-600 rounded focus:ring-2 focus:ring-primary-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">开机启动</span>
                </label>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-primary-400 disabled:cursor-wait text-white rounded-lg transition-colors"
            >
              {isSaving ? '保存中...' : `${itemId ? '更新' : '添加'}项目`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
