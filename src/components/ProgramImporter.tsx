import { useState, useEffect } from 'react';
import { useItemsStore } from '../stores/itemsStore';
import { useGroupsStore } from '../stores/groupsStore';
import { X, Search, Download, Check, Loader2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/tauri';
import { InstalledProgram } from '../types';

interface ProgramImporterProps {
  onClose: () => void;
}

export default function ProgramImporter({ onClose }: ProgramImporterProps) {
  const { addItem, items } = useItemsStore();
  const { groups } = useGroupsStore();
  const [programs, setPrograms] = useState<InstalledProgram[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const [targetGroupId, setTargetGroupId] = useState('');

  // 已存在的路径（用于标记已导入）
  const existingPaths = new Set(items.map((i) => i.targetPath.toLowerCase()));

  useEffect(() => {
    const scan = async () => {
      try {
        const result = await invoke<InstalledProgram[]>('scan_installed_programs');
        setPrograms(result);
      } catch (error) {
        console.error('扫描已安装程序失败:', error);
      } finally {
        setLoading(false);
      }
    };
    scan();
  }, []);

  const filteredPrograms = programs.filter((p) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.targetPath.toLowerCase().includes(q);
  });

  const toggleSelect = (targetPath: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(targetPath)) {
        next.delete(targetPath);
      } else {
        next.add(targetPath);
      }
      return next;
    });
  };

  const selectAll = () => {
    const allPaths = filteredPrograms
      .filter((p) => !existingPaths.has(p.targetPath.toLowerCase()))
      .map((p) => p.targetPath);
    setSelectedPaths(new Set(allPaths));
  };

  const deselectAll = () => {
    setSelectedPaths(new Set());
  };

  const handleImport = async () => {
    if (selectedPaths.size === 0) return;
    setImporting(true);
    let count = 0;

    // 收集已有别名用于去重
    const usedAliases = new Set(items.map((i) => i.alias.toLowerCase()));

    for (const program of programs) {
      if (!selectedPaths.has(program.targetPath)) continue;
      if (existingPaths.has(program.targetPath.toLowerCase())) continue;

      let baseAlias = program.name
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[^a-z0-9]/gi, '')
        .slice(0, 20);

      if (!baseAlias) baseAlias = 'app';

      // 确保别名唯一
      let alias = baseAlias;
      let suffix = 2;
      while (usedAliases.has(alias.toLowerCase())) {
        alias = `${baseAlias}${suffix}`;
        suffix++;
      }
      usedAliases.add(alias.toLowerCase());

      try {
        await addItem({
          name: program.name,
          alias,
          targetPath: program.targetPath,
          itemType: 'app',
          runAsAdmin: false,
          startupEnabled: false,
          groupId: targetGroupId || undefined,
        });
        count++;
      } catch (error) {
        console.error(`导入 ${program.name} 失败:`, error);
      }
    }

    setImportedCount(count);
    setImporting(false);
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">导入已安装程序</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              从开始菜单和桌面扫描已安装的程序
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {importedCount > 0 ? (
          /* 导入完成 */
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4">
              <Check size={32} className="text-green-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">导入完成</h3>
            <p className="text-gray-500 dark:text-gray-400 mb-6">
              已成功导入 {importedCount} 个程序
            </p>
            <button onClick={onClose} className="px-6 py-2 btn-primary rounded-lg">
              完成
            </button>
          </div>
        ) : (
          <>
            {/* 搜索和操作栏 */}
            <div className="px-6 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
              <div className="relative flex-1">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                  size={16}
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索程序..."
                  className="w-full pl-9 pr-4 py-2 text-sm input-field rounded-lg"
                />
              </div>
              <select
                value={targetGroupId}
                onChange={(e) => setTargetGroupId(e.target.value)}
                className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="">导入到：无分组</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    导入到：{g.name}
                  </option>
                ))}
              </select>
              <button
                onClick={selectAll}
                className="text-sm text-[#0066ff] hover:underline whitespace-nowrap"
              >
                全选
              </button>
              <button
                onClick={deselectAll}
                className="text-sm text-gray-500 hover:underline whitespace-nowrap"
              >
                取消全选
              </button>
            </div>

            {/* 程序列表 */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className="animate-spin text-gray-400 mr-3" />
                  <span className="text-gray-500">正在扫描已安装程序...</span>
                </div>
              ) : filteredPrograms.length === 0 ? (
                <div className="flex items-center justify-center py-12 text-gray-400">
                  没有找到程序
                </div>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                  {filteredPrograms.map((program) => {
                    const alreadyExists = existingPaths.has(program.targetPath.toLowerCase());
                    const isSelected = selectedPaths.has(program.targetPath);

                    return (
                      <label
                        key={program.targetPath}
                        className={`flex items-center gap-3 px-6 py-3 cursor-pointer transition-colors ${
                          alreadyExists
                            ? 'opacity-50 cursor-not-allowed'
                            : isSelected
                              ? 'bg-[#0066ff]/5'
                              : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={alreadyExists}
                          onChange={() => !alreadyExists && toggleSelect(program.targetPath)}
                          className="w-4 h-4 text-[#0066ff] rounded"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm text-gray-900 dark:text-white truncate">
                              {program.name}
                            </span>
                            {alreadyExists && (
                              <span className="text-xs px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 rounded">
                                已导入
                              </span>
                            )}
                            <span className="text-xs px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-400 rounded">
                              {program.source === 'registry' ? '已安装' : program.source}
                            </span>
                          </div>
                          <p className="text-xs text-gray-400 truncate mt-0.5">
                            {program.targetPath}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-gray-700">
              <span className="text-sm text-gray-500">
                已选择 {selectedPaths.size} 个程序（共 {programs.length} 个）
              </span>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleImport}
                  disabled={selectedPaths.size === 0 || importing}
                  className="flex items-center gap-2 px-4 py-2 btn-primary rounded-lg disabled:opacity-50"
                >
                  {importing ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Download size={16} />
                  )}
                  导入 {selectedPaths.size > 0 ? `(${selectedPaths.size})` : ''}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
