// 高级二维码生成器 - 支持Logo、样式、渐变等
import { useState, useEffect, useRef } from 'react';
import { Download, Copy, Check, Upload, Trash2 } from 'lucide-react';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';
import QRCode from 'qrcode';

type QRType = 'text' | 'url' | 'vcard' | 'wifi' | 'phone' | 'sms' | 'email' | 'location';
type QRStyle = 'square' | 'rounded' | 'dots' | 'fluid';

interface QRData {
  text?: string;
  url?: string;
  name?: string;
  phone?: string;
  email?: string;
  emailSubject?: string;
  emailBody?: string;
  company?: string;
  title?: string;
  website?: string;
  address?: string;
  // WiFi
  ssid?: string;
  password?: string;
  encryption?: 'WPA' | 'WEP' | 'nopass';
  hidden?: boolean;
  // 短信
  smsNumber?: string;
  smsBody?: string;
  // 地理位置
  latitude?: string;
  longitude?: string;
  locationName?: string;
}

interface QROptions {
  size: number;
  fgColor: string;
  bgColor: string;
  errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H';
  style: QRStyle;
  cornerRadius: number;
  dotScale: number;
  gradient: boolean;
  gradientColor: string;
  gradientType: 'linear' | 'radial';
  logoSize: number;
  logoPadding: number;
  logoBackgroundColor: string;
}

export default function QRCodeGenerator() {
  const ready = useToolTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [qrType, setQrType] = useState<QRType>('text');
  const [qrData, setQrData] = useState<QRData>({ text: 'Hello World' });
  const [qrOptions, setQrOptions] = useState<QROptions>({
    size: 400,
    fgColor: '#000000',
    bgColor: '#ffffff',
    errorCorrectionLevel: 'H',
    style: 'square',
    cornerRadius: 0,
    dotScale: 1,
    gradient: false,
    gradientColor: '#0066ff',
    gradientType: 'linear',
    logoSize: 80,
    logoPadding: 10,
    logoBackgroundColor: '#ffffff',
  });
  const [copied, setCopied] = useState(false);
  const [logoImage, setLogoImage] = useState<HTMLImageElement | null>(null);

  // 生成二维码内容
  const generateQRContent = (): string => {
    switch (qrType) {
      case 'text':
        return qrData.text || '';
      case 'url':
        return qrData.url || '';
      case 'vcard':
        return `BEGIN:VCARD
VERSION:3.0
FN:${qrData.name || ''}
TEL:${qrData.phone || ''}
EMAIL:${qrData.email || ''}
ORG:${qrData.company || ''}
TITLE:${qrData.title || ''}
URL:${qrData.website || ''}
ADR:;;${qrData.address || ''};;;;
END:VCARD`;
      case 'wifi':
        return `WIFI:T:${qrData.encryption || 'WPA'};S:${qrData.ssid || ''};P:${qrData.password || ''};H:${qrData.hidden ? 'true' : 'false'};;`;
      case 'phone':
        return `tel:${qrData.phone || ''}`;
      case 'sms':
        return `SMSTO:${qrData.smsNumber || ''}:${qrData.smsBody || ''}`;
      case 'email':
        const emailParts = [`mailto:${qrData.email || ''}`];
        const params = [];
        if (qrData.emailSubject) params.push(`subject=${encodeURIComponent(qrData.emailSubject)}`);
        if (qrData.emailBody) params.push(`body=${encodeURIComponent(qrData.emailBody)}`);
        if (params.length > 0) emailParts.push('?' + params.join('&'));
        return emailParts.join('');
      case 'location':
        // 支持Google Maps格式：geo:lat,lng?q=lat,lng(label)
        const geoBase = `geo:${qrData.latitude || '0'},${qrData.longitude || '0'}`;
        if (qrData.locationName) {
          return `${geoBase}?q=${qrData.latitude || '0'},${qrData.longitude || '0'}(${encodeURIComponent(qrData.locationName)})`;
        }
        return geoBase;
      default:
        return '';
    }
  };

  // 上传Logo
  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        setLogoImage(img);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // 删除Logo
  const removeLogo = () => {
    setLogoImage(null);
    if (logoInputRef.current) {
      logoInputRef.current.value = '';
    }
  };

  // 绘制高级样式二维码
  const drawStyledQRCode = async () => {
    const content = generateQRContent();
    if (!content || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 生成基础二维码数据
    const qrData = await QRCode.create(content, {
      errorCorrectionLevel: qrOptions.errorCorrectionLevel,
    });

    const modules = qrData.modules;
    const size = qrOptions.size;
    const moduleCount = modules.size;
    const moduleSize = size / moduleCount;

    canvas.width = size;
    canvas.height = size;

    // 绘制背景
    ctx.fillStyle = qrOptions.bgColor;
    ctx.fillRect(0, 0, size, size);

    // 创建渐变
    let fillStyle: string | CanvasGradient = qrOptions.fgColor;
    if (qrOptions.gradient) {
      if (qrOptions.gradientType === 'linear') {
        const gradient = ctx.createLinearGradient(0, 0, size, size);
        gradient.addColorStop(0, qrOptions.fgColor);
        gradient.addColorStop(1, qrOptions.gradientColor);
        fillStyle = gradient;
      } else {
        const gradient = ctx.createRadialGradient(
          size / 2,
          size / 2,
          0,
          size / 2,
          size / 2,
          size / 2
        );
        gradient.addColorStop(0, qrOptions.fgColor);
        gradient.addColorStop(1, qrOptions.gradientColor);
        fillStyle = gradient;
      }
    }

    // 绘制二维码模块
    for (let row = 0; row < moduleCount; row++) {
      for (let col = 0; col < moduleCount; col++) {
        if (modules.get(row, col)) {
          const x = col * moduleSize;
          const y = row * moduleSize;

          ctx.fillStyle = fillStyle;

          switch (qrOptions.style) {
            case 'square':
              ctx.fillRect(x, y, moduleSize, moduleSize);
              break;

            case 'rounded':
              ctx.beginPath();
              const radius = moduleSize * qrOptions.cornerRadius;
              ctx.roundRect(x, y, moduleSize, moduleSize, radius);
              ctx.fill();
              break;

            case 'dots':
              ctx.beginPath();
              const dotSize = moduleSize * qrOptions.dotScale;
              ctx.arc(x + moduleSize / 2, y + moduleSize / 2, dotSize / 2, 0, Math.PI * 2);
              ctx.fill();
              break;

            case 'fluid':
              // 流体风格：检查相邻模块并绘制连接
              const hasTop = row > 0 && modules.get(row - 1, col);
              const hasBottom = row < moduleCount - 1 && modules.get(row + 1, col);
              const hasLeft = col > 0 && modules.get(row, col - 1);
              const hasRight = col < moduleCount - 1 && modules.get(row, col + 1);

              ctx.beginPath();
              if (hasTop || hasBottom || hasLeft || hasRight) {
                const r = moduleSize * 0.3;
                ctx.roundRect(x, y, moduleSize, moduleSize, r);
              } else {
                ctx.arc(x + moduleSize / 2, y + moduleSize / 2, moduleSize / 2, 0, Math.PI * 2);
              }
              ctx.fill();
              break;
          }
        }
      }
    }

    // 绘制Logo
    if (logoImage) {
      const logoSize = qrOptions.logoSize;
      const logoPadding = qrOptions.logoPadding;
      const logoX = (size - logoSize) / 2;
      const logoY = (size - logoSize) / 2;

      // 绘制Logo背景
      ctx.fillStyle = qrOptions.logoBackgroundColor;
      ctx.fillRect(
        logoX - logoPadding,
        logoY - logoPadding,
        logoSize + logoPadding * 2,
        logoSize + logoPadding * 2
      );

      // 绘制Logo
      ctx.drawImage(logoImage, logoX, logoY, logoSize, logoSize);
    }
  };

  // 生成二维码
  useEffect(() => {
    drawStyledQRCode();
  }, [qrType, qrData, qrOptions, logoImage]);

  // 下载PNG
  const downloadPNG = () => {
    if (!canvasRef.current) return;
    const url = canvasRef.current.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `qrcode-${Date.now()}.png`;
    link.href = url;
    link.click();
  };

  // 下载SVG (基础版本，不包含高级样式)
  const downloadSVG = async () => {
    const content = generateQRContent();
    if (!content) return;

    try {
      const svg = await QRCode.toString(content, {
        type: 'svg',
        width: qrOptions.size,
        margin: 2,
        color: {
          dark: qrOptions.fgColor,
          light: qrOptions.bgColor,
        },
        errorCorrectionLevel: qrOptions.errorCorrectionLevel,
      });

      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `qrcode-${Date.now()}.svg`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('SVG generation error:', error);
    }
  };

  // 复制到剪贴板
  const copyToClipboard = async () => {
    if (!canvasRef.current) return;

    try {
      canvasRef.current.toBlob(async (blob) => {
        if (blob) {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }
      });
    } catch (error) {
      console.error('Copy error:', error);
    }
  };

  // 切换类型时设置默认示例数据
  const handleTypeChange = (newType: QRType) => {
    setQrType(newType);

    switch (newType) {
      case 'text':
        setQrData({ text: 'Hello World' });
        break;
      case 'url':
        setQrData({ url: 'https://example.com' });
        break;
      case 'vcard':
        setQrData({
          name: '张三',
          phone: '13800138000',
          email: 'zhangsan@example.com',
          company: '示例公司',
          title: '产品经理',
        });
        break;
      case 'wifi':
        setQrData({
          ssid: 'MyWiFi',
          password: '12345678',
          encryption: 'WPA',
          hidden: false,
        });
        break;
      case 'phone':
        setQrData({ phone: '13800138000' });
        break;
      case 'sms':
        setQrData({ smsNumber: '13800138000', smsBody: '你好' });
        break;
      case 'email':
        setQrData({
          email: 'example@example.com',
          emailSubject: '你好',
          emailBody: '这是邮件内容',
        });
        break;
      case 'location':
        setQrData({ latitude: '39.9042', longitude: '116.4074', locationName: '北京天安门' });
        break;
      default:
        setQrData({});
    }
  };

  // 渲染表单 (继续下一部分...)

  // 渲染表单
  const renderForm = () => {
    switch (qrType) {
      case 'text':
        return (
          <textarea
            value={qrData.text || ''}
            onChange={(e) => setQrData({ ...qrData, text: e.target.value })}
            className="w-full h-32 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="输入文本内容..."
          />
        );

      case 'url':
        return (
          <input
            type="url"
            value={qrData.url || ''}
            onChange={(e) => setQrData({ ...qrData, url: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="https://example.com"
          />
        );

      case 'vcard':
        return (
          <div className="space-y-3">
            <input
              type="text"
              value={qrData.name || ''}
              onChange={(e) => setQrData({ ...qrData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="姓名"
            />
            <input
              type="tel"
              value={qrData.phone || ''}
              onChange={(e) => setQrData({ ...qrData, phone: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="电话"
            />
            <input
              type="email"
              value={qrData.email || ''}
              onChange={(e) => setQrData({ ...qrData, email: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="邮箱"
            />
            <input
              type="text"
              value={qrData.company || ''}
              onChange={(e) => setQrData({ ...qrData, company: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="公司"
            />
            <input
              type="text"
              value={qrData.title || ''}
              onChange={(e) => setQrData({ ...qrData, title: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="职位"
            />
            <input
              type="url"
              value={qrData.website || ''}
              onChange={(e) => setQrData({ ...qrData, website: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="网址"
            />
            <input
              type="text"
              value={qrData.address || ''}
              onChange={(e) => setQrData({ ...qrData, address: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="地址"
            />
          </div>
        );

      case 'wifi':
        return (
          <div className="space-y-3">
            <input
              type="text"
              value={qrData.ssid || ''}
              onChange={(e) => setQrData({ ...qrData, ssid: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="WiFi 名称 (SSID)"
            />
            <input
              type="text"
              value={qrData.password || ''}
              onChange={(e) => setQrData({ ...qrData, password: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="密码"
            />
            <select
              value={qrData.encryption || 'WPA'}
              onChange={(e) => setQrData({ ...qrData, encryption: e.target.value as any })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="WPA">WPA/WPA2</option>
              <option value="WEP">WEP</option>
              <option value="nopass">无密码</option>
            </select>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={qrData.hidden || false}
                onChange={(e) => setQrData({ ...qrData, hidden: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">隐藏网络</span>
            </label>
          </div>
        );

      case 'phone':
        return (
          <input
            type="tel"
            value={qrData.phone || ''}
            onChange={(e) => setQrData({ ...qrData, phone: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="电话号码"
          />
        );

      case 'sms':
        return (
          <div className="space-y-3">
            <input
              type="tel"
              value={qrData.smsNumber || ''}
              onChange={(e) => setQrData({ ...qrData, smsNumber: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="收件人号码"
            />
            <textarea
              value={qrData.smsBody || ''}
              onChange={(e) => setQrData({ ...qrData, smsBody: e.target.value })}
              className="w-full h-24 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="短信内容"
            />
          </div>
        );

      case 'email':
        return (
          <div className="space-y-3">
            <input
              type="email"
              value={qrData.email || ''}
              onChange={(e) => setQrData({ ...qrData, email: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="邮箱地址"
            />
            <input
              type="text"
              value={qrData.emailSubject || ''}
              onChange={(e) => setQrData({ ...qrData, emailSubject: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="邮件主题（可选）"
            />
            <textarea
              value={qrData.emailBody || ''}
              onChange={(e) => setQrData({ ...qrData, emailBody: e.target.value })}
              className="w-full h-24 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="邮件正文（可选）"
            />
          </div>
        );

      case 'location':
        return (
          <div className="space-y-3">
            <input
              type="text"
              value={qrData.latitude || ''}
              onChange={(e) => setQrData({ ...qrData, latitude: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="纬度 (例如: 39.9042)"
            />
            <input
              type="text"
              value={qrData.longitude || ''}
              onChange={(e) => setQrData({ ...qrData, longitude: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="经度 (例如: 116.4074)"
            />
            <input
              type="text"
              value={qrData.locationName || ''}
              onChange={(e) => setQrData({ ...qrData, locationName: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="地点名称（可选）"
            />
          </div>
        );

      default:
        return null;
    }
  };

  if (!ready) return null;

  const types = [
    { id: 'text' as QRType, name: '文本', icon: '📝' },
    { id: 'url' as QRType, name: 'URL', icon: '🔗' },
    { id: 'vcard' as QRType, name: '名片', icon: '👤' },
    { id: 'wifi' as QRType, name: 'WiFi', icon: '📶' },
    { id: 'phone' as QRType, name: '电话', icon: '📞' },
    { id: 'sms' as QRType, name: '短信', icon: '💬' },
    { id: 'email' as QRType, name: '邮件', icon: '📧' },
    { id: 'location' as QRType, name: '位置', icon: '📍' },
  ];

  const styles = [
    { id: 'square' as QRStyle, name: '方形', preview: '■' },
    { id: 'rounded' as QRStyle, name: '圆角', preview: '▢' },
    { id: 'dots' as QRStyle, name: '圆点', preview: '●' },
    { id: 'fluid' as QRStyle, name: '流体', preview: '◉' },
  ];

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900">
      <ToolHeader icon="🎨" title="二维码生成器" />

      {/* 类型选择 */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 overflow-x-auto">
        {types.map((type) => (
          <button
            key={type.id}
            onClick={() => handleTypeChange(type.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
              qrType === type.id
                ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400 bg-white dark:bg-gray-900'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            <span>{type.icon}</span>
            {type.name}
          </button>
        ))}
      </div>

      {/* 主内容区 */}
      <div className="flex-1 overflow-auto">
        <div className="grid grid-cols-2 gap-6 p-6 h-full">
          {/* 左侧：输入区 */}
          <div className="space-y-4 overflow-auto">
            {/* 输入内容 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
                输入内容
              </h3>
              {renderForm()}
            </div>

            {/* 样式设置 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
                样式设置
              </h3>
              <div className="space-y-4">
                {/* 二维码样式 */}
                <div>
                  <label className="block text-xs text-gray-600 dark:text-gray-400 mb-2">
                    二维码样式
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {styles.map((style) => (
                      <button
                        key={style.id}
                        onClick={() => setQrOptions({ ...qrOptions, style: style.id })}
                        className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                          qrOptions.style === style.id
                            ? 'bg-blue-500 text-white'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                      >
                        <div className="text-lg">{style.preview}</div>
                        <div className="text-xs mt-1">{style.name}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 大小 */}
                <div>
                  <label className="block text-xs text-gray-600 dark:text-gray-400 mb-2">
                    大小: {qrOptions.size}px
                  </label>
                  <input
                    type="range"
                    min="200"
                    max="600"
                    value={qrOptions.size}
                    onChange={(e) => setQrOptions({ ...qrOptions, size: parseInt(e.target.value) })}
                    className="w-full"
                  />
                </div>

                {/* 圆角 (仅rounded样式) */}
                {qrOptions.style === 'rounded' && (
                  <div>
                    <label className="block text-xs text-gray-600 dark:text-gray-400 mb-2">
                      圆角: {(qrOptions.cornerRadius * 100).toFixed(0)}%
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="0.5"
                      step="0.05"
                      value={qrOptions.cornerRadius}
                      onChange={(e) =>
                        setQrOptions({ ...qrOptions, cornerRadius: parseFloat(e.target.value) })
                      }
                      className="w-full"
                    />
                  </div>
                )}

                {/* 点大小 (仅dots样式) */}
                {qrOptions.style === 'dots' && (
                  <div>
                    <label className="block text-xs text-gray-600 dark:text-gray-400 mb-2">
                      点大小: {(qrOptions.dotScale * 100).toFixed(0)}%
                    </label>
                    <input
                      type="range"
                      min="0.5"
                      max="1"
                      step="0.05"
                      value={qrOptions.dotScale}
                      onChange={(e) =>
                        setQrOptions({ ...qrOptions, dotScale: parseFloat(e.target.value) })
                      }
                      className="w-full"
                    />
                  </div>
                )}

                {/* 颜色 */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 dark:text-gray-400 mb-2">
                      前景色
                    </label>
                    <input
                      type="color"
                      value={qrOptions.fgColor}
                      onChange={(e) => setQrOptions({ ...qrOptions, fgColor: e.target.value })}
                      className="w-full h-10 rounded border border-gray-300 dark:border-gray-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 dark:text-gray-400 mb-2">
                      背景色
                    </label>
                    <input
                      type="color"
                      value={qrOptions.bgColor}
                      onChange={(e) => setQrOptions({ ...qrOptions, bgColor: e.target.value })}
                      className="w-full h-10 rounded border border-gray-300 dark:border-gray-600"
                    />
                  </div>
                </div>

                {/* 渐变 */}
                <div>
                  <label className="flex items-center gap-2 cursor-pointer mb-2">
                    <input
                      type="checkbox"
                      checked={qrOptions.gradient}
                      onChange={(e) => setQrOptions({ ...qrOptions, gradient: e.target.checked })}
                      className="rounded"
                    />
                    <span className="text-xs text-gray-600 dark:text-gray-400">启用渐变</span>
                  </label>
                  {qrOptions.gradient && (
                    <div className="space-y-3 pl-6">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-400 mb-2">
                            渐变色
                          </label>
                          <input
                            type="color"
                            value={qrOptions.gradientColor}
                            onChange={(e) =>
                              setQrOptions({ ...qrOptions, gradientColor: e.target.value })
                            }
                            className="w-full h-10 rounded border border-gray-300 dark:border-gray-600"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 dark:text-gray-400 mb-2">
                            渐变类型
                          </label>
                          <select
                            value={qrOptions.gradientType}
                            onChange={(e) =>
                              setQrOptions({
                                ...qrOptions,
                                gradientType: e.target.value as any,
                              })
                            }
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="linear">线性</option>
                            <option value="radial">径向</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* 容错级别 */}
                <div>
                  <label className="block text-xs text-gray-600 dark:text-gray-400 mb-2">
                    容错级别 {logoImage && '(建议使用高容错)'}
                  </label>
                  <select
                    value={qrOptions.errorCorrectionLevel}
                    onChange={(e) =>
                      setQrOptions({
                        ...qrOptions,
                        errorCorrectionLevel: e.target.value as any,
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="L">低 (7%)</option>
                    <option value="M">中 (15%)</option>
                    <option value="Q">较高 (25%)</option>
                    <option value="H">高 (30%)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Logo设置 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
                Logo 设置
              </h3>
              <div className="space-y-3">
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                  className="hidden"
                />
                {!logoImage ? (
                  <button
                    onClick={() => logoInputRef.current?.click()}
                    className="w-full px-4 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium flex items-center justify-center gap-2"
                  >
                    <Upload size={18} />
                    上传 Logo
                  </button>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <img
                        src={logoImage.src}
                        alt="Logo"
                        className="w-16 h-16 object-contain border border-gray-200 dark:border-gray-700 rounded"
                      />
                      <button
                        onClick={removeLogo}
                        className="px-3 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors text-sm flex items-center gap-2"
                      >
                        <Trash2 size={14} />
                        删除
                      </button>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 dark:text-gray-400 mb-2">
                        Logo 大小: {qrOptions.logoSize}px
                      </label>
                      <input
                        type="range"
                        min="40"
                        max="120"
                        value={qrOptions.logoSize}
                        onChange={(e) =>
                          setQrOptions({ ...qrOptions, logoSize: parseInt(e.target.value) })
                        }
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 dark:text-gray-400 mb-2">
                        Logo 边距: {qrOptions.logoPadding}px
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="20"
                        value={qrOptions.logoPadding}
                        onChange={(e) =>
                          setQrOptions({ ...qrOptions, logoPadding: parseInt(e.target.value) })
                        }
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 dark:text-gray-400 mb-2">
                        Logo 背景色
                      </label>
                      <input
                        type="color"
                        value={qrOptions.logoBackgroundColor}
                        onChange={(e) =>
                          setQrOptions({ ...qrOptions, logoBackgroundColor: e.target.value })
                        }
                        className="w-full h-10 rounded border border-gray-300 dark:border-gray-600"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 右侧：预览区 */}
          <div className="space-y-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
                实时预览
              </h3>
              <div className="flex items-center justify-center mb-4">
                <canvas
                  ref={canvasRef}
                  className="border border-gray-200 dark:border-gray-700 rounded-lg"
                />
              </div>
              {/* 显示生成的内容 */}
              <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">生成内容：</div>
                <div className="text-xs text-gray-700 dark:text-gray-300 font-mono break-all max-h-32 overflow-auto">
                  {generateQRContent() || '请输入内容...'}
                </div>
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={downloadPNG}
                className="px-4 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium flex items-center justify-center gap-2"
              >
                <Download size={18} />
                PNG
              </button>
              <button
                onClick={downloadSVG}
                className="px-4 py-3 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors font-medium flex items-center justify-center gap-2"
              >
                <Download size={18} />
                SVG
              </button>
              <button
                onClick={copyToClipboard}
                className={`px-4 py-3 rounded-lg transition-colors font-medium flex items-center justify-center gap-2 ${
                  copied
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                {copied ? <Check size={18} /> : <Copy size={18} />}
                {copied ? '已复制' : '复制'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
