import { ChangeEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  ImagePlus,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { useToolTheme } from './useToolTheme';
import { DrawStampUtils } from '../vendor/drawstamputils';
import type {
  ICompany,
  IDrawImage,
  IDrawStampConfig,
  IInnerCircle,
  IStampType,
} from '../vendor/drawstamputils';
import { getSystemFonts } from '../vendor/drawstamputils/utils/fontUtils';
import { InitDrawStampConfigsUtils } from '../vendor/drawstamputils/utils/InitDrawStampConfigsUtils';
import stampTemplate1 from '../vendor/drawstamputils/assets/templates/stamp_template1.json';
import stampTemplate2 from '../vendor/drawstamputils/assets/templates/stamp_template2.json';
import companyStamp1 from '../vendor/drawstamputils/assets/templates/companyStamp1.json';
import companyStamp2 from '../vendor/drawstamputils/assets/templates/companyStamp2.json';
import contractStamp1 from '../vendor/drawstamputils/assets/templates/contractStamp1.json';

const MM_PER_PIXEL = 10;
const CANVAS_SIZE = 620;
const CUSTOM_TEMPLATE_KEY = 'draw-stamp-custom-templates';
const DISCLAIMER_KEY = 'draw-stamp-legal-accepted';

type RefreshReason = {
  security?: boolean;
  aging?: boolean;
  roughEdge?: boolean;
};

type Template = {
  id: string;
  name: string;
  config: IDrawStampConfig;
  custom?: boolean;
};

type DialogMode = 'save-template' | 'legal-export';

const bundledTemplates: Template[] = [
  { id: 'stamp-template-1', name: '标准圆章', config: stampTemplate1 as unknown as IDrawStampConfig },
  { id: 'stamp-template-2', name: '图文圆章', config: stampTemplate2 as unknown as IDrawStampConfig },
  { id: 'company-stamp-1', name: '企业公章', config: companyStamp1 as unknown as IDrawStampConfig },
  { id: 'company-stamp-2', name: '英文圆章', config: companyStamp2 as unknown as IDrawStampConfig },
  { id: 'contract-stamp-1', name: '合同椭圆章', config: contractStamp1 as unknown as IDrawStampConfig },
];

const fontWeights = ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'];
const defaultConfig = new InitDrawStampConfigsUtils().initDrawStampConfigs() as IDrawStampConfig;

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeObjectList<T extends object>(sourceList: unknown, fallbackList: T[], itemDefaults: T): T[] {
  const list = Array.isArray(sourceList) ? sourceList : fallbackList;
  return list.map((item) => ({ ...itemDefaults, ...(item ?? {}) }));
}

function cloneConfig(config: Partial<IDrawStampConfig>): IDrawStampConfig {
  const source = cloneValue(config);
  const cloned = {
    ...cloneValue(defaultConfig),
    ...source,
  } as IDrawStampConfig;
  cloned.ruler = { ...defaultConfig.ruler, ...(cloned.ruler ?? {}) };
  cloned.drawStar = { ...defaultConfig.drawStar, ...(cloned.drawStar ?? {}) };
  cloned.securityPattern = {
    ...defaultConfig.securityPattern,
    ...(cloned.securityPattern ?? {}),
  };
  cloned.roughEdge = { ...defaultConfig.roughEdge, ...(cloned.roughEdge ?? {}) };
  cloned.agingEffect = { ...defaultConfig.agingEffect, ...(cloned.agingEffect ?? {}) };
  cloned.company = { ...defaultConfig.company, ...(cloned.company ?? {}) };
  cloned.stampCode = { ...defaultConfig.stampCode, ...(cloned.stampCode ?? {}) };
  cloned.taxNumber = { ...defaultConfig.taxNumber, ...(cloned.taxNumber ?? {}) };
  cloned.stampType = { ...defaultConfig.stampType, ...(cloned.stampType ?? {}) };
  cloned.innerCircle = { ...defaultConfig.innerCircle, ...(cloned.innerCircle ?? {}) };
  cloned.outThinCircle = { ...defaultConfig.outThinCircle, ...(cloned.outThinCircle ?? {}) };
  cloned.outBorder = { ...defaultConfig.outBorder, ...(cloned.outBorder ?? {}) };
  cloned.primaryColor = cloned.primaryColor === 'blue' ? '#d92323' : cloned.primaryColor;
  cloned.ruler = {
    ...cloned.ruler,
    showRuler: cloned.ruler?.showRuler ?? true,
    showSideRuler: cloned.ruler?.showSideRuler ?? true,
    showDashLine: cloned.ruler?.showDashLine ?? true,
    showCrossLine: cloned.ruler?.showCrossLine ?? true,
    showFullRuler: cloned.ruler?.showFullRuler ?? true,
    showCurrentPositionText: cloned.ruler?.showCurrentPositionText ?? true,
  };
  // Empty lists are intentional user state; only missing lists should use legacy single-item defaults.
  cloned.companyList = normalizeObjectList(source.companyList, [cloned.company], defaultConfig.company);
  cloned.stampTypeList = normalizeObjectList(source.stampTypeList, [cloned.stampType], defaultConfig.stampType);
  cloned.innerCircleList = normalizeObjectList(source.innerCircleList, [], defaultConfig.innerCircle);
  cloned.imageList = Array.isArray(source.imageList) ? source.imageList : [];
  cloned.securityPattern.securityPatternParams = cloned.securityPattern.securityPatternParams ?? [];
  cloned.roughEdge.roughEdgeParams = cloned.roughEdge.roughEdgeParams ?? [];
  cloned.agingEffect.agingEffectParams = cloned.agingEffect.agingEffectParams ?? [];
  cloned.drawStar = {
    ...cloned.drawStar,
    useImage: cloned.drawStar.useImage ?? false,
    keepAspectRatio: cloned.drawStar.keepAspectRatio ?? true,
    imageWidth: cloned.drawStar.imageWidth ?? cloned.drawStar.starDiameter,
    imageHeight: cloned.drawStar.imageHeight ?? cloned.drawStar.starDiameter,
    scaleToSmallStar: cloned.drawStar.scaleToSmallStar ?? false,
  };
  return cloned;
}

function makeCompany(): ICompany {
  return {
    companyName: '新公司名称',
    compression: 1,
    borderOffset: 1,
    textDistributionFactor: 3,
    fontFamily: 'SimSun',
    fontHeight: 4.2,
    fontWeight: 'normal',
    shape: 'ellipse',
    adjustEllipseText: true,
    adjustEllipseTextFactor: 0.5,
    startAngle: 0,
    rotateDirection: 'counterclockwise',
  };
}

function makeStampType(): IStampType {
  return {
    stampType: '专用章',
    fontHeight: 4.2,
    fontFamily: 'Arial',
    fontWidth: 3,
    compression: 0.85,
    letterSpacing: 0,
    positionY: -3,
    fontWeight: 'normal',
    lineSpacing: 2,
  };
}

function makeInnerCircle(): IInnerCircle {
  return {
    drawInnerCircle: true,
    innerCircleLineWidth: 0.35,
    innerCircleLineRadiusX: 14,
    innerCircleLineRadiusY: 10,
  };
}

function makeImage(imageUrl: string): IDrawImage {
  return {
    imageUrl,
    imageWidth: 10,
    imageHeight: 10,
    positionX: 0,
    positionY: 0,
    keepAspectRatio: true,
  };
}

function loadCustomTemplates(): Template[] {
  try {
    const saved = localStorage.getItem(CUSTOM_TEMPLATE_KEY);
    if (!saved) return [];
    return (JSON.parse(saved) as Array<{ id: string; name: string; config: IDrawStampConfig }>).map(
      (item) => ({ ...item, custom: true })
    );
  } catch {
    return [];
  }
}

function saveCustomTemplates(templates: Template[]) {
  localStorage.setItem(
    CUSTOM_TEMPLATE_KEY,
    JSON.stringify(templates.map(({ id, name, config }) => ({ id, name, config })))
  );
}

function isCanvasBlank(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx) return true;
  const sample = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let index = 3; index < sample.length; index += 4) {
    if (sample[index] !== 0) return false;
  }
  return true;
}

function drawFallbackPreview(draw: DrawStampUtils, config: IDrawStampConfig, reason: RefreshReason = {}) {
  const ctx = draw.canvas.getContext('2d');
  if (!ctx) return;
  const centerX = draw.canvas.width / 2;
  const centerY = draw.canvas.height / 2;
  const radiusX = ((config.width - config.outBorder.innerCircleLineWidth) / 2) * MM_PER_PIXEL;
  const radiusY = ((config.height - config.outBorder.innerCircleLineWidth) / 2) * MM_PER_PIXEL;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, draw.canvas.width, draw.canvas.height);
  draw.drawStamp(
    ctx,
    centerX,
    centerY,
    radiusX,
    radiusY,
    config.primaryColor,
    !!reason.security,
    !!reason.aging,
    !!reason.roughEdge
  );
}

export default function DrawStampTool() {
  const ready = useToolTheme();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawRef = useRef<DrawStampUtils | null>(null);
  const [config, setConfig] = useState<IDrawStampConfig>(() =>
    cloneConfig(stampTemplate1 as unknown as IDrawStampConfig)
  );
  const [customTemplates, setCustomTemplates] = useState<Template[]>(() => loadCustomTemplates());
  const [selectedTemplateId, setSelectedTemplateId] = useState(bundledTemplates[0].id);
  const [fonts, setFonts] = useState<string[]>(['SimSun', 'SimHei', 'Microsoft YaHei', 'Arial']);
  const [dialogMode, setDialogMode] = useState<DialogMode | null>(null);
  const [acceptedDisclaimer, setAcceptedDisclaimer] = useState(
    () => localStorage.getItem(DISCLAIMER_KEY) === 'true'
  );
  const [templateName, setTemplateName] = useState('我的印章模板');
  const [refreshReason, setRefreshReason] = useState<RefreshReason>({});
  const [draggable, setDraggable] = useState(false);

  const allTemplates = useMemo(() => [...bundledTemplates, ...customTemplates], [customTemplates]);
  const syncCanvas = useCallback(
    (draw: DrawStampUtils, reason: RefreshReason = {}) => {
      draw.setDrawConfigs(config);
      draw.setDraggable(draggable);
      try {
        draw.refreshStamp(!!reason.security, !!reason.aging, !!reason.roughEdge);
        if (isCanvasBlank(draw.canvas)) {
          drawFallbackPreview(draw, config, reason);
        }
      } catch (error) {
        console.error('[DrawStampTool] refreshStamp failed, using fallback preview', error);
        drawFallbackPreview(draw, config, reason);
      }
    },
    [config, draggable]
  );

  useEffect(() => {
    let active = true;
    getSystemFonts().then((nextFonts) => {
      if (active) setFonts(nextFonts);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const frame = window.requestAnimationFrame(() => {
      setRefreshReason({ security: true, aging: true, roughEdge: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fonts, ready]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let draw = drawRef.current;
    const needsFreshInstance = !draw || draw.canvas !== canvas;
    if (needsFreshInstance) {
      draw = new DrawStampUtils(canvas, MM_PER_PIXEL);
      drawRef.current = draw;
    }
    if (!draw) return;
    syncCanvas(
      draw,
      needsFreshInstance ? { security: true, aging: true, roughEdge: true } : refreshReason
    );
    if (Object.keys(refreshReason).length) {
      setRefreshReason({});
    }
  }, [refreshReason, syncCanvas]);

  const updateConfig = useCallback(
    (updater: (draft: IDrawStampConfig) => void, reason: RefreshReason = {}) => {
      setConfig((current) => {
        const next = cloneConfig(current);
        updater(next);
        return next;
      });
      if (Object.keys(reason).length) setRefreshReason(reason);
    },
    []
  );

  const loadTemplate = (templateId: string) => {
    const template = allTemplates.find((item) => item.id === templateId);
    if (!template) return;
    setSelectedTemplateId(template.id);
    setConfig(cloneConfig(template.config));
    setRefreshReason({ security: true, aging: true, roughEdge: true });
  };

  const saveTemplate = () => {
    const next = [
      ...customTemplates,
      {
        id: `custom-${Date.now()}`,
        name: templateName.trim() || '未命名模板',
        config: cloneConfig(config),
        custom: true,
      },
    ];
    setCustomTemplates(next);
    saveCustomTemplates(next);
    setDialogMode(null);
  };

  const removeTemplate = (id: string) => {
    const next = customTemplates.filter((template) => template.id !== id);
    setCustomTemplates(next);
    saveCustomTemplates(next);
    if (selectedTemplateId === id) loadTemplate(bundledTemplates[0].id);
  };

  const exportStamp = () => {
    if (!acceptedDisclaimer) {
      setDialogMode('legal-export');
      return;
    }
    drawRef.current?.saveStampAsPNG();
  };

  const acceptAndExport = () => {
    localStorage.setItem(DISCLAIMER_KEY, 'true');
    setAcceptedDisclaimer(true);
    setDialogMode(null);
    requestAnimationFrame(() => drawRef.current?.saveStampAsPNG());
  };

  const handleImageUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const imageUrl = String(reader.result || '');
      updateConfig((draft) => {
        draft.imageList.push(makeImage(imageUrl));
      });
    };
    reader.readAsDataURL(file);
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <ToolHeader
        title="电子印章制作"
        icon="🔴"
        subtitle="本地生成 PNG，支持模板、毛边、防伪、做旧和图片元素"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDialogMode('save-template')}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              title="保存模板"
            >
              <Save size={15} />
              保存模板
            </button>
            <button
              onClick={exportStamp}
              className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-red-700"
              title="导出 PNG"
            >
              <Download size={15} />
              导出 PNG
            </button>
          </div>
        }
      />

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[390px] shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 p-4 dark:border-slate-800">
            <label className="mb-1 block text-xs font-medium text-slate-500">模板</label>
            <div className="flex gap-2">
              <select
                value={selectedTemplateId}
                onChange={(event) => loadTemplate(event.target.value)}
                className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              >
                {allTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.custom ? '自定义 - ' : ''}{template.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => loadTemplate(selectedTemplateId)}
                className="rounded-md border border-slate-300 p-2 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                title="重新载入模板"
              >
                <RotateCcw size={16} />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            <Section title="印章尺寸">
              <div className="grid grid-cols-2 gap-3">
                <NumberField label="宽度 mm" value={config.width} min={10} max={80} onChange={(value) => updateConfig((draft) => { draft.width = value; })} />
                <NumberField label="高度 mm" value={config.height} min={10} max={80} onChange={(value) => updateConfig((draft) => { draft.height = value; })} />
                <NumberField label="外圈线宽" value={config.outBorder.innerCircleLineWidth} min={0.1} max={5} step={0.1} onChange={(value) => updateConfig((draft) => { draft.outBorder.innerCircleLineWidth = value; })} />
                <ColorField label="主色" value={config.primaryColor} onChange={(value) => updateConfig((draft) => { draft.primaryColor = value; })} />
              </div>
              <Toggle label="显示外圈" checked={config.outBorder.drawInnerCircle} onChange={(checked) => updateConfig((draft) => { draft.outBorder.drawInnerCircle = checked; })} />
            </Section>

            <Section
              title="公司名称"
              action={<IconButton title="添加公司文字" onClick={() => updateConfig((draft) => { draft.companyList.push(makeCompany()); })}><Plus size={15} /></IconButton>}
            >
              {config.companyList.map((company, index) => (
                <Panel key={index} title={`第 ${index + 1} 行`} onDelete={() => updateConfig((draft) => { draft.companyList.splice(index, 1); })}>
                  <TextField label="文字" value={company.companyName} onChange={(value) => updateConfig((draft) => { draft.companyList[index].companyName = value; })} />
                  <div className="grid grid-cols-2 gap-3">
                    <FontField label="字体" value={company.fontFamily} fonts={fonts} onChange={(value) => updateConfig((draft) => { draft.companyList[index].fontFamily = value; })} />
                    <SelectField label="字重" value={String(company.fontWeight)} options={fontWeights} onChange={(value) => updateConfig((draft) => { draft.companyList[index].fontWeight = value; })} />
                    <NumberField label="字号 mm" value={company.fontHeight} min={1} max={12} step={0.1} onChange={(value) => updateConfig((draft) => { draft.companyList[index].fontHeight = value; })} />
                    <NumberField label="边距 mm" value={company.borderOffset} min={-8} max={12} step={0.1} onChange={(value) => updateConfig((draft) => { draft.companyList[index].borderOffset = value; })} />
                    <NumberField label="分布" value={company.textDistributionFactor} min={0} max={80} step={0.1} onChange={(value) => updateConfig((draft) => { draft.companyList[index].textDistributionFactor = value; })} />
                    <NumberField label="横向压缩" value={company.compression} min={0.4} max={1.8} step={0.05} onChange={(value) => updateConfig((draft) => { draft.companyList[index].compression = value; })} />
                    <NumberField label="起始角度" value={Math.round((company.startAngle * 180) / Math.PI)} min={-180} max={180} step={1} onChange={(value) => updateConfig((draft) => { draft.companyList[index].startAngle = (value * Math.PI) / 180; })} />
                    <NumberField label="椭圆修正" value={company.adjustEllipseTextFactor} min={0.1} max={2} step={0.05} onChange={(value) => updateConfig((draft) => { draft.companyList[index].adjustEllipseTextFactor = value; })} />
                  </div>
                  <SelectField
                    label="旋转方向"
                    value={company.rotateDirection}
                    options={['counterclockwise', 'clockwise']}
                    labels={{ counterclockwise: '逆时针', clockwise: '顺时针' }}
                    onChange={(value) => updateConfig((draft) => { draft.companyList[index].rotateDirection = value as ICompany['rotateDirection']; })}
                  />
                  <Toggle label="适配椭圆文字" checked={company.adjustEllipseText} onChange={(checked) => updateConfig((draft) => { draft.companyList[index].adjustEllipseText = checked; })} />
                </Panel>
              ))}
            </Section>

            <Section
              title="下方文字"
              action={<IconButton title="添加印章类型" onClick={() => updateConfig((draft) => { draft.stampTypeList.push(makeStampType()); })}><Plus size={15} /></IconButton>}
            >
              {config.stampTypeList.map((stampType, index) => (
                <Panel key={index} title={`第 ${index + 1} 行`} onDelete={() => updateConfig((draft) => { draft.stampTypeList.splice(index, 1); })}>
                  <TextField label="文字" value={stampType.stampType} onChange={(value) => updateConfig((draft) => { draft.stampTypeList[index].stampType = value; })} />
                  <div className="grid grid-cols-2 gap-3">
                    <FontField label="字体" value={stampType.fontFamily} fonts={fonts} onChange={(value) => updateConfig((draft) => { draft.stampTypeList[index].fontFamily = value; })} />
                    <SelectField label="字重" value={String(stampType.fontWeight)} options={fontWeights} onChange={(value) => updateConfig((draft) => { draft.stampTypeList[index].fontWeight = value; })} />
                    <NumberField label="字号 mm" value={stampType.fontHeight} min={1} max={12} step={0.1} onChange={(value) => updateConfig((draft) => { draft.stampTypeList[index].fontHeight = value; })} />
                    <NumberField label="Y 位置" value={stampType.positionY} min={-20} max={20} step={0.2} onChange={(value) => updateConfig((draft) => { draft.stampTypeList[index].positionY = value; })} />
                    <NumberField label="字距" value={stampType.letterSpacing} min={-2} max={12} step={0.1} onChange={(value) => updateConfig((draft) => { draft.stampTypeList[index].letterSpacing = value; })} />
                    <NumberField label="横向压缩" value={stampType.compression} min={0.2} max={2} step={0.05} onChange={(value) => updateConfig((draft) => { draft.stampTypeList[index].compression = value; })} />
                    <NumberField label="行距" value={stampType.lineSpacing} min={0} max={8} step={0.1} onChange={(value) => updateConfig((draft) => { draft.stampTypeList[index].lineSpacing = value; })} />
                  </div>
                </Panel>
              ))}
            </Section>

            <Section title="编码与中心数字">
              <TextField label="印章编码" value={config.stampCode.code} onChange={(value) => updateConfig((draft) => { draft.stampCode.code = value; })} />
              <TextField label="中心数字" value={config.taxNumber.code} onChange={(value) => updateConfig((draft) => { draft.taxNumber.code = value; })} />
              <div className="grid grid-cols-2 gap-3">
                <NumberField label="编码字号" value={config.stampCode.fontHeight} min={0.5} max={8} step={0.1} onChange={(value) => updateConfig((draft) => { draft.stampCode.fontHeight = value; })} />
                <NumberField label="编码边距" value={config.stampCode.borderOffset} min={-8} max={18} step={0.1} onChange={(value) => updateConfig((draft) => { draft.stampCode.borderOffset = value; })} />
                <FontField label="编码字体" value={config.stampCode.fontFamily} fonts={fonts} onChange={(value) => updateConfig((draft) => { draft.stampCode.fontFamily = value; })} />
                <SelectField label="编码字重" value={String(config.stampCode.fontWeight)} options={fontWeights} onChange={(value) => updateConfig((draft) => { draft.stampCode.fontWeight = value; })} />
                <NumberField label="编码分布" value={config.stampCode.textDistributionFactor} min={1} max={120} step={0.5} onChange={(value) => updateConfig((draft) => { draft.stampCode.textDistributionFactor = value; })} />
                <NumberField label="编码压缩" value={config.stampCode.compression} min={0.2} max={3} step={0.05} onChange={(value) => updateConfig((draft) => { draft.stampCode.compression = value; })} />
                <NumberField label="中心字号" value={config.taxNumber.fontHeight} min={1} max={10} step={0.1} onChange={(value) => updateConfig((draft) => { draft.taxNumber.fontHeight = value; })} />
                <NumberField label="中心 Y" value={config.taxNumber.positionY} min={-12} max={12} step={0.2} onChange={(value) => updateConfig((draft) => { draft.taxNumber.positionY = value; })} />
                <FontField label="中心字体" value={config.taxNumber.fontFamily} fonts={fonts} onChange={(value) => updateConfig((draft) => { draft.taxNumber.fontFamily = value; })} />
                <SelectField label="中心字重" value={String(config.taxNumber.fontWeight)} options={fontWeights} onChange={(value) => updateConfig((draft) => { draft.taxNumber.fontWeight = value; })} />
                <NumberField label="中心字距" value={config.taxNumber.letterSpacing} min={-2} max={20} step={0.1} onChange={(value) => updateConfig((draft) => { draft.taxNumber.letterSpacing = value; })} />
                <NumberField label="中心总宽" value={config.taxNumber.totalWidth} min={4} max={60} step={0.5} onChange={(value) => updateConfig((draft) => { draft.taxNumber.totalWidth = value; })} />
              </div>
            </Section>

            <Section title="五角星与图片">
              <Toggle label="绘制五角星" checked={config.drawStar.drawStar} onChange={(checked) => updateConfig((draft) => { draft.drawStar.drawStar = checked; })} />
              <div className="grid grid-cols-2 gap-3">
                <NumberField label="五角星直径" value={config.drawStar.starDiameter} min={1} max={30} step={0.5} onChange={(value) => updateConfig((draft) => { draft.drawStar.starDiameter = value; })} />
                <NumberField label="五角星 Y" value={config.drawStar.starPositionY} min={-20} max={20} step={0.5} onChange={(value) => updateConfig((draft) => { draft.drawStar.starPositionY = value; })} />
              </div>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                <ImagePlus size={16} />
                添加图片元素
                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
              </label>
              {config.imageList.map((image, index) => (
                <Panel key={index} title={`图片 ${index + 1}`} onDelete={() => updateConfig((draft) => { draft.imageList.splice(index, 1); })}>
                  <div className="grid grid-cols-2 gap-3">
                    <NumberField label="宽度 mm" value={image.imageWidth} min={1} max={60} step={0.5} onChange={(value) => updateConfig((draft) => { draft.imageList[index].imageWidth = value; })} />
                    <NumberField label="高度 mm" value={image.imageHeight} min={1} max={60} step={0.5} onChange={(value) => updateConfig((draft) => { draft.imageList[index].imageHeight = value; })} />
                    <NumberField label="X 位置" value={image.positionX} min={-30} max={30} step={0.5} onChange={(value) => updateConfig((draft) => { draft.imageList[index].positionX = value; })} />
                    <NumberField label="Y 位置" value={image.positionY} min={-30} max={30} step={0.5} onChange={(value) => updateConfig((draft) => { draft.imageList[index].positionY = value; })} />
                  </div>
                  <Toggle label="保持比例" checked={image.keepAspectRatio} onChange={(checked) => updateConfig((draft) => { draft.imageList[index].keepAspectRatio = checked; })} />
                </Panel>
              ))}
            </Section>

            <Section
              title="圈线"
              action={<IconButton title="添加内圈" onClick={() => updateConfig((draft) => { draft.innerCircleList.push(makeInnerCircle()); })}><Plus size={15} /></IconButton>}
            >
              <Panel title="内细圈">
                <Toggle label="显示" checked={config.outThinCircle.drawInnerCircle} onChange={(checked) => updateConfig((draft) => { draft.outThinCircle.drawInnerCircle = checked; })} />
                <div className="grid grid-cols-3 gap-3">
                  <NumberField label="线宽" value={config.outThinCircle.innerCircleLineWidth} min={0.1} max={3} step={0.1} onChange={(value) => updateConfig((draft) => { draft.outThinCircle.innerCircleLineWidth = value; })} />
                  <NumberField label="X 半径" value={config.outThinCircle.innerCircleLineRadiusX} min={1} max={40} step={0.5} onChange={(value) => updateConfig((draft) => { draft.outThinCircle.innerCircleLineRadiusX = value; })} />
                  <NumberField label="Y 半径" value={config.outThinCircle.innerCircleLineRadiusY} min={1} max={40} step={0.5} onChange={(value) => updateConfig((draft) => { draft.outThinCircle.innerCircleLineRadiusY = value; })} />
                </div>
              </Panel>
              {config.innerCircleList.map((circle, index) => (
                <Panel key={index} title={`内圈 ${index + 1}`} onDelete={() => updateConfig((draft) => { draft.innerCircleList.splice(index, 1); })}>
                  <Toggle label="显示" checked={circle.drawInnerCircle} onChange={(checked) => updateConfig((draft) => { draft.innerCircleList[index].drawInnerCircle = checked; })} />
                  <div className="grid grid-cols-3 gap-3">
                    <NumberField label="线宽" value={circle.innerCircleLineWidth} min={0.1} max={3} step={0.1} onChange={(value) => updateConfig((draft) => { draft.innerCircleList[index].innerCircleLineWidth = value; })} />
                    <NumberField label="X 半径" value={circle.innerCircleLineRadiusX} min={1} max={40} step={0.5} onChange={(value) => updateConfig((draft) => { draft.innerCircleList[index].innerCircleLineRadiusX = value; })} />
                    <NumberField label="Y 半径" value={circle.innerCircleLineRadiusY} min={1} max={40} step={0.5} onChange={(value) => updateConfig((draft) => { draft.innerCircleList[index].innerCircleLineRadiusY = value; })} />
                  </div>
                </Panel>
              ))}
            </Section>

            <Section title="效果">
              <Toggle label="防伪纹路" checked={config.securityPattern.openSecurityPattern} onChange={(checked) => updateConfig((draft) => { draft.securityPattern.openSecurityPattern = checked; }, { security: true })} />
              <div className="grid grid-cols-3 gap-3">
                <NumberField label="数量" value={config.securityPattern.securityPatternCount} min={0} max={60} step={1} onChange={(value) => updateConfig((draft) => { draft.securityPattern.securityPatternCount = value; }, { security: true })} />
                <NumberField label="长度" value={config.securityPattern.securityPatternLength} min={0.5} max={10} step={0.1} onChange={(value) => updateConfig((draft) => { draft.securityPattern.securityPatternLength = value; }, { security: true })} />
                <NumberField label="线宽" value={config.securityPattern.securityPatternWidth} min={0.05} max={2} step={0.05} onChange={(value) => updateConfig((draft) => { draft.securityPattern.securityPatternWidth = value; }, { security: true })} />
                <NumberField label="角度范围" value={config.securityPattern.securityPatternAngleRange} min={0} max={180} step={1} onChange={(value) => updateConfig((draft) => { draft.securityPattern.securityPatternAngleRange = value; }, { security: true })} />
              </div>
              <Toggle label="毛边效果" checked={config.roughEdge.drawRoughEdge} onChange={(checked) => updateConfig((draft) => { draft.roughEdge.drawRoughEdge = checked; }, { roughEdge: true })} />
              <div className="grid grid-cols-3 gap-3">
                <NumberField label="宽度" value={config.roughEdge.roughEdgeWidth} min={0} max={3} step={0.1} onChange={(value) => updateConfig((draft) => { draft.roughEdge.roughEdgeWidth = value; }, { roughEdge: true })} />
                <NumberField label="高度%" value={config.roughEdge.roughEdgeHeight} min={0} max={30} step={0.5} onChange={(value) => updateConfig((draft) => { draft.roughEdge.roughEdgeHeight = value; }, { roughEdge: true })} />
                <NumberField label="概率" value={config.roughEdge.roughEdgeProbability} min={0} max={1} step={0.05} onChange={(value) => updateConfig((draft) => { draft.roughEdge.roughEdgeProbability = value; }, { roughEdge: true })} />
                <NumberField label="偏移" value={config.roughEdge.roughEdgeShift} min={0} max={16} step={0.5} onChange={(value) => updateConfig((draft) => { draft.roughEdge.roughEdgeShift = value; }, { roughEdge: true })} />
                <NumberField label="点数" value={config.roughEdge.roughEdgePoints} min={30} max={720} step={10} onChange={(value) => updateConfig((draft) => { draft.roughEdge.roughEdgePoints = value; }, { roughEdge: true })} />
              </div>
              <Toggle label="自动做旧" checked={config.agingEffect.applyAging} onChange={(checked) => updateConfig((draft) => { draft.agingEffect.applyAging = checked; }, { aging: true })} />
              <RangeField label="做旧强度" value={config.agingEffect.agingIntensity} min={0} max={100} step={1} onChange={(value) => updateConfig((draft) => { draft.agingEffect.agingIntensity = value; }, { aging: true })} />
              <Toggle label="手动做旧画笔" checked={config.openManualAging} onChange={(checked) => updateConfig((draft) => { draft.openManualAging = checked; })} />
            </Section>

            <Section title="画布辅助">
              <Toggle label="可拖动画布内印章" checked={draggable} onChange={setDraggable} />
              <Toggle label="显示标尺" checked={config.ruler.showRuler} onChange={(checked) => updateConfig((draft) => { draft.ruler.showRuler = checked; })} />
              <Toggle label="显示边缘标尺" checked={config.ruler.showSideRuler} onChange={(checked) => updateConfig((draft) => { draft.ruler.showSideRuler = checked; })} />
              <Toggle label="显示虚线网格" checked={config.ruler.showDashLine} onChange={(checked) => updateConfig((draft) => { draft.ruler.showDashLine = checked; })} />
              <Toggle label="显示十字辅助线" checked={config.ruler.showCrossLine} onChange={(checked) => updateConfig((draft) => { draft.ruler.showCrossLine = checked; })} />
              <Toggle label="显示坐标文字" checked={config.ruler.showCurrentPositionText} onChange={(checked) => updateConfig((draft) => { draft.ruler.showCurrentPositionText = checked; })} />
            </Section>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3 dark:border-slate-800 dark:bg-slate-900">
            <div>
              <div className="text-sm font-medium">实时预览</div>
              <div className="text-xs text-slate-500">Ctrl + 滚轮缩放；开启拖动后可移动印章位置</div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => drawRef.current?.resetZoom()}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                <RotateCcw size={15} />
                重置视图
              </button>
              <button
                onClick={() => setRefreshReason({ security: true, aging: true, roughEdge: true })}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                <RefreshCw size={15} />
                刷新随机效果
              </button>
            </div>
          </div>

          <div className="flex flex-1 items-center justify-center overflow-auto bg-[radial-gradient(circle_at_center,_#f8fafc_0,_#e2e8f0_100%)] p-8 dark:bg-[radial-gradient(circle_at_center,_#172033_0,_#020617_100%)]">
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <canvas
                ref={canvasRef}
                width={CANVAS_SIZE}
                height={CANVAS_SIZE}
                className="block rounded-md border border-slate-200 bg-white dark:border-slate-700"
              />
            </div>
          </div>
        </main>
      </div>

      {dialogMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl dark:bg-slate-900">
            {dialogMode === 'legal-export' ? (
              <>
                <h2 className="text-base font-semibold">法律提示</h2>
                <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  本工具仅用于合法的学习、设计稿和内部流程演示。请勿将生成图片用于冒用主体、
                  伪造文件或其他违法场景，相关责任由使用者自行承担。
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <button className="rounded-md px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setDialogMode(null)}>取消</button>
                  <button className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700" onClick={acceptAndExport}>同意并导出</button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-base font-semibold">保存当前模板</h2>
                <TextField label="模板名称" value={templateName} onChange={setTemplateName} />
                {customTemplates.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <div className="text-xs font-medium text-slate-500">自定义模板</div>
                    {customTemplates.map((template) => (
                      <div key={template.id} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
                        <span>{template.name}</span>
                        <button className="text-red-600 hover:text-red-700" onClick={() => removeTemplate(template.id)}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-5 flex justify-end gap-2">
                  <button className="rounded-md px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setDialogMode(null)}>取消</button>
                  <button className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900" onClick={saveTemplate}>保存模板</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/50">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Panel({ title, onDelete, children }: { title: string; onDelete?: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">{title}</span>
        {onDelete && (
          <button className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30" onClick={onDelete} title="删除">
            <Trash2 size={14} />
          </button>
        )}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className="rounded-md border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800" title={title} onClick={onClick}>
      {children}
    </button>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
      />
    </label>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  const current = Number.isFinite(value) ? value : min;
  return (
    <label className="block rounded-md border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
      <span className="mb-2 flex items-center justify-between gap-3 text-xs font-medium text-slate-500">
        <span>{label}</span>
        <span className="tabular-nums text-slate-700 dark:text-slate-200">{Math.round(current)}%</span>
      </span>
      <input
        type="range"
        value={current}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-2 w-full cursor-ew-resize appearance-none rounded-full bg-slate-200 accent-red-600 dark:bg-slate-700"
      />
    </label>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <input type="color" value={value.startsWith('#') ? value : '#d92323'} onChange={(event) => onChange(event.target.value)} className="h-[34px] w-full rounded-md border border-slate-300 bg-white px-1 py-1 dark:border-slate-700 dark:bg-slate-950" />
    </label>
  );
}

function FontField({ label, value, fonts, onChange }: { label: string; value: string; fonts: string[]; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <input list="draw-stamp-fonts" value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
      <datalist id="draw-stamp-fonts">
        {fonts.map((font) => (
          <option key={font} value={font} />
        ))}
      </datalist>
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  labels?: Record<string, string>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950">
        {options.map((option) => (
          <option key={option} value={option}>{labels?.[option] ?? option}</option>
        ))}
      </select>
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-red-600" />
    </label>
  );
}
