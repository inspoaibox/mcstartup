import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  parseTldrawJsonFile,
  serializeTldrawJson,
  Tldraw,
  type Editor,
  type TLComponents,
  type TLEditorSnapshot,
} from 'tldraw';
import 'tldraw/tldraw.css';
import { Download, FilePlus2, Save, Upload } from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { useToolDataStore } from '../stores/toolDataStore';

const TOOL_VERSION = 'mcheng-whiteboard-v2';
const PERSISTENCE_KEY = 'mcheng-whiteboard-main';
const TL_OPTIONS = {
  maxFontsToLoadBeforeRender: 0,
};

function cloneEditorSnapshot(snapshot: unknown): TLEditorSnapshot | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  try {
    return structuredClone(snapshot) as TLEditorSnapshot;
  } catch {
    try {
      return JSON.parse(JSON.stringify(snapshot)) as TLEditorSnapshot;
    } catch {
      return null;
    }
  }
}

function downloadText(content: string, fileName: string, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.readAsText(file);
  });
}

function setCanvasZoom100(editor: Editor) {
  const camera = editor.getCamera();
  if (Math.abs(camera.z - 1) < 0.001) return;
  editor.stopCameraAnimation();
  editor.setCamera({ x: camera.x, y: camera.y, z: 1 }, { immediate: true });
}

const WhiteboardCanvas = memo(function WhiteboardCanvas({
  onMount,
  components,
}: {
  onMount: (editor: Editor) => void;
  components: TLComponents;
}) {
  return (
    <Tldraw
      className="h-full w-full"
      persistenceKey={PERSISTENCE_KEY}
      options={TL_OPTIONS}
      components={components}
      onMount={onMount}
      autoFocus
    />
  );
});

export default function WhiteboardTool() {
  const ready = useToolTheme();
  const { data, loaded, loadData, updateWhiteboardData } = useToolDataStore();
  const editorRef = useRef<Editor | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const loadedSnapshotRef = useRef<TLEditorSnapshot | null>(null);
  const didRestoreLegacySnapshotRef = useRef(false);
  const zoomResetTimerRef = useRef<number | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [message, setMessage] = useState('');
  const debugComponents = useMemo(
    () => ({
      ErrorFallback: ({ error }: { error: unknown }) => {
        console.error('[Whiteboard] tldraw crashed', error);
        return (
          <div className="flex h-full w-full flex-col items-center justify-center bg-red-50 px-8 text-center text-red-700 dark:bg-red-950/30 dark:text-red-200">
            <div className="text-base font-semibold">白板渲染异常</div>
            <div className="mt-2 max-w-2xl text-xs">{String(error)}</div>
          </div>
        );
      },
    }),
    []
  );

  useEffect(() => {
    if (!loaded) void loadData();
  }, [loadData, loaded]);

  useEffect(() => {
    loadedSnapshotRef.current =
      data.whiteboard?.version && data.whiteboard.version !== TOOL_VERSION
        ? cloneEditorSnapshot(data.whiteboard?.snapshot)
        : null;
  }, [data.whiteboard?.snapshot, data.whiteboard?.version]);

  useEffect(() => {
    return () => {
      if (zoomResetTimerRef.current) window.clearTimeout(zoomResetTimerRef.current);
    };
  }, []);

  const scheduleCanvasZoom100 = useCallback((editor: Editor) => {
    setCanvasZoom100(editor);
    window.requestAnimationFrame(() => setCanvasZoom100(editor));
    if (zoomResetTimerRef.current) window.clearTimeout(zoomResetTimerRef.current);
    zoomResetTimerRef.current = window.setTimeout(() => {
      setCanvasZoom100(editor);
      zoomResetTimerRef.current = null;
    }, 120);
  }, []);

  const saveNow = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const snapshot = cloneEditorSnapshot(editor.getSnapshot());
    if (snapshot) {
      loadedSnapshotRef.current = snapshot;
      updateWhiteboardData({
        version: TOOL_VERSION,
        snapshot,
      });
    }
    setSaveState('saved');
    setMessage('白板已保存');
  }, [updateWhiteboardData]);

  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      console.info('[Whiteboard] mounted', {
        shapes: editor.getCurrentPageShapeIds().size,
        persistenceKey: PERSISTENCE_KEY,
      });
      const handleCrash = ({ error }: { error: unknown }) => {
        console.error('[Whiteboard] editor crash event', error);
        setMessage(`白板渲染异常：${String(error)}`);
      };
      editor.on('crash', handleCrash);

      const snapshot = loadedSnapshotRef.current;
      if (snapshot && !didRestoreLegacySnapshotRef.current && editor.getCurrentPageShapeIds().size === 0) {
        try {
          didRestoreLegacySnapshotRef.current = true;
          editor.loadSnapshot(snapshot);
          editor.clearHistory();
          console.info('[Whiteboard] restored legacy snapshot', {
            shapes: editor.getCurrentPageShapeIds().size,
          });
          loadedSnapshotRef.current = null;
          updateWhiteboardData({
            version: TOOL_VERSION,
            snapshot: null,
          });
        } catch (error) {
          setMessage(`加载白板数据失败：${String(error)}`);
          console.error('[Whiteboard] failed to restore legacy snapshot', error);
        }
      }
      scheduleCanvasZoom100(editor);
      setSaveState('saved');
      return () => {
        editor.off('crash', handleCrash);
        console.info('[Whiteboard] unmounted');
      };
    },
    [scheduleCanvasZoom100, updateWhiteboardData]
  );

  const clearBoard = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const ids = editor.getCurrentPageShapeIds();
    if (ids.size) editor.deleteShapes([...ids]);
    scheduleCanvasZoom100(editor);
    setSaveState('saved');
    setMessage('已新建空白白板');
  }, [scheduleCanvasZoom100]);

  const exportTldr = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    const json = await serializeTldrawJson(editor);
    downloadText(json, `whiteboard-${Date.now()}.tldr`, 'application/vnd.tldraw+json');
    setMessage('已导出 tldraw 文件');
  }, []);

  const exportBackup = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    downloadText(
      JSON.stringify({ version: TOOL_VERSION, snapshot: editor.getSnapshot() }, null, 2),
      `whiteboard-backup-${Date.now()}.json`
    );
    setMessage('已导出白板备份');
  }, []);

  const importFile = useCallback(
    async (file: File) => {
      const editor = editorRef.current;
      if (!editor) return;
      try {
        const text = await readFileAsText(file);
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && 'snapshot' in parsed) {
          editor.loadSnapshot(parsed.snapshot);
          editor.clearHistory();
          scheduleCanvasZoom100(editor);
          saveNow();
          setMessage(`已恢复备份：${file.name}`);
          return;
        }
        const result = parseTldrawJsonFile({ json: text, schema: editor.store.schema });
        if (!result.ok) {
          setMessage('导入失败：不是有效的 tldraw 文件');
          return;
        }
        editor.loadSnapshot(result.value.getStoreSnapshot());
        editor.clearHistory();
        scheduleCanvasZoom100(editor);
        saveNow();
        setMessage(`已导入：${file.name}`);
      } catch (error) {
        setMessage(`导入失败：${String(error)}`);
      }
    },
    [saveNow, scheduleCanvasZoom100]
  );

  const handleImportChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) void importFile(file);
    },
    [importFile]
  );

  const saveLabel = saveState === 'saving' ? '保存中' : saveState === 'saved' ? '已保存' : '待编辑';

  if (!ready || !loaded) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50 text-slate-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="✏️"
        title="白板"
        subtitle="基于 tldraw，支持画笔、形状、便签、图片、连线、页面和本地保存"
        actions={
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>{saveLabel}</span>
            <button
              className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              title="保存"
              onClick={saveNow}
            >
              <Save size={15} />
            </button>
          </div>
        }
      />
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
        <button className="flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-gray-700 dark:hover:bg-gray-800" onClick={clearBoard}>
          <FilePlus2 size={15} />
          新建空白
        </button>
        <button className="flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-gray-700 dark:hover:bg-gray-800" onClick={() => fileInputRef.current?.click()}>
          <Upload size={15} />
          导入
        </button>
        <button className="flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-gray-700 dark:hover:bg-gray-800" onClick={exportTldr}>
          <Download size={15} />
          导出 tldraw
        </button>
        <button className="flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-gray-700 dark:hover:bg-gray-800" onClick={exportBackup}>
          <Download size={15} />
          备份 JSON
        </button>
        <input ref={fileInputRef} type="file" accept=".tldr,.json" className="hidden" onChange={handleImportChange} />
        {message && <div className="ml-auto truncate text-xs text-blue-600 dark:text-blue-300">{message}</div>}
      </div>
      <main className="relative min-h-0 flex-1 overflow-hidden">
        <div className="absolute inset-0">
          <WhiteboardCanvas onMount={handleMount} components={debugComponents} />
        </div>
      </main>
    </div>
  );
}
