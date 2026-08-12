/**
 * 区域截图 - 单 canvas 架构，避免双层坐标不一致问题
 */
import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { appWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { save } from '@tauri-apps/api/dialog';
import { Copy, Save, X, Undo2, Square, Circle, ArrowRight, Pen, Type, Grid3x3 } from 'lucide-react';

// ── 类型 ──────────────────────────────────────────────────────────────
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
type Phase = 'loading' | 'selecting' | 'editing';
type Tool = 'rect' | 'ellipse' | 'arrow' | 'pen' | 'text' | 'mosaic';

interface Shape {
  tool: Tool;
  color: string;
  lw: number; // 视觉线宽（CSS px），绘制时乘以 scale
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  points?: { x: number; y: number }[];
  text?: string;
  tx?: number;
  ty?: number;
  mosaicRects?: { x: number; y: number; size: number }[];
}

interface ScrollScreenshotStepResult {
  changed: boolean;
  full_base64: string;
  frame_base64: string;
  stitched_base64: string;
  stitched_height?: number;
  reached_limit?: boolean;
}

interface ScreenInfo {
  index: number;
  width: number;
  height: number;
  x: number;
  y: number;
  is_primary: boolean;
}

interface SelectableWindow {
  hwnd: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const COLORS = [
  '#FF3B30',
  '#FF9500',
  '#FFCC00',
  '#34C759',
  '#007AFF',
  '#5856D6',
  '#FFFFFF',
  '#000000',
];

const logLongCapture = (...args: unknown[]) => {
  console.log('[long-screenshot]', ...args);
};

const MAX_AUTO_LONG_STEPS = 80;
const LONG_CAPTURE_SCROLL_AMOUNT = -1;
const MAX_PENDING_LONG_SCROLL_TICKS = 8;
const MAX_AUTO_LONG_NO_CHANGE_STEPS = 8;

export default function ScreenshotRegion() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const bgImgRef = useRef<HTMLImageElement | null>(null);
  const bgBase64Ref = useRef('');

  // 选区
  const phaseRef = useRef<Phase>('loading');
  const selStartRef = useRef({ x: 0, y: 0 });
  const selRectRef = useRef<Rect>({ x: 0, y: 0, w: 0, h: 0 });

  // 编辑
  const toolRef = useRef<Tool>('rect');
  const colorRef = useRef('#FF3B30');
  const lwRef = useRef(2); // 视觉线宽 CSS px
  const shapesRef = useRef<Shape[]>([]);
  const curShapeRef = useRef<Shape | null>(null);
  const isDrawingRef = useRef(false);
  const copyingRef = useRef(false);
  const textInputRef = useRef<HTMLInputElement>(null);
  // 文字拖拽
  const draggingTextIdxRef = useRef<number>(-1);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  // UI
  const [phase, setPhase] = useState<Phase>('loading');
  const [tool, setTool] = useState<Tool>('rect');
  const [color, setColor] = useState('#FF3B30');
  const [lw, setLw] = useState(2);
  const [toolbarPos, setToolbarPos] = useState({ x: 0, y: 0 });
  const [showText, setShowText] = useState(false);
  const [textPos, setTextPos] = useState({ x: 0, y: 0 }); // CSS px
  const [textVal, setTextVal] = useState('');
  const [shapeCount, setShapeCount] = useState(0); // 跟踪 shapes 数量，驱动撤销按钮状态
  const [isLongMode, setIsLongMode] = useState(false);
  const [longStepBusy, setLongStepBusy] = useState(false);
  const [longPreviewBase64, setLongPreviewBase64] = useState('');
  const [longCaptureDone, setLongCaptureDone] = useState(false);
  const [longAutoCapturing, setLongAutoCapturing] = useState(false);
  const longCaptureDoneRef = useRef(false);
  const longPreviewRef = useRef('');
  const longPreviewScrollRef = useRef<HTMLDivElement>(null);
  const longLastFrameRef = useRef('');
  const longLiveFrameRef = useRef('');
  const longOriginBgRef = useRef('');
  const isLongModeRef = useRef(false);
  const longStepBusyRef = useRef(false);
  const longAutoCapturingRef = useRef(false);
  const pendingLongScrollTicksRef = useRef(0);
  const longScrollThroughBusyRef = useRef(false);
  const selectableWindowsRef = useRef<SelectableWindow[]>([]);
  const autoWindowRectRef = useRef<Rect | null>(null);
  const autoWindowHwndRef = useRef('');
  const dragStartedRef = useRef(false);
  const [autoWindowTitle, setAutoWindowTitle] = useState('');

  useEffect(() => {
    isLongModeRef.current = isLongMode;
    if (!isLongMode) {
      pendingLongScrollTicksRef.current = 0;
      longStepBusyRef.current = false;
      longAutoCapturingRef.current = false;
      setLongAutoCapturing(false);
    }
  }, [isLongMode]);

  useEffect(() => {
    longAutoCapturingRef.current = longAutoCapturing;
  }, [longAutoCapturing]);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');
    const prevHtmlBg = html.style.background;
    const prevBodyBg = body.style.background;
    const prevRootBg = root?.style.background ?? '';

    html.style.background = 'transparent';
    body.style.background = 'transparent';
    if (root) {
      root.style.background = 'transparent';
    }

    return () => {
      html.style.background = prevHtmlBg;
      body.style.background = prevBodyBg;
      if (root) {
        root.style.background = prevRootBg;
      }
    };
  }, []);

  const setPhaseSync = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  const setLongCaptureDoneSync = (done: boolean) => {
    longCaptureDoneRef.current = done;
    setLongCaptureDone(done);
  };

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width || 0, canvas.height || 0);
  }, []);

  const updateToolbarPosition = useCallback(() => {
    const c = canvasRef.current;
    const r = selRectRef.current;
    if (!c || r.w <= 0 || r.h <= 0) return;
    const cr = c.getBoundingClientRect();
    const sx = cr.width / c.width;
    const sy = cr.height / c.height;
    const toolbar = toolbarRef.current;
    const toolbarWidth = toolbar?.offsetWidth || 660;
    const toolbarHeight = toolbar?.offsetHeight || 42;
    const margin = 8;
    const gap = 8;
    const availableRight = Math.max(margin, cr.width - toolbarWidth - margin);
    const availableBottom = Math.max(margin, cr.height - toolbarHeight - margin);
    const selectionLeft = r.x * sx;
    const selectionTop = r.y * sy;
    const selectionWidth = r.w * sx;
    const selectionBottom = (r.y + r.h) * sy;
    const centeredX = selectionLeft + selectionWidth / 2 - toolbarWidth / 2;
    const belowY = selectionBottom + gap;
    const aboveY = selectionTop - toolbarHeight - gap;

    let y = belowY;
    if (belowY + toolbarHeight + margin > cr.height && aboveY >= margin) {
      y = aboveY;
    }

    setToolbarPos({
      x: Math.max(margin, Math.min(centeredX, availableRight)),
      y: Math.max(margin, Math.min(y, availableBottom)),
    });
  }, []);

  // ── 获取 canvas 缩放比（物理px / CSS px）────────────────────────────
  const getScale = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return 1;
    const r = c.getBoundingClientRect();
    return r.width > 0 ? c.width / r.width : 1;
  }, []);

  // ── 坐标转换：CSS px → canvas 物理 px ───────────────────────────────
  const toCanvas = useCallback((clientX: number, clientY: number) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    const scale = c.width / r.width;
    return { x: (clientX - r.left) * scale, y: (clientY - r.top) * scale };
  }, []);

  const loadSelectableWindows = useCallback(async () => {
    try {
      const [windows, screens] = await Promise.all([
        invoke<SelectableWindow[]>('screenshot_get_selectable_windows'),
        invoke<ScreenInfo[]>('screenshot_get_screens_info').catch(() => []),
      ]);
      const canvas = canvasRef.current;
      const primary = screens.find((screen) => screen.is_primary) ?? screens[0];
      const originX = primary?.x ?? 0;
      const originY = primary?.y ?? 0;
      const maxWidth = primary?.width ?? canvas?.width ?? Number.POSITIVE_INFINITY;
      const maxHeight = primary?.height ?? canvas?.height ?? Number.POSITIVE_INFINITY;

      selectableWindowsRef.current = windows
        .map((item) => {
          const left = item.x - originX;
          const top = item.y - originY;
          const right = left + item.width;
          const bottom = top + item.height;
          const clippedLeft = Math.max(0, left);
          const clippedTop = Math.max(0, top);
          const clippedRight = Math.min(maxWidth, right);
          const clippedBottom = Math.min(maxHeight, bottom);

          return {
            ...item,
            x: clippedLeft,
            y: clippedTop,
            width: clippedRight - clippedLeft,
            height: clippedBottom - clippedTop,
          };
        })
        .filter((item) => item.width >= 40 && item.height >= 40);
    } catch (error) {
      console.error('[screenshot-region] failed to load selectable windows', error);
      selectableWindowsRef.current = [];
    }
  }, []);

  const findSelectableWindowAt = useCallback((p: { x: number; y: number }) => {
    return selectableWindowsRef.current.find((item) => {
      return (
        p.x >= item.x &&
        p.x <= item.x + item.width &&
        p.y >= item.y &&
        p.y <= item.y + item.height
      );
    });
  }, []);

  const loadImageFromBase64 = useCallback((base64: string) => {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = `data:image/png;base64,${base64}`;
    });
  }, []);

  // ── 全量重绘 ─────────────────────────────────────────────────────────
  const redraw = useCallback(
    (curShape?: Shape | null) => {
      const c = canvasRef.current;
      const img = bgImgRef.current;
      if (!c || !img) return;
      const ctx = c.getContext('2d')!;
      const scale = getScale();
      const sel = selRectRef.current;

      // 1. 背景
      ctx.drawImage(img, 0, 0, c.width, c.height);

      // 2. 遮罩（选区阶段或编辑阶段都画）
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, c.width, c.height);

      // 3. 选区镂空
      if (sel.w > 0 && sel.h > 0) {
        ctx.clearRect(sel.x, sel.y, sel.w, sel.h);
        const liveFrameBase64 = isLongModeRef.current ? longLiveFrameRef.current : '';
        if (liveFrameBase64) {
          const liveFrame = new Image();
          liveFrame.onload = () => {
            if (!isLongModeRef.current || longLiveFrameRef.current !== liveFrameBase64) return;
            const liveCtx = c.getContext('2d');
            if (!liveCtx) return;
            liveCtx.clearRect(sel.x, sel.y, sel.w, sel.h);
            liveCtx.drawImage(liveFrame, sel.x, sel.y, sel.w, sel.h);
            liveCtx.strokeStyle = '#22c55e';
            liveCtx.lineWidth = 2;
            liveCtx.strokeRect(sel.x, sel.y, sel.w, sel.h);
          };
          liveFrame.src = `data:image/png;base64,${liveFrameBase64}`;
        } else {
          ctx.drawImage(img, sel.x, sel.y, sel.w, sel.h, sel.x, sel.y, sel.w, sel.h);
        }
      }

      // 4. 选区边框（选区阶段显示绿色边框+控制点）
      if (phaseRef.current === 'selecting' && sel.w > 0 && sel.h > 0) {
        ctx.strokeStyle = '#1aad19';
        ctx.lineWidth = 2;
        ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
        const pts = [
          [sel.x, sel.y],
          [sel.x + sel.w / 2, sel.y],
          [sel.x + sel.w, sel.y],
          [sel.x, sel.y + sel.h / 2],
          [sel.x + sel.w, sel.y + sel.h / 2],
          [sel.x, sel.y + sel.h],
          [sel.x + sel.w / 2, sel.y + sel.h],
          [sel.x + sel.w, sel.y + sel.h],
        ];
        ctx.fillStyle = '#1aad19';
        pts.forEach(([px, py]) => {
          ctx.beginPath();
          ctx.arc(px, py, 4, 0, Math.PI * 2);
          ctx.fill();
        });
        const label = `${Math.round(sel.w)} × ${Math.round(sel.h)}`;
        ctx.font = 'bold 13px Arial';
        const lw2 = ctx.measureText(label).width + 12;
        const ly = sel.y > 28 ? sel.y - 26 : sel.y + 4;
        ctx.fillStyle = '#1aad19';
        ctx.beginPath();
        (ctx as any).roundRect?.(sel.x, ly, lw2, 22, 4) ?? ctx.rect(sel.x, ly, lw2, 22);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(label, sel.x + 6, ly + 15);
      }

      // 5. 编辑阶段：在选区内裁剪绘制标注
      if (phaseRef.current === 'editing' && sel.w > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(sel.x, sel.y, sel.w, sel.h);
        ctx.clip();
        const all = curShape ? [...shapesRef.current, curShape] : shapesRef.current;
        all.forEach((s) => drawShape(ctx, s, scale, img));
        ctx.restore();

        // 编辑模式下选区细边框
        ctx.strokeStyle = '#1aad19';
        ctx.lineWidth = 2;
        ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
      }
    },
    [getScale, isLongMode]
  );

  const updateBackgroundKeepingSelection = useCallback(
    async (base64: string) => {
      bgBase64Ref.current = base64;
      const img = await loadImageFromBase64(base64);
      bgImgRef.current = img;
      const c = canvasRef.current!;
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      redraw();
      updateToolbarPosition();
    },
    [loadImageFromBase64, redraw, updateToolbarPosition]
  );

  const applyAutoWindowSelection = useCallback(
    (item: SelectableWindow | undefined) => {
      if (!item) {
        const hadSelection = Boolean(autoWindowRectRef.current || autoWindowHwndRef.current);
        autoWindowRectRef.current = null;
        autoWindowHwndRef.current = '';
        selRectRef.current = { x: 0, y: 0, w: 0, h: 0 };
        setAutoWindowTitle('');
        if (hadSelection) {
          redraw();
        }
        return false;
      }

      const rect = { x: item.x, y: item.y, w: item.width, h: item.height };
      const current = autoWindowRectRef.current;
      if (
        autoWindowHwndRef.current === item.hwnd &&
        current &&
        current.x === rect.x &&
        current.y === rect.y &&
        current.w === rect.w &&
        current.h === rect.h
      ) {
        return true;
      }

      autoWindowRectRef.current = rect;
      autoWindowHwndRef.current = item.hwnd;
      selRectRef.current = rect;
      setAutoWindowTitle(item.title);
      redraw();
      return true;
    },
    [redraw]
  );

  useEffect(() => {
    redraw();
  }, [isLongMode, redraw]);

  useEffect(() => {
    if (!isLongMode) return;
    redraw();
  }, [longPreviewBase64, isLongMode, redraw]);

  useLayoutEffect(() => {
    if (phase !== 'editing' || isLongMode) return;
    updateToolbarPosition();
  }, [phase, isLongMode, tool, color, lw, shapeCount, longStepBusy, updateToolbarPosition]);

  useEffect(() => {
    if (!longPreviewBase64) return;
    window.requestAnimationFrame(() => {
      const preview = longPreviewScrollRef.current;
      if (preview) {
        preview.scrollTop = preview.scrollHeight;
      }
    });
  }, [longPreviewBase64]);

  function drawShape(
    ctx: CanvasRenderingContext2D,
    s: Shape,
    scale: number,
    img: HTMLImageElement
  ) {
    const realLw = s.lw * scale;
    ctx.save();
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = realLw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (s.tool === 'rect' && s.x1 !== undefined) {
      ctx.strokeRect(s.x1, s.y1!, s.x2! - s.x1, s.y2! - s.y1!);
    } else if (s.tool === 'ellipse' && s.x1 !== undefined) {
      const cx = (s.x1 + s.x2!) / 2,
        cy = (s.y1! + s.y2!) / 2;
      const rx = Math.abs(s.x2! - s.x1) / 2,
        ry = Math.abs(s.y2! - s.y1!) / 2;
      if (rx > 0 && ry > 0) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (s.tool === 'arrow' && s.x1 !== undefined) {
      const dx = s.x2! - s.x1,
        dy = s.y2! - s.y1!;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        const angle = Math.atan2(dy, dx);
        const head = Math.max(realLw * 4, 14 * scale);
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1!);
        ctx.lineTo(s.x2!, s.y2!);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(s.x2!, s.y2!);
        ctx.lineTo(
          s.x2! - head * Math.cos(angle - Math.PI / 6),
          s.y2! - head * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
          s.x2! - head * Math.cos(angle + Math.PI / 6),
          s.y2! - head * Math.sin(angle + Math.PI / 6)
        );
        ctx.closePath();
        ctx.fill();
      }
    } else if (s.tool === 'pen' && s.points && s.points.length > 1) {
      ctx.beginPath();
      ctx.moveTo(s.points[0].x, s.points[0].y);
      s.points.forEach((p) => ctx.lineTo(p.x, p.y));
      ctx.stroke();
    } else if (s.tool === 'text' && s.text && s.tx !== undefined) {
      const fs = Math.round(16 * scale);
      ctx.font = `bold ${fs}px Arial`;
      ctx.fillText(s.text, s.tx, s.ty!);
      // 在 text 工具模式下，显示虚线边框提示可拖拽
      if (toolRef.current === 'text') {
        const tw = ctx.measureText(s.text).width;
        ctx.save();
        ctx.strokeStyle = 'rgba(0,122,255,0.6)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(s.tx - 3, s.ty! - fs - 2, tw + 6, fs + 6);
        ctx.restore();
      }
    } else if (s.tool === 'mosaic' && s.mosaicRects) {
      // 马赛克：从原图取对应区域，缩小到 1x1（平均色）再放大，形成像素化效果
      s.mosaicRects.forEach(({ x, y, size }) => {
        const sx = Math.max(0, Math.round(x));
        const sy = Math.max(0, Math.round(y));
        const sw = Math.min(Math.round(size), img.naturalWidth - sx);
        const sh = Math.min(Math.round(size), img.naturalHeight - sy);
        if (sw <= 0 || sh <= 0) return;

        const tmp = document.createElement('canvas');
        tmp.width = 1;
        tmp.height = 1;
        const tc = tmp.getContext('2d')!;
        tc.imageSmoothingEnabled = true;
        tc.drawImage(img, sx, sy, sw, sh, 0, 0, 1, 1);

        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tmp, 0, 0, 1, 1, sx, sy, sw, sh);
        ctx.imageSmoothingEnabled = true;
      });
    }
    ctx.restore();
  }

  // ── 初始化 ────────────────────────────────────────────────────────────
  const initWithBg = useCallback(
    async (base64: string) => {
      const startedAt = performance.now();
      console.log('[screenshot-region][perf] initWithBg received', {
        bytes: base64.length,
      });
      setPhaseSync('loading');
      bgImgRef.current = null;
      clearCanvas();
      bgBase64Ref.current = base64;
      longOriginBgRef.current = '';
      longPreviewRef.current = '';
      longLastFrameRef.current = '';
      longLiveFrameRef.current = '';
      autoWindowRectRef.current = null;
      autoWindowHwndRef.current = '';
      dragStartedRef.current = false;
      setAutoWindowTitle('');
      setLongPreviewBase64('');
      setIsLongMode(false);
      setLongCaptureDoneSync(false);
      shapesRef.current = [];
      setShapeCount(0);
      selRectRef.current = { x: 0, y: 0, w: 0, h: 0 };
      const img = new Image();
      img.onload = async () => {
        const imageLoadedAt = performance.now();
        bgImgRef.current = img;
        const c = canvasRef.current!;
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        redraw();
        setPhaseSync('selecting');
        void loadSelectableWindows();
        await appWindow.show();
        await appWindow.setFocus();
        console.log('[screenshot-region][perf] initWithBg ready', {
          decodeAndDrawMs: Math.round(imageLoadedAt - startedAt),
          totalMs: Math.round(performance.now() - startedAt),
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
      };
      img.src = `data:image/png;base64,${base64}`;
    },
    [clearCanvas, loadSelectableWindows, redraw]
  );

  // 使用 ref 保存最新的 initWithBg，避免 stale closure 问题
  const initWithBgRef = useRef(initWithBg);
  useEffect(() => {
    initWithBgRef.current = initWithBg;
  }, [initWithBg]);

  // 监听截图背景数据事件（只注册一次，用 ref 确保调用最新函数）
  useEffect(() => {
    let cancelled = false;
    const loadPendingBg = async () => {
      try {
        const pendingBg = await invoke<string | null>('screenshot_region_take_pending_bg');
        if (!cancelled && pendingBg) {
          initWithBgRef.current(pendingBg);
        }
      } catch (error) {
        console.error('[screenshot-region] failed to load pending background', error);
      }
    };

    void loadPendingBg();

    const unlistenBg = listen('screenshot-bg-data', () => {
      void loadPendingBg();
    });
    return () => {
      cancelled = true;
      unlistenBg.then((fn) => fn());
    };
  }, []); // 空依赖 = 只执行一次

  // 键盘事件监听（依赖 isLongMode 等 state）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isLongMode) {
          pendingLongScrollTicksRef.current = 0;
          longAutoCapturingRef.current = false;
          setLongAutoCapturing(false);
          longStepBusyRef.current = false;
          setLongStepBusy(false);
          invoke('scroll_screenshot_clear').catch(() => undefined);
          isLongModeRef.current = false;
          setIsLongMode(false);
          setLongCaptureDoneSync(false);
          setLongPreviewBase64('');
          longPreviewRef.current = '';
          longLastFrameRef.current = '';
          longLiveFrameRef.current = '';
          if (longOriginBgRef.current) {
            updateBackgroundKeepingSelection(longOriginBgRef.current);
          } else {
            redraw();
          }
          return;
        }
        if (phaseRef.current === 'editing') {
          shapesRef.current = [];
          selRectRef.current = { x: 0, y: 0, w: 0, h: 0 };
          autoWindowRectRef.current = null;
          autoWindowHwndRef.current = '';
          setAutoWindowTitle('');
          setPhaseSync('selecting');
          setLongCaptureDoneSync(false);
          setLongPreviewBase64('');
          redraw();
        } else {
          appWindow.hide();
        }
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key === 'z' &&
        phaseRef.current === 'editing' &&
        !isLongMode
      ) {
        shapesRef.current = shapesRef.current.slice(0, -1);
        setShapeCount(shapesRef.current.length);
        redraw();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [isLongMode, redraw, updateBackgroundKeepingSelection]);

  // ── 命中检测：找到点击位置的文字 shape ──────────────────────────────
  const findTextAt = (cx: number, cy: number, scale: number): number => {
    const fs = 16 * scale;
    for (let i = shapesRef.current.length - 1; i >= 0; i--) {
      const s = shapesRef.current[i];
      if (s.tool !== 'text' || s.tx === undefined) continue;
      const textW = (s.text?.length || 0) * fs * 0.6 + 20;
      const textH = fs + 8;
      if (cx >= s.tx - 4 && cx <= s.tx + textW && cy >= s.ty! - textH && cy <= s.ty! + 4) {
        return i;
      }
    }
    return -1;
  };

  // ── 选区鼠标事件 ──────────────────────────────────────────────────────
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    if (isLongMode) return;
    if (phaseRef.current === 'selecting') {
      const p = toCanvas(e.clientX, e.clientY);
      selStartRef.current = p;
      dragStartedRef.current = false;
      const item = findSelectableWindowAt(p);
      if (item) {
        applyAutoWindowSelection(item);
      } else {
        selRectRef.current = { x: p.x, y: p.y, w: 0, h: 0 };
        autoWindowRectRef.current = null;
        autoWindowHwndRef.current = '';
        setAutoWindowTitle('');
        redraw();
      }
      return;
    }
    if (phaseRef.current === 'editing') {
      if (toolRef.current === 'text') {
        // 检查是否点击了已有文字，进入拖拽模式
        const p = toCanvas(e.clientX, e.clientY);
        const scale = getScale();
        const hitIdx = findTextAt(p.x, p.y, scale);
        if (hitIdx >= 0) {
          const s = shapesRef.current[hitIdx];
          draggingTextIdxRef.current = hitIdx;
          dragOffsetRef.current = { x: p.x - s.tx!, y: p.y - s.ty! };
          e.stopPropagation();
          return;
        }
        return; // 没有命中，由 onClick 处理创建新文字
      }
      const p = toCanvas(e.clientX, e.clientY);
      isDrawingRef.current = true;
      curShapeRef.current = {
        tool: toolRef.current,
        color: colorRef.current,
        lw: lwRef.current,
        x1: p.x,
        y1: p.y,
        x2: p.x,
        y2: p.y,
        points: toolRef.current === 'pen' ? [p] : undefined,
        mosaicRects: toolRef.current === 'mosaic' ? [] : undefined,
      };
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    e.preventDefault();
    if (isLongMode) return;
    if (phaseRef.current === 'selecting' && e.buttons !== 1) {
      const p = toCanvas(e.clientX, e.clientY);
      const item = findSelectableWindowAt(p);
      applyAutoWindowSelection(item);
      return;
    }
    if (phaseRef.current === 'selecting' && e.buttons === 1) {
      const p = toCanvas(e.clientX, e.clientY);
      const s = selStartRef.current;
      dragStartedRef.current = Math.abs(p.x - s.x) > 3 || Math.abs(p.y - s.y) > 3;
      if (!dragStartedRef.current && autoWindowRectRef.current) {
        return;
      }
      autoWindowRectRef.current = null;
      autoWindowHwndRef.current = '';
      setAutoWindowTitle('');
      selRectRef.current = {
        x: Math.min(s.x, p.x),
        y: Math.min(s.y, p.y),
        w: Math.abs(p.x - s.x),
        h: Math.abs(p.y - s.y),
      };
      redraw();
      return;
    }
    // 文字拖拽
    if (phaseRef.current === 'editing' && draggingTextIdxRef.current >= 0 && e.buttons === 1) {
      const p = toCanvas(e.clientX, e.clientY);
      const s = shapesRef.current[draggingTextIdxRef.current];
      s.tx = p.x - dragOffsetRef.current.x;
      s.ty = p.y - dragOffsetRef.current.y;
      redraw();
      return;
    }
    if (phaseRef.current === 'editing' && isDrawingRef.current && curShapeRef.current) {
      const p = toCanvas(e.clientX, e.clientY);
      const s = curShapeRef.current;
      if (s.tool === 'pen') {
        s.points!.push(p);
      } else if (s.tool === 'mosaic') {
        const scale = getScale();
        const size = Math.max(8, lwRef.current * 8 * scale);
        // 在上一个点和当前点之间插值，填充所有经过的格子，确保连贯
        const last = s.mosaicRects![s.mosaicRects!.length - 1];
        const prevX = last ? last.x + size / 2 : p.x;
        const prevY = last ? last.y + size / 2 : p.y;
        const dx = p.x - prevX,
          dy = p.y - prevY;
        const steps = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) / (size / 2)));
        for (let i = 0; i <= steps; i++) {
          const ix = prevX + (dx * i) / steps;
          const iy = prevY + (dy * i) / steps;
          const gx = Math.floor(ix / size) * size;
          const gy = Math.floor(iy / size) * size;
          const prev = s.mosaicRects![s.mosaicRects!.length - 1];
          if (!prev || prev.x !== gx || prev.y !== gy) {
            s.mosaicRects!.push({ x: gx, y: gy, size });
          }
        }
      } else {
        s.x2 = p.x;
        s.y2 = p.y;
      }
      redraw(s);
    }
  };

  const onMouseUp = (_e: React.MouseEvent) => {
    _e.preventDefault();
    if (isLongMode) return;
    // 结束文字拖拽
    if (draggingTextIdxRef.current >= 0) {
      draggingTextIdxRef.current = -1;
      redraw();
      return;
    }
    if (phaseRef.current === 'selecting') {
      const r = selRectRef.current;
      if (!dragStartedRef.current && autoWindowRectRef.current) {
        selRectRef.current = autoWindowRectRef.current;
        autoWindowRectRef.current = null;
        autoWindowHwndRef.current = '';
        setAutoWindowTitle('');
        setPhaseSync('editing');
        redraw();
        updateToolbarPosition();
        return;
      }
      if (r.w < 5 || r.h < 5) {
        selRectRef.current = { x: 0, y: 0, w: 0, h: 0 };
        autoWindowRectRef.current = null;
        autoWindowHwndRef.current = '';
        setAutoWindowTitle('');
        redraw();
        return;
      }
      autoWindowRectRef.current = null;
      autoWindowHwndRef.current = '';
      setAutoWindowTitle('');
      setPhaseSync('editing');
      redraw();
      updateToolbarPosition();
      return;
    }
    if (phaseRef.current === 'editing' && isDrawingRef.current) {
      isDrawingRef.current = false;
      if (curShapeRef.current) {
        shapesRef.current.push(curShapeRef.current);
        curShapeRef.current = null;
        setShapeCount(shapesRef.current.length);
        redraw();
      }
    }
  };

  const onClick = (e: React.MouseEvent) => {
    if (isLongMode) return;
    if (phaseRef.current !== 'editing' || toolRef.current !== 'text') return;
    // 如果正在拖拽文字，不创建新文字
    if (draggingTextIdxRef.current >= 0) return;
    const p = toCanvas(e.clientX, e.clientY);
    const c = canvasRef.current!;
    const cr = c.getBoundingClientRect();
    const scale = c.width / cr.width;
    // 检查是否点击了已有文字（命中检测）
    const hitIdx = findTextAt(p.x, p.y, scale);
    if (hitIdx >= 0) return; // 已有文字由 mousedown 处理拖拽，不创建新文字
    setTextPos({ x: e.clientX - cr.left + cr.left, y: e.clientY - cr.top + cr.top });
    setTextVal('');
    setShowText(true);
    curShapeRef.current = {
      tool: 'text',
      color: colorRef.current,
      lw: lwRef.current,
      tx: p.x,
      ty: p.y + 16 * scale,
    };
    setTimeout(() => textInputRef.current?.focus(), 30);
  };

  const commitText = () => {
    if (curShapeRef.current && textVal.trim()) {
      curShapeRef.current.text = textVal;
      shapesRef.current.push(curShapeRef.current);
      setShapeCount(shapesRef.current.length);
      redraw();
    }
    curShapeRef.current = null;
    setShowText(false);
    setTextVal('');
  };

  // ── 导出 ─────────────────────────────────────────────────────────────
  const getExport = (): string => {
    if (longCaptureDoneRef.current && longPreviewRef.current) {
      return longPreviewRef.current;
    }
    const r = selRectRef.current;
    const img = bgImgRef.current!;
    const scale = getScale();
    const tmp = document.createElement('canvas');
    tmp.width = Math.round(r.w);
    tmp.height = Math.round(r.h);
    const ctx = tmp.getContext('2d')!;
    ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    // 重绘标注到导出 canvas（坐标偏移选区原点）
    ctx.save();
    ctx.translate(-r.x, -r.y);
    shapesRef.current.forEach((s) => drawShape(ctx, s, scale, img));
    ctx.restore();
    return tmp.toDataURL('image/png').replace('data:image/png;base64,', '');
  };

  const copyDirect = async () => {
    if (copyingRef.current) return;
    copyingRef.current = true;
    try {
      const b64 = getExport();
      const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } catch (e) {
      console.error(e);
    } finally {
      await appWindow.hide();
      copyingRef.current = false;
    }
  };

  const saveDirect = async () => {
    try {
      const b64 = getExport();
      const dir = await invoke<string>('screenshot_get_default_dir');
      const name = await invoke<string>('screenshot_generate_filename');
      const path = await save({
        defaultPath: `${dir}/${name}`,
        filters: [{ name: 'PNG', extensions: ['png'] }],
      });
      if (path) {
        await invoke('screenshot_save_file', { base64Data: b64, filePath: path });
        await appWindow.hide();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (isLongMode || phaseRef.current !== 'editing') return;
    const r = selRectRef.current;
    if (r.w <= 0 || r.h <= 0) return;
    e.preventDefault();
    e.stopPropagation();
    void copyDirect();
  };

  const reselect = () => {
    shapesRef.current = [];
    selRectRef.current = { x: 0, y: 0, w: 0, h: 0 };
    autoWindowRectRef.current = null;
    autoWindowHwndRef.current = '';
    setAutoWindowTitle('');
    setIsLongMode(false);
    setLongCaptureDoneSync(false);
    setLongPreviewBase64('');
    longPreviewRef.current = '';
    longLastFrameRef.current = '';
    longLiveFrameRef.current = '';
    longOriginBgRef.current = '';
    setPhaseSync('selecting');
    redraw();
    setShowText(false);
  };

  const undo = () => {
    shapesRef.current = shapesRef.current.slice(0, -1);
    setShapeCount(shapesRef.current.length);
    redraw();
  };

  const selectTool = (t: Tool) => {
    toolRef.current = t;
    setTool(t);
    setShowText(false);
  };
  const selectColor = (c: string) => {
    colorRef.current = c;
    setColor(c);
  };
  const selectLw = (w: number) => {
    lwRef.current = w;
    setLw(w);
  };

  const startLongCaptureMode = async () => {
    if (longStepBusyRef.current) return;
    const r = selRectRef.current;
    if (r.w <= 0 || r.h <= 0) return;
    logLongCapture('start requested', {
      rect: {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.w),
        height: Math.round(r.h),
      },
    });

    if (shapeCount > 0) {
      const confirmed = window.confirm('进入长截图会清空当前标注，是否继续？');
      if (!confirmed) return;
      shapesRef.current = [];
      setShapeCount(0);
      redraw();
    }

    longStepBusyRef.current = true;
    setLongStepBusy(true);

    try {
      longOriginBgRef.current = bgBase64Ref.current;
      const liveInitialFrame = await invoke<string>('scroll_screenshot_init', {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.w),
        height: Math.round(r.h),
        initialFrameBase64: '',
      });
      logLongCapture('init success', {
        previewBytes: liveInitialFrame.length,
      });
      longPreviewRef.current = liveInitialFrame;
      longLastFrameRef.current = liveInitialFrame;
      longLiveFrameRef.current = liveInitialFrame;
      setLongPreviewBase64(liveInitialFrame);
      setLongCaptureDoneSync(false);
      isLongModeRef.current = true;
      setIsLongMode(true);
    } catch (error) {
      logLongCapture('init failed', error);
      console.error('长截图失败:', error);
      alert(`长截图失败: ${error}`);
    } finally {
      longStepBusyRef.current = false;
      setLongStepBusy(false);
    }
  };

  const finishLongCapture = async () => {
    pendingLongScrollTicksRef.current = 0;
    longAutoCapturingRef.current = false;
    setLongAutoCapturing(false);
    const exported = await invoke<string>('scroll_screenshot_export').catch(
      () => longPreviewRef.current
    );
    if (!exported) return;
    longPreviewRef.current = exported;
    setLongPreviewBase64(exported);
    await invoke('scroll_screenshot_clear').catch(() => undefined);
    isLongModeRef.current = false;
    setIsLongMode(false);
    setLongCaptureDoneSync(true);
    clearCanvas();
    setPhaseSync('editing');
    await appWindow.show();
    await appWindow.setFocus();
  };

  const cancelLongCapture = async () => {
    pendingLongScrollTicksRef.current = 0;
    longAutoCapturingRef.current = false;
    setLongAutoCapturing(false);
    longStepBusyRef.current = false;
    setLongStepBusy(false);
    await invoke('scroll_screenshot_clear').catch(() => undefined);
    isLongModeRef.current = false;
    setIsLongMode(false);
    setLongCaptureDoneSync(false);
    setLongPreviewBase64('');
    longPreviewRef.current = '';
    longLastFrameRef.current = '';
    longLiveFrameRef.current = '';
    if (longOriginBgRef.current) {
      await updateBackgroundKeepingSelection(longOriginBgRef.current);
    } else {
      redraw();
    }
  };

  const captureLongStep = useCallback(async (scrollAmount: number) => {
    const r = selRectRef.current;
    if (!r || r.w <= 0 || r.h <= 0) return false;

    const focusX = Math.round(r.x + r.w / 2);
    const focusY = Math.round(r.y + r.h / 2);
    logLongCapture('step invoke', { focusX, focusY });

    const result = await invoke<ScrollScreenshotStepResult>('scroll_screenshot_step', {
      focusX,
      focusY,
      scrollAmount,
    });

    if (!isLongModeRef.current) return false;

    logLongCapture('step result', {
      changed: result.changed,
      stitchedBytes: result.stitched_base64?.length ?? 0,
      fullBytes: result.full_base64?.length ?? 0,
      frameBytes: result.frame_base64?.length ?? 0,
      stitchedHeight: result.stitched_height,
      reachedLimit: result.reached_limit,
    });

    if (result.reached_limit) {
      longAutoCapturingRef.current = false;
      setLongAutoCapturing(false);
    }

    if (result.full_base64) {
      await updateBackgroundKeepingSelection(result.full_base64);
    }
    if (result.frame_base64) {
      longLiveFrameRef.current = result.frame_base64;
      redraw();
    }
    if (result.changed) {
      longPreviewRef.current = result.stitched_base64;
      setLongPreviewBase64(result.stitched_base64);
    } else if (result.stitched_base64 && result.stitched_base64 !== longPreviewRef.current) {
      longPreviewRef.current = result.stitched_base64;
      setLongPreviewBase64(result.stitched_base64);
    }

    return result.changed;
  }, [updateBackgroundKeepingSelection]);

  const scrollLongTargetThrough = useCallback(async (scrollAmount: number) => {
    const r = selRectRef.current;
    if (!r || r.w <= 0 || r.h <= 0) return false;

    const focusX = Math.round(r.x + r.w / 2);
    const focusY = Math.round(r.y + r.h / 2);

    if (longScrollThroughBusyRef.current) return false;
    longScrollThroughBusyRef.current = true;
    try {
      await invoke('scroll_screenshot_scroll_through', {
        focusX,
        focusY,
        scrollAmount,
      });
      return true;
    } catch (error) {
      logLongCapture('scroll through failed', error);
      return false;
    } finally {
      longScrollThroughBusyRef.current = false;
    }
  }, []);

  const startAutoLongCapture = useCallback(async () => {
    if (longStepBusyRef.current || longAutoCapturingRef.current || !isLongModeRef.current) return;

    longAutoCapturingRef.current = true;
    setLongAutoCapturing(true);
    longStepBusyRef.current = true;
    setLongStepBusy(true);
    pendingLongScrollTicksRef.current = 0;

    let stepCount = 0;
    let noChangeCount = 0;

    try {
      while (
        isLongModeRef.current &&
        longAutoCapturingRef.current &&
        stepCount < MAX_AUTO_LONG_STEPS
      ) {
        stepCount += 1;
        const changed = await captureLongStep(LONG_CAPTURE_SCROLL_AMOUNT);
        noChangeCount = changed ? 0 : noChangeCount + 1;
        if (noChangeCount >= MAX_AUTO_LONG_NO_CHANGE_STEPS) {
          longAutoCapturingRef.current = false;
          setLongAutoCapturing(false);
          break;
        }
      }
      logLongCapture('auto capture stopped', {
        stepCount,
        noChangeCount,
        isLongMode: isLongModeRef.current,
      });
    } catch (error) {
      logLongCapture('auto capture failed', error);
      console.error('自动长截图失败:', error);
    } finally {
      longAutoCapturingRef.current = false;
      setLongAutoCapturing(false);
      longStepBusyRef.current = false;
      setLongStepBusy(false);
    }
  }, [captureLongStep]);

  const processLongScrollQueue = useCallback(async () => {
    if (longStepBusyRef.current || longAutoCapturingRef.current || !isLongModeRef.current) {
      logLongCapture('queue skip', {
        busy: longStepBusyRef.current,
        autoCapturing: longAutoCapturingRef.current,
        isLongMode: isLongModeRef.current,
        pending: pendingLongScrollTicksRef.current,
      });
      return;
    }

    longStepBusyRef.current = true;
    setLongStepBusy(true);
    logLongCapture('queue start', {
      pending: pendingLongScrollTicksRef.current,
    });

    try {
      while (isLongModeRef.current && pendingLongScrollTicksRef.current > 0) {
        pendingLongScrollTicksRef.current -= 1;

        const scrolled = await scrollLongTargetThrough(LONG_CAPTURE_SCROLL_AMOUNT);
        if (!scrolled || !isLongModeRef.current) {
          continue;
        }
        const changed = await captureLongStep(0);
        if (!changed && isLongModeRef.current) {
          await new Promise((resolve) => window.setTimeout(resolve, 160));
          await captureLongStep(0);
        }
      }
    } catch (error) {
      logLongCapture('queue failed', error);
      console.error('长截图滚动失败:', error);
    } finally {
      longStepBusyRef.current = false;
      setLongStepBusy(false);
      logLongCapture('queue end', {
        pending: pendingLongScrollTicksRef.current,
        isLongMode: isLongModeRef.current,
      });
      if (isLongModeRef.current && pendingLongScrollTicksRef.current > 0) {
        window.setTimeout(() => {
          void processLongScrollQueue();
        }, 0);
      }
    }
  }, [captureLongStep, scrollLongTargetThrough]);

  // 长截图滚轮处理（绑定到 canvas，始终存在）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      if (!isLongModeRef.current) return;
      e.preventDefault();
      if (e.deltaY <= 0) return;
      const r = selRectRef.current;
      if (!r || r.w <= 0 || r.h <= 0) return;

      const ticks = 1;
      pendingLongScrollTicksRef.current = Math.min(
        pendingLongScrollTicksRef.current + ticks,
        MAX_PENDING_LONG_SCROLL_TICKS
      );
      logLongCapture('wheel', {
        deltaY: e.deltaY,
        ticks,
        pending: pendingLongScrollTicksRef.current,
        busy: longStepBusyRef.current,
      });
      void processLongScrollQueue();
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [processLongScrollQueue]);

  const cursor = isLongMode
    ? longStepBusy
      ? 'progress'
      : 'default'
    : phase === 'selecting'
      ? 'crosshair'
      : draggingTextIdxRef.current >= 0
        ? 'grabbing'
        : tool === 'text'
          ? 'text'
          : phase === 'editing'
            ? 'crosshair'
            : 'default';
  const longRect = selRectRef.current;

  return (
    <div className="fixed inset-0 overflow-hidden select-none">
      {phase === 'loading' && !longCaptureDone && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
          <span className="text-white text-sm">正在截图...</span>
        </div>
      )}

      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ display: phase === 'loading' && !longCaptureDone ? 'none' : 'block', cursor }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
      />

      {isLongMode && (
        <div
          className="absolute inset-0 z-10 pointer-events-none"
        >
          <div
            className="absolute rounded-sm pointer-events-none"
            style={{
              left: longRect.x,
              top: longRect.y,
              width: longRect.w,
              height: longRect.h,
              outline: '2px solid #22c55e',
              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.08)',
            }}
          />
        </div>
      )}

      {/* 文字输入 */}
      {showText && (
        <input
          ref={textInputRef}
          value={textVal}
          onChange={(e) => setTextVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitText();
            if (e.key === 'Escape') {
              setShowText(false);
              curShapeRef.current = null;
            }
          }}
          onBlur={commitText}
          className="absolute z-50 bg-transparent border-b-2 outline-none text-xl font-bold min-w-[80px]"
          style={{ left: textPos.x, top: textPos.y, color, borderColor: color, caretColor: color }}
          placeholder="输入文字..."
        />
      )}

      {/* 选区提示 */}
      {phase === 'selecting' && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/75 text-white px-4 py-2 rounded-lg text-sm pointer-events-none">
          {autoWindowTitle
            ? `已识别窗口：${autoWindowTitle} · 单击选中 · 拖动框选`
            : '移动鼠标自动识别窗口 · 单击选中 · 拖动框选 · ESC 取消'}
        </div>
      )}

      {isLongMode && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/80 text-white px-4 py-2 rounded-lg text-sm pointer-events-none z-50">
          选区已固定，可自动连续采集，也可滚动鼠标手动追加 · 点击完成结束
        </div>
      )}

      {/* 长截图右侧预览 */}
      {(isLongMode || longCaptureDone) && longPreviewBase64 && (
        <div className="absolute z-50 top-6 right-6 w-[300px] h-[72vh] bg-white/96 backdrop-blur-sm rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-gray-800">长截图预览</div>
              <div className="text-xs text-gray-500">
                {isLongMode ? '自动采集或滚动页面时会实时追加到这里' : '长截图已完成，可直接保存或复制'}
              </div>
            </div>
            {isLongMode ? (
              <div className="text-xs text-emerald-600 font-medium">
                {longAutoCapturing ? '自动采集' : longStepBusy ? '更新中' : '待采集'}
              </div>
            ) : (
              <div className="text-xs text-blue-600 font-medium">已完成</div>
            )}
          </div>

          <div ref={longPreviewScrollRef} className="flex-1 bg-gray-50 overflow-auto p-3">
            <img
              src={`data:image/png;base64,${longPreviewBase64}`}
              alt="Long screenshot preview"
              className="w-full h-auto rounded-lg shadow-sm"
            />
          </div>

          <div className="px-3 py-3 border-t border-gray-200 flex items-center gap-2">
            {isLongMode ? (
              <>
                <button
                  onClick={cancelLongCapture}
                  className="flex-1 whitespace-nowrap px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    if (longAutoCapturingRef.current) {
                      longAutoCapturingRef.current = false;
                      setLongAutoCapturing(false);
                    } else {
                      void startAutoLongCapture();
                    }
                  }}
                  disabled={longStepBusy && !longAutoCapturing}
                  className="flex-1 whitespace-nowrap px-3 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 disabled:opacity-60 text-white text-sm font-medium transition-colors"
                >
                  {longAutoCapturing ? '停止' : '自动采集'}
                </button>
                <button
                  onClick={finishLongCapture}
                  disabled={longStepBusy}
                  className="flex-1 whitespace-nowrap px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-white text-sm font-medium transition-colors"
                >
                  完成
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={reselect}
                  className="flex-1 whitespace-nowrap px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium transition-colors"
                >
                  重新截图
                </button>
                <button
                  onClick={saveDirect}
                  className="flex-1 whitespace-nowrap px-3 py-2 rounded-lg bg-purple-500 hover:bg-purple-600 text-white text-sm font-medium transition-colors"
                >
                  保存
                </button>
                <button
                  onClick={copyDirect}
                  className="flex-1 whitespace-nowrap px-3 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium transition-colors"
                >
                  复制
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* 编辑工具栏 - 单行 */}
      {phase === 'editing' && !isLongMode && !longCaptureDone && (
        <div
          ref={toolbarRef}
          className="absolute z-50 flex items-center gap-1 bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl px-2 py-1.5 border border-gray-200"
          style={{ left: toolbarPos.x, top: toolbarPos.y }}
        >
          {/* 工具 */}
          {[
            { t: 'rect' as Tool, icon: <Square size={14} />, label: '矩形' },
            { t: 'ellipse' as Tool, icon: <Circle size={14} />, label: '椭圆' },
            { t: 'arrow' as Tool, icon: <ArrowRight size={14} />, label: '箭头' },
            { t: 'pen' as Tool, icon: <Pen size={14} />, label: '画笔' },
            { t: 'text' as Tool, icon: <Type size={14} />, label: '文字' },
            { t: 'mosaic' as Tool, icon: <Grid3x3 size={14} />, label: '马赛克' },
          ].map(({ t, icon, label }) => (
            <button
              key={t}
              title={label}
              onClick={() => selectTool(t)}
              className={`p-1.5 rounded-lg transition-colors ${tool === t ? 'bg-blue-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              {icon}
            </button>
          ))}

          <div className="w-px h-5 bg-gray-200 mx-0.5" />

          {/* 粗细三档 */}
          {([1, 2, 4] as const).map((w) => (
            <button
              key={w}
              onClick={() => selectLw(w)}
              title={w === 1 ? '细' : w === 2 ? '中' : '粗'}
              className={`flex items-center justify-center w-6 h-6 rounded-lg transition-colors ${lw === w ? 'bg-blue-100' : 'hover:bg-gray-100'}`}
            >
              <div
                className="rounded-full"
                style={{
                  width: w === 1 ? 2 : w === 2 ? 4 : 7,
                  height: w === 1 ? 2 : w === 2 ? 4 : 7,
                  background: lw === w ? '#007AFF' : '#666',
                }}
              />
            </button>
          ))}

          <div className="w-px h-5 bg-gray-200 mx-0.5" />

          {/* 颜色 */}
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => selectColor(c)}
              className="w-4 h-4 rounded-full border-2 transition-transform hover:scale-110 flex-shrink-0"
              style={{
                background: c,
                borderColor: color === c ? '#007AFF' : c === '#FFFFFF' ? '#ddd' : c,
                transform: color === c ? 'scale(1.2)' : undefined,
              }}
            />
          ))}

          <div className="w-px h-5 bg-gray-200 mx-0.5" />

          {/* 撤销 */}
          <button
            onClick={undo}
            disabled={shapeCount === 0}
            title="撤销 Ctrl+Z"
            className="p-1.5 rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-30 transition-colors"
          >
            <Undo2 size={14} />
          </button>

          <div className="w-px h-5 bg-gray-200 mx-0.5" />

          {/* 重选 / 保存 / 复制 */}
          <button
            onClick={reselect}
            title="重新选择"
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
          >
            <X size={14} />
          </button>
          <button
            onClick={startLongCaptureMode}
            disabled={longStepBusy}
            title="长截图"
            className="flex shrink-0 items-center gap-1 whitespace-nowrap px-2.5 py-1.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-white rounded-lg text-xs font-medium transition-colors"
          >
            长截图
          </button>
          <button
            onClick={saveDirect}
            className="flex shrink-0 items-center gap-1 whitespace-nowrap px-2.5 py-1.5 bg-purple-500 hover:bg-purple-600 text-white rounded-lg text-xs font-medium transition-colors"
          >
            <Save size={12} /> 保存
          </button>
          <button
            onClick={copyDirect}
            className="flex shrink-0 items-center gap-1 whitespace-nowrap px-2.5 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-xs font-medium transition-colors"
          >
            <Copy size={12} /> 复制
          </button>
        </div>
      )}
    </div>
  );
}
