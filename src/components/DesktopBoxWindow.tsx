import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { message } from '@tauri-apps/api/dialog';
import { invoke } from '@tauri-apps/api/tauri';
import { appWindow, LogicalSize, PhysicalSize } from '@tauri-apps/api/window';
import {
  ChevronDown,
  ChevronUp,
  File as FileIcon,
  GripHorizontal,
  Grid2X2,
  Loader,
  MoreHorizontal,
  Palette,
  Save,
  Table2,
  Trash2,
  X,
} from 'lucide-react';

interface DesktopFence {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  viewMode: 'grid' | 'table';
  sortMode: DesktopBoxSortMode;
  opacity: number;
  backgroundColor: string;
  iconSpacing: number;
  iconVerticalSpacing: number;
  collapsed: boolean;
  hidden: boolean;
  order: number;
}

type DesktopBoxSortMode =
  | 'manual'
  | 'name_asc'
  | 'name_desc'
  | 'modified_desc'
  | 'modified_asc'
  | 'type_asc'
  | 'type_desc';

interface DesktopBoxView {
  layoutId: string;
  fence: DesktopFence;
  icons: DesktopIconAssignment[];
  applyMessage?: string | null;
}

interface DesktopBoxAppearance {
  opacity: number;
  iconSpacing: number;
  iconVerticalSpacing: number;
}

interface DesktopBoxContextMenuResult {
  deleted: boolean;
}

interface DesktopIconAssignment {
  iconId: string;
  label: string;
  path?: string | null;
  shellId?: string | null;
  fenceId: string;
  order: number;
  offsetX?: number | null;
  offsetY?: number | null;
  nativeIndex?: number | null;
  originalPath?: string | null;
  managedFile?: boolean;
}

interface DesktopBoxIconDropRequest {
  sourceBoxId: string;
  iconId: string;
  clientX: number;
  clientY: number;
}

const desktopIconCache = new Map<string, string | null>();
const COLLAPSED_BOX_HEIGHT = 36;
const DESKTOP_BOX_DATA_CHANGED_EVENT = 'desktop-box-data-changed';
const DESKTOP_BOX_APPEARANCE_CHANGED_EVENT = 'desktop-box-appearance-changed';
const DESKTOP_BOX_ICON_DROP_REQUEST_EVENT = 'desktop-box-icon-drop-request';
const DESKTOP_BOX_DROP_ERROR_EVENT = 'desktop-box-drop-error';
type BoxResizeDirection = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

function boxBackgroundColor(color: string, opacity: number) {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color.trim());
  const rgb = match?.[1] || '111827';
  const embeddedAlpha = match?.[2] ? Number.parseInt(match[2], 16) / 255 : 1;
  const alpha = Math.min(1, Math.max(0.1, opacity)) * embeddedAlpha;
  const red = Number.parseInt(rgb.slice(0, 2), 16);
  const green = Number.parseInt(rgb.slice(2, 4), 16);
  const blue = Number.parseInt(rgb.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(3)})`;
}

function clampIconSpacing(value: number) {
  return Math.min(32, Math.max(0, Math.round(value)));
}

const BOX_RESIZE_HANDLES: Array<{
  direction: BoxResizeDirection;
  className: string;
  cursor: string;
}> = [
  { direction: 'n', className: 'left-2 right-2 top-0 h-1', cursor: 'ns-resize' },
  { direction: 'ne', className: 'right-0 top-0 h-3 w-3', cursor: 'nesw-resize' },
  { direction: 'e', className: 'bottom-2 right-0 top-2 w-1', cursor: 'ew-resize' },
  { direction: 'se', className: 'bottom-0 right-0 h-3 w-3', cursor: 'nwse-resize' },
  { direction: 's', className: 'bottom-0 left-2 right-2 h-1', cursor: 'ns-resize' },
  { direction: 'sw', className: 'bottom-0 left-0 h-3 w-3', cursor: 'nesw-resize' },
  { direction: 'w', className: 'bottom-2 left-0 top-2 w-1', cursor: 'ew-resize' },
  { direction: 'nw', className: 'left-0 top-0 h-3 w-3', cursor: 'nwse-resize' },
];

function getBoxId() {
  return appWindow.label.replace(/^desktop-box-/, '');
}

async function revealDesktopBoxWindow(boxId: string) {
  await invoke('desktop_box_window_ready', { boxId });
}

function DesktopSystemIcon({ targetPath, size = 40 }: { targetPath: string; size?: number }) {
  const iconSize = Math.min(256, Math.max(64, Math.ceil(size * window.devicePixelRatio)));
  const cacheKey = `${targetPath}\u0000${iconSize}`;
  const [iconData, setIconData] = useState<string | null>(desktopIconCache.get(cacheKey) ?? null);

  useEffect(() => {
    if (!targetPath) return;
    if (desktopIconCache.has(cacheKey)) {
      setIconData(desktopIconCache.get(cacheKey) ?? null);
      return;
    }
    let cancelled = false;
    invoke<string | null>('extract_icon', { targetPath, iconSize })
      .then((data) => {
        desktopIconCache.set(cacheKey, data);
        if (!cancelled) setIconData(data);
      })
      .catch(() => {
        desktopIconCache.set(cacheKey, null);
        if (!cancelled) setIconData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [cacheKey, iconSize, targetPath]);

  if (!iconData) {
    return <FileIcon size={size} className="text-white drop-shadow" />;
  }

  return <DesktopIconImage data={iconData} size={size} />;
}

function DesktopIconImage({ data, size }: { data: string; size: number }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    try {
      const parsed = JSON.parse(data);
      const width = parsed.width as number;
      const height = parsed.height as number;
      const rgba = Uint8Array.from(atob(parsed.data), (char) => char.charCodeAt(0));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const imageData = ctx.createImageData(width, height);
      imageData.data.set(rgba);
      ctx.putImageData(imageData, 0, 0);
      setSrc(canvas.toDataURL('image/png'));
    } catch {
      setSrc(null);
    }
  }, [data]);

  if (!src) {
    return <FileIcon size={size} className="text-white drop-shadow" />;
  }

  return (
    <img
      src={src}
      alt=""
      className="object-contain drop-shadow"
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
}

function ManagedDesktopIcon({
  item,
  index,
  onOpen,
  onOpenContextMenu,
  onStartDrag,
}: {
  item: DesktopIconAssignment;
  index: number;
  onOpen: () => void;
  onOpenContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onStartDrag: (dataTransfer: DataTransfer) => void;
}) {
  const targetPath = item.shellId || item.path || item.iconId;

  return (
    <button
      type="button"
      title={`${item.label}，右键管理`}
      draggable
      data-box-icon-index={index}
      onDragStart={(event) => onStartDrag(event.dataTransfer)}
      onDoubleClick={onOpen}
      onContextMenu={onOpenContextMenu}
      className="flex h-[82px] w-[86px] flex-col items-center justify-start gap-1 rounded px-1 py-1 text-center outline-none hover:bg-white/20 focus:bg-white/25"
    >
      <DesktopSystemIcon targetPath={targetPath} />
      <span className="line-clamp-2 w-full break-words text-xs leading-tight text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">
        {item.label}
      </span>
    </button>
  );
}

export default function DesktopBoxWindow() {
  const boxId = useMemo(() => getBoxId(), []);
  const [box, setBox] = useState<DesktopBoxView | null>(null);
  const [name, setName] = useState('Box');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const geometryTimer = useRef<number | null>(null);
  const geometrySaving = useRef(false);
  const geometrySaveRequested = useRef(false);
  const geometryEventsEnabled = useRef(false);
  const appearanceTimer = useRef<number | null>(null);
  const appearanceDraft = useRef<{
    opacity: number;
    iconSpacing: number;
    iconVerticalSpacing: number;
  } | null>(null);
  const revealed = useRef(false);
  const mutationVersion = useRef(0);
  const appliedMutationVersion = useRef(0);
  const collapsedIntent = useRef<boolean | null>(null);
  const mutationQueue = useRef<Promise<void>>(Promise.resolve());

  function beginMutation() {
    mutationVersion.current += 1;
    return mutationVersion.current;
  }

  function applyMutation(next: DesktopBoxView, version: number) {
    if (version < appliedMutationVersion.current) return false;
    appliedMutationVersion.current = version;
    setBox(next);
    return true;
  }

  function runMutation<T>(operation: () => Promise<T>) {
    const queued = mutationQueue.current.then(() => operation());
    mutationQueue.current = queued.then(
      () => undefined,
      () => undefined
    );
    return queued;
  }

  async function loadBox() {
    setLoading(true);
    setError(null);
    try {
      const next = await invoke<DesktopBoxView | null>('desktop_box_get', { boxId });
      if (!next) {
        setError('桌面盒子不存在或已被删除。');
        return;
      }
      setBox(next);
      setName(next.fence.name || 'Box');
      await appWindow.setTitle('');
      await appWindow.setMinSize(
        new LogicalSize(160, next.fence.collapsed ? COLLAPSED_BOX_HEIGHT : 120)
      );
    } catch (loadError) {
      setError(String(loadError));
    } finally {
      setLoading(false);
    }
  }

  async function refreshBoxIcons() {
    try {
      const next = await invoke<DesktopBoxView | null>('desktop_box_get', { boxId });
      if (!next) return;
      setBox((current) =>
        current
          ? {
              ...current,
              layoutId: next.layoutId,
              icons: next.icons,
              applyMessage: next.applyMessage,
            }
          : next
      );
    } catch (refreshError) {
      console.error('[DesktopBox] refresh failed', refreshError);
    }
  }

  async function saveName() {
    const trimmed = name.trim() || 'Box';
    const version = beginMutation();
    setName(trimmed);
    try {
      const next = await runMutation(() =>
        invoke<DesktopBoxView>('desktop_box_update_name', {
          boxId,
          name: trimmed,
        })
      );
      if (applyMutation(next, version)) {
        // Box titles are rendered by the web view. Keep the native window
        // title empty so Windows cannot paint a second title above the Box.
        await appWindow.setTitle('');
      }
    } catch (saveError) {
      if (version === mutationVersion.current) {
        setName(box?.fence.name || 'Box');
      }
      await message(`保存盒子名称失败：${saveError}`, { title: '桌面盒子', type: 'error' });
    }
  }

  async function saveGeometry() {
    if (geometrySaving.current) {
      geometrySaveRequested.current = true;
      return;
    }
    geometrySaving.current = true;
    setSaving(true);
    try {
      do {
        geometrySaveRequested.current = false;
        const scaleFactor = await appWindow.scaleFactor();
        await invoke('desktop_box_update_scale_factor', { boxId, scaleFactor });
        await invoke<DesktopBoxView>('desktop_box_persist_geometry', { boxId });
      } while (geometrySaveRequested.current);
    } catch (error) {
      await message(`保存盒子位置失败：${error}`, { title: '桌面盒子', type: 'error' });
    } finally {
      geometrySaving.current = false;
      setSaving(false);
    }
  }

  function scheduleGeometrySave() {
    // Tauri emits moved/resized events while a hidden WebView is attached and
    // its native frame is normalized. Persist only after a real user drag or
    // resize so transient startup coordinates never overwrite the layout.
    if (!geometryEventsEnabled.current) return;
    if (geometryTimer.current != null) {
      window.clearTimeout(geometryTimer.current);
    }
    geometryTimer.current = window.setTimeout(() => {
      geometryTimer.current = null;
      void saveGeometry();
    }, 350);
  }

  async function deleteBox() {
    if (!box) return;
    if (box.icons.length > 0) {
      await message('盒子非空，请先移出图标。', { title: '桌面盒子', type: 'warning' });
      return;
    }
    try {
      await invoke('desktop_box_delete', { boxId });
      await appWindow.close();
    } catch (deleteError) {
      await message(`删除失败：${deleteError}`, { title: '桌面盒子', type: 'error' });
    }
  }

  function openIconContextMenu(
    event: ReactMouseEvent<HTMLButtonElement>,
    item: DesktopIconAssignment
  ) {
    event.preventDefault();
    event.stopPropagation();
    void invoke<DesktopBoxContextMenuResult>('desktop_box_show_context_menu', {
      boxId,
      iconId: item.iconId,
      targetPath: item.shellId || item.path || item.iconId,
      screenX: event.screenX,
      screenY: event.screenY,
    })
      .then((result) => {
        if (result.deleted) {
          void refreshBoxIcons();
        }
      })
      .catch((menuError) => {
        console.error('[DesktopBox] native context menu failed', menuError);
      });
  }

  async function openIcon(item: DesktopIconAssignment) {
    try {
      await invoke('desktop_box_open_icon', { boxId, iconId: item.iconId });
    } catch (openError) {
      await message(`打开桌面项目失败：${openError}`, { title: '桌面盒子', type: 'error' });
    }
  }

  function iconDropIndexAtPoint(clientX: number, clientY: number) {
    const items = Array.from(document.querySelectorAll<HTMLElement>('[data-box-icon-index]'))
      .map((element) => ({
        element,
        index: Number.parseInt(element.dataset.boxIconIndex || '', 10),
        rect: element.getBoundingClientRect(),
      }))
      .filter((item) => Number.isFinite(item.index))
      .sort((left, right) => left.index - right.index);
    if (items.length === 0) return 0;

    const hovered = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>('[data-box-icon-index]');
    if (hovered) {
      const index = Number.parseInt(hovered.dataset.boxIconIndex || '', 10);
      const rect = hovered.getBoundingClientRect();
      const hasSameRowPeer = items.some(
        (item) =>
          item.element !== hovered &&
          item.rect.top < rect.bottom - 2 &&
          item.rect.bottom > rect.top + 2
      );
      const insertAfter = hasSameRowPeer
        ? clientX >= rect.left + rect.width / 2
        : clientY >= rect.top + rect.height / 2;
      return Math.max(0, index + (insertAfter ? 1 : 0));
    }

    for (const item of items) {
      const centerY = item.rect.top + item.rect.height / 2;
      if (clientY < centerY) return item.index;
      const sameRow = clientY >= item.rect.top && clientY <= item.rect.bottom;
      if (sameRow && clientX < item.rect.left + item.rect.width / 2) return item.index;
    }
    return items.length;
  }

  async function placeDraggedIcon(request: DesktopBoxIconDropRequest) {
    try {
      const next = await invoke<DesktopBoxView>('desktop_box_place_icon', {
        sourceBoxId: request.sourceBoxId,
        targetBoxId: boxId,
        iconId: request.iconId,
        targetIndex: iconDropIndexAtPoint(request.clientX, request.clientY),
      });
      setBox(next);
    } catch (dropError) {
      console.error('[DesktopBox] icon placement failed', dropError);
      await message(`移动图标失败：${dropError}`, { title: '桌面盒子', type: 'error' });
    }
  }

  async function toggleCollapsed() {
    if (!box) return;
    const nextCollapsed = !(collapsedIntent.current ?? box.fence.collapsed);
    collapsedIntent.current = nextCollapsed;
    const version = beginMutation();
    try {
      const next = await runMutation(() =>
        invoke<DesktopBoxView>('desktop_box_update_collapsed', {
          boxId,
          collapsed: nextCollapsed,
        })
      );
      if (version < appliedMutationVersion.current) return;
      applyMutation(next, version);
      if (collapsedIntent.current === nextCollapsed) {
        collapsedIntent.current = null;
      }
      if (next.fence.collapsed) {
        const [size, scaleFactor] = await Promise.all([
          appWindow.outerSize(),
          appWindow.scaleFactor(),
        ]);
        await appWindow.setMinSize(new LogicalSize(160, COLLAPSED_BOX_HEIGHT));
        await appWindow.setSize(
          new PhysicalSize(size.width, Math.max(1, Math.round(COLLAPSED_BOX_HEIGHT * scaleFactor)))
        );
      } else {
        await appWindow.setMinSize(new LogicalSize(160, 120));
        await appWindow.setSize(
          new PhysicalSize(next.fence.width, Math.max(120, next.fence.height))
        );
      }
    } catch (toggleError) {
      if (version === mutationVersion.current && collapsedIntent.current === nextCollapsed) {
        collapsedIntent.current = null;
      }
      await message(`更新盒子状态失败：${toggleError}`, { title: '桌面盒子', type: 'error' });
    }
  }

  async function updateViewMode(viewMode: 'grid' | 'table') {
    if (!box || box.fence.viewMode === viewMode) return;
    const version = beginMutation();
    try {
      const next = await runMutation(() =>
        invoke<DesktopBoxView>('desktop_box_update_view_mode', { boxId, viewMode })
      );
      applyMutation(next, version);
    } catch (viewModeError) {
      await message(`切换显示方式失败：${viewModeError}`, { title: '桌面盒子', type: 'error' });
    }
  }

  async function updateSortMode(sortMode: DesktopBoxSortMode) {
    if (!box || box.fence.sortMode === sortMode) {
      setActionsOpen(false);
      return;
    }
    const version = beginMutation();
    try {
      const next = await runMutation(() =>
        invoke<DesktopBoxView>('desktop_box_set_sort_mode', { boxId, sortMode })
      );
      applyMutation(next, version);
      setActionsOpen(false);
    } catch (sortError) {
      await message(`更新图标排序失败：${sortError}`, { title: '桌面盒子', type: 'error' });
    }
  }

  function queueAppearanceUpdate(
    opacity: number,
    iconSpacing: number,
    iconVerticalSpacing: number
  ) {
    if (!box) return;
    const clampedOpacity = Math.min(1, Math.max(0.1, opacity));
    const clampedIconSpacing = clampIconSpacing(iconSpacing);
    const clampedIconVerticalSpacing = clampIconSpacing(iconVerticalSpacing);
    // Apply immediately while the current Box's appearance is persisted.
    setBox((current) =>
      current
        ? {
            ...current,
            fence: {
              ...current.fence,
              opacity: clampedOpacity,
              iconSpacing: clampedIconSpacing,
              iconVerticalSpacing: clampedIconVerticalSpacing,
            },
          }
        : current
    );
    appearanceDraft.current = {
      opacity: clampedOpacity,
      iconSpacing: clampedIconSpacing,
      iconVerticalSpacing: clampedIconVerticalSpacing,
    };
    if (appearanceTimer.current != null) window.clearTimeout(appearanceTimer.current);
    appearanceTimer.current = window.setTimeout(() => {
      appearanceTimer.current = null;
      const draft = appearanceDraft.current;
      if (!draft) return;
      appearanceDraft.current = null;
      const version = beginMutation();
      void runMutation(() =>
        invoke<DesktopBoxView>('desktop_box_update_appearance', {
          boxId,
          opacity: draft.opacity,
          iconSpacing: draft.iconSpacing,
          iconVerticalSpacing: draft.iconVerticalSpacing,
        })
      )
        .then((next) => {
          applyMutation(next, version);
        })
        .catch((appearanceError) =>
          message(`保存当前盒子外观失败：${appearanceError}`, { title: '桌面盒子', type: 'error' })
        );
    }, 180);
  }

  function updateAppearance(opacity: number) {
    if (!box) return;
    queueAppearanceUpdate(opacity, box.fence.iconSpacing, box.fence.iconVerticalSpacing);
  }

  function updateIconSpacing(iconSpacing: number) {
    if (!box) return;
    queueAppearanceUpdate(box.fence.opacity, iconSpacing, box.fence.iconVerticalSpacing);
  }

  function updateIconVerticalSpacing(iconVerticalSpacing: number) {
    if (!box) return;
    queueAppearanceUpdate(box.fence.opacity, box.fence.iconSpacing, iconVerticalSpacing);
  }

  async function assignDroppedPaths(paths: string[]) {
    if (paths.length === 0) return;
    setSaving(true);
    const version = beginMutation();
    try {
      const next = await runMutation(() =>
        invoke<DesktopBoxView>('desktop_box_assign_paths', { boxId, paths })
      );
      applyMutation(next, version);
      if (next.applyMessage?.includes('失败')) {
        await message(next.applyMessage, { title: '桌面盒子', type: 'warning' });
      }
    } catch (error) {
      console.error('[DesktopBox] assign failed', error);
      await message(`加入桌面盒子失败：${error}`, { title: '桌面盒子', type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  function startIconDrag(item: DesktopIconAssignment, dataTransfer: DataTransfer) {
    dataTransfer.effectAllowed = 'move';
    dataTransfer.setData('application/x-mcstartup-box-icon', item.iconId);
    void invoke('desktop_box_start_icon_drag', {
      boxId,
      iconId: item.iconId,
    }).catch((dragError) => {
      console.error('[DesktopBox] drag start failed', dragError);
    });
  }

  useEffect(() => {
    if (loading || !box || revealed.current) return;
    let cancelled = false;
    const reveal = async () => {
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (cancelled) return;
        try {
          await revealDesktopBoxWindow(boxId);
          if (!cancelled) {
            revealed.current = true;
            setError(null);
          }
          return;
        } catch (revealError) {
          lastError = revealError;
          if (cancelled) return;
          await new Promise((resolve) => window.setTimeout(resolve, 150 * (attempt + 1)));
        }
      }
      if (!cancelled) {
        setError((current) => current || `显示桌面盒子失败：${lastError}`);
      }
    };
    void reveal();
    return () => {
      cancelled = true;
    };
  }, [box, boxId, loading]);

  useEffect(() => {
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousHtmlMinWidth = document.documentElement.style.minWidth;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyMinWidth = document.body.style.minWidth;
    const previousRootOverflow = document.getElementById('root')?.style.overflow ?? '';
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.minWidth = '0';
    document.body.style.overflow = 'hidden';
    document.body.style.minWidth = '0';
    const root = document.getElementById('root');
    if (root) {
      root.style.background = 'transparent';
      root.style.overflow = 'hidden';
    }
    void loadBox();

    let disposed = false;
    let unlistenDrop: (() => void) | undefined;
    let unlistenDataChanged: (() => void) | undefined;
    let unlistenAppearanceChanged: (() => void) | undefined;
    let unlistenIconDropRequest: (() => void) | undefined;
    let unlistenDropError: (() => void) | undefined;
    let unlistenMoved: (() => void) | undefined;
    let unlistenResized: (() => void) | undefined;

    appWindow
      .listen<string[]>('tauri://file-drop', (event) => {
        void assignDroppedPaths(event.payload || []);
      })
      .then((fn) => {
        if (disposed) fn();
        else unlistenDrop = fn;
      });
    appWindow
      .listen(DESKTOP_BOX_DATA_CHANGED_EVENT, () => {
        void refreshBoxIcons();
      })
      .then((fn) => {
        if (disposed) fn();
        else unlistenDataChanged = fn;
      });
    appWindow
      .listen<DesktopBoxAppearance>(DESKTOP_BOX_APPEARANCE_CHANGED_EVENT, (event) => {
        const opacity = Math.min(1, Math.max(0.1, event.payload.opacity));
        const iconSpacing = clampIconSpacing(event.payload.iconSpacing);
        const iconVerticalSpacing = clampIconSpacing(event.payload.iconVerticalSpacing);
        setBox((current) =>
          current
            ? {
                ...current,
                fence: { ...current.fence, opacity, iconSpacing, iconVerticalSpacing },
              }
            : current
        );
      })
      .then((fn) => {
        if (disposed) fn();
        else unlistenAppearanceChanged = fn;
      });
    appWindow
      .listen<DesktopBoxIconDropRequest>(DESKTOP_BOX_ICON_DROP_REQUEST_EVENT, (event) => {
        void placeDraggedIcon(event.payload);
      })
      .then((fn) => {
        if (disposed) fn();
        else unlistenIconDropRequest = fn;
      });
    appWindow
      .listen<string>(DESKTOP_BOX_DROP_ERROR_EVENT, (event) => {
        if (event.payload.trim()) {
          void message(event.payload, { title: '桌面盒子', type: 'warning' });
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlistenDropError = fn;
      });
    appWindow
      .onMoved(() => scheduleGeometrySave())
      .then((fn) => {
        if (disposed) fn();
        else unlistenMoved = fn;
      });
    appWindow
      .onResized(() => scheduleGeometrySave())
      .then((fn) => {
        if (disposed) fn();
        else unlistenResized = fn;
      });

    return () => {
      disposed = true;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.documentElement.style.minWidth = previousHtmlMinWidth;
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.minWidth = previousBodyMinWidth;
      if (root) root.style.overflow = previousRootOverflow;
      if (geometryTimer.current != null) {
        window.clearTimeout(geometryTimer.current);
      }
      if (appearanceTimer.current != null) {
        window.clearTimeout(appearanceTimer.current);
      }
      unlistenDrop?.();
      unlistenDataChanged?.();
      unlistenAppearanceChanged?.();
      unlistenIconDropRequest?.();
      unlistenDropError?.();
      unlistenMoved?.();
      unlistenResized?.();
    };
    // Register native window and drop listeners once for this Box window.
    // The handlers intentionally close over the stable box id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const color = box?.fence.color || '#2563eb';
  const visibleIcons = box?.icons || [];
  const iconSpacing = clampIconSpacing(box?.fence.iconSpacing ?? 4);
  const iconVerticalSpacing = clampIconSpacing(box?.fence.iconVerticalSpacing ?? 8);

  function startResize(direction: BoxResizeDirection, event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    geometryEventsEnabled.current = true;
    void invoke('desktop_box_start_resize', { boxId, direction }).catch((resizeError) => {
      void message(`调整桌面盒子大小失败：${resizeError}`, { title: '桌面盒子', type: 'error' });
    });
  }

  async function hideBox() {
    try {
      await saveGeometry();
      await invoke('desktop_box_update_hidden', { boxId, hidden: true });
      await appWindow.hide();
    } catch (hideError) {
      await message(`隐藏桌面盒子失败：${hideError}`, { title: '桌面盒子', type: 'error' });
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-transparent text-blue-500">
        <Loader size={18} className="animate-spin" />
      </div>
    );
  }

  if (error || !box) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-transparent p-3 text-sm text-red-700">
        {error || '桌面盒子不可用'}
      </div>
    );
  }

  return (
    <div
      className="h-screen w-screen select-none overflow-hidden bg-transparent text-white"
      onClick={() => {
        setAppearanceOpen(false);
        setActionsOpen(false);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void invoke('desktop_box_show_context_menu', {
          boxId,
          iconId: null,
          targetPath: null,
          screenX: event.screenX,
          screenY: event.screenY,
        }).catch((menuError) => {
          console.error('[DesktopBox] native context menu failed', menuError);
        });
      }}
    >
      <div
        className="relative flex h-full min-w-0 flex-col overflow-hidden"
        style={{
          backgroundColor: boxBackgroundColor(box.fence.backgroundColor, box.fence.opacity),
          transition: 'background-color 80ms linear',
        }}
      >
        {(box.fence.collapsed
          ? BOX_RESIZE_HANDLES.filter(({ direction }) => direction === 'e' || direction === 'w')
          : BOX_RESIZE_HANDLES
        ).map(({ direction, className, cursor }) => (
          <button
            key={direction}
            type="button"
            aria-label={`从${direction}方向调整盒子大小`}
            className={`pointer-events-auto absolute z-30 m-0 border-0 bg-transparent p-0 outline-none ${className}`}
            style={{ cursor }}
            onMouseDown={(event) => startResize(direction, event)}
          />
        ))}
        <div
          className="relative z-10 flex h-8 min-w-0 items-center gap-1 overflow-visible border-b px-2"
          style={{
            borderColor: color,
            backgroundColor: 'transparent',
          }}
        >
          <div
            className="flex h-full w-5 shrink-0 cursor-move items-center justify-center text-white/65 [filter:drop-shadow(0_1px_1px_rgba(0,0,0,0.8))]"
            onMouseDown={(event) => {
              if (event.button === 0) {
                event.preventDefault();
                geometryEventsEnabled.current = true;
                void invoke('desktop_box_start_drag', { boxId }).catch((dragError) => {
                  void message(`拖动桌面盒子失败：${dragError}`, {
                    title: '桌面盒子',
                    type: 'error',
                  });
                });
              }
            }}
          >
            <GripHorizontal size={15} />
          </div>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => void saveName()}
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              }
            }}
            className="min-w-0 flex-1 bg-transparent px-1 text-center text-sm font-semibold text-white outline-none [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]"
          />
          <div className="desktop-box-header-actions relative z-50 ml-auto flex shrink-0 items-center gap-0.5">
            <div
              className="mr-0.5 flex shrink-0 items-center rounded border border-white/45 bg-black/10 p-0.5"
              role="group"
              aria-label="显示方式"
            >
              <button
                type="button"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  void updateViewMode('grid');
                }}
                className={`pointer-events-auto flex h-5 w-5 shrink-0 items-center justify-center rounded p-0.5 ${box.fence.viewMode === 'grid' ? 'bg-white/90 text-blue-700 shadow-sm' : 'text-white/75 hover:bg-white/20 hover:text-white'}`}
                title="图标视图"
                aria-label="图标视图"
                aria-pressed={box.fence.viewMode === 'grid'}
              >
                <Grid2X2 size={12} />
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  void updateViewMode('table');
                }}
                className={`pointer-events-auto flex h-5 w-5 shrink-0 items-center justify-center rounded p-0.5 ${box.fence.viewMode === 'table' ? 'bg-white/90 text-blue-700 shadow-sm' : 'text-white/75 hover:bg-white/20 hover:text-white'}`}
                title="表格视图"
                aria-label="表格视图"
                aria-pressed={box.fence.viewMode === 'table'}
              >
                <Table2 size={12} />
              </button>
            </div>
            <button
              type="button"
              data-box-action="appearance"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                setActionsOpen(false);
                setAppearanceOpen((open) => !open);
              }}
              className="pointer-events-auto flex h-6 w-6 shrink-0 items-center justify-center rounded p-1 text-white/75 hover:bg-white/20 hover:text-white"
              title="显示与外观"
              aria-label="显示与外观"
              aria-expanded={appearanceOpen}
            >
              <Palette size={13} />
            </button>
            <button
              type="button"
              data-box-action="collapse"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                void toggleCollapsed();
              }}
              className="pointer-events-auto flex h-6 w-6 shrink-0 items-center justify-center rounded p-1 text-white/75 hover:bg-white/20 hover:text-white"
              title={box.fence.collapsed ? '展开盒子' : '折叠盒子'}
              aria-label={box.fence.collapsed ? '展开盒子' : '折叠盒子'}
            >
              {box.fence.collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
            </button>
            <button
              type="button"
              data-box-action="delete"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                void deleteBox();
              }}
              className="pointer-events-auto flex h-6 w-6 shrink-0 items-center justify-center rounded p-1 text-white/75 hover:bg-red-500/20 hover:text-red-200"
              title="删除盒子"
              aria-label="删除盒子"
            >
              <Trash2 size={13} />
            </button>
            <button
              type="button"
              data-box-action="more"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                setAppearanceOpen(false);
                setActionsOpen((open) => !open);
              }}
              className="pointer-events-auto flex h-6 w-6 shrink-0 items-center justify-center rounded p-1 text-white/75 hover:bg-white/20 hover:text-white"
              title="更多操作"
              aria-label="更多操作"
              aria-expanded={actionsOpen}
            >
              <MoreHorizontal size={14} />
            </button>
          </div>
        </div>
        <div
          className={`desktop-box-scroll min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden ${box.fence.collapsed ? 'hidden' : ''}`}
        >
          {visibleIcons.length > 0 && box.fence.viewMode === 'grid' && (
            <div
              className="grid content-start p-3 [grid-template-columns:repeat(auto-fill,86px)] [grid-auto-rows:82px]"
              style={{ columnGap: `${iconSpacing}px`, rowGap: `${iconVerticalSpacing}px` }}
            >
              {visibleIcons.map((item, index) => (
                <ManagedDesktopIcon
                  key={`${item.iconId}-${item.order}`}
                  item={item}
                  index={index}
                  onOpen={() => void openIcon(item)}
                  onOpenContextMenu={(event) => openIconContextMenu(event, item)}
                  onStartDrag={(dataTransfer) => startIconDrag(item, dataTransfer)}
                />
              ))}
            </div>
          )}
          {visibleIcons.length > 0 && box.fence.viewMode === 'table' && (
            <div
              className="grid content-start p-2 text-xs"
              style={{
                gridTemplateColumns: 'repeat(auto-fill, minmax(min(210px, 100%), 1fr))',
                columnGap: `${iconSpacing}px`,
                rowGap: `${iconVerticalSpacing}px`,
              }}
            >
              {visibleIcons.map((item, index) => (
                <button
                  type="button"
                  key={`${item.iconId}-${item.order}`}
                  draggable
                  data-box-icon-index={index}
                  onDragStart={(event) => startIconDrag(item, event.dataTransfer)}
                  onDoubleClick={() => void openIcon(item)}
                  onContextMenu={(event) => openIconContextMenu(event, item)}
                  className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] items-center gap-2 border-b border-white/20 px-1 py-1.5 text-left text-white outline-none hover:bg-white/15 focus:bg-white/20"
                  title={`${item.label}，双击打开`}
                >
                  <div className="flex h-7 w-8 items-center justify-center overflow-hidden">
                    <DesktopSystemIcon
                      targetPath={item.shellId || item.path || item.iconId}
                      size={24}
                    />
                  </div>
                  <span className="min-w-0 truncate">{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {actionsOpen && (
        <div
          className="fixed right-2 top-9 z-40 w-48 overflow-hidden rounded-md border border-gray-200 bg-white py-1 text-sm text-gray-700 shadow-xl dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
          onClick={(event) => event.stopPropagation()}
        >
          <label className="mb-1 block border-b border-gray-200 px-3 pb-2 pt-1.5 text-xs dark:border-gray-700">
            <span className="mb-1 block font-medium text-gray-500 dark:text-gray-400">
              图标排序
            </span>
            <select
              value={box.fence.sortMode}
              onChange={(event) => void updateSortMode(event.target.value as DesktopBoxSortMode)}
              className="w-full border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 outline-none focus:border-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            >
              <option value="manual">手动排列</option>
              <option value="name_asc">名称 A-Z</option>
              <option value="name_desc">名称 Z-A</option>
              <option value="modified_desc">修改时间，最新</option>
              <option value="modified_asc">修改时间，最早</option>
              <option value="type_asc">文件类型 A-Z</option>
              <option value="type_desc">文件类型 Z-A</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              setActionsOpen(false);
              void saveGeometry();
            }}
            disabled={saving}
            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-800"
          >
            {saving ? <Loader size={14} className="animate-spin" /> : <Save size={14} />}
            保存位置
          </button>
          <button
            type="button"
            onClick={() => {
              setActionsOpen(false);
              void hideBox();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X size={14} />
            隐藏
          </button>
        </div>
      )}
      {appearanceOpen && (
        <div
          className="fixed right-2 top-9 z-40 w-52 rounded-md border border-gray-200 bg-white p-3 text-xs text-gray-700 shadow-xl dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
          onClick={(event) => event.stopPropagation()}
        >
          <label className="block">
            <span className="mb-1 flex items-center justify-between">
              <span>当前 BOX 不透明度</span>
              <span>{Math.round(box.fence.opacity * 100)}%</span>
            </span>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.01"
              value={box.fence.opacity}
              onChange={(event) => updateAppearance(Number(event.target.value))}
              className="w-full accent-blue-600"
            />
          </label>
          <label className="mt-3 block">
            <span className="mb-1 flex items-center justify-between">
              <span>当前 BOX 左右间距</span>
              <span>{iconSpacing}px</span>
            </span>
            <input
              type="range"
              min="0"
              max="32"
              step="1"
              value={iconSpacing}
              onChange={(event) => updateIconSpacing(Number(event.target.value))}
              className="w-full accent-blue-600"
            />
          </label>
          <label className="mt-3 block">
            <span className="mb-1 flex items-center justify-between">
              <span>当前 BOX 上下间距</span>
              <span>{iconVerticalSpacing}px</span>
            </span>
            <input
              type="range"
              min="0"
              max="32"
              step="1"
              value={iconVerticalSpacing}
              onChange={(event) => updateIconVerticalSpacing(Number(event.target.value))}
              className="w-full accent-blue-600"
            />
          </label>
        </div>
      )}
    </div>
  );
}
