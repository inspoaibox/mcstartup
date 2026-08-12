// 随机生成工具 - UUID、密码、Token、NanoID 等
import { useState } from 'react';
import { Copy, Check, RefreshCw, Dices, Key, Hash, Shield } from 'lucide-react';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';

type GeneratorType =
  | 'uuid'
  | 'nanoid'
  | 'password'
  | 'token'
  | 'apikey'
  | 'jwt-secret'
  | 'hash'
  | 'guid'
  | 'snowflake'
  | 'ulid'
  | 'random-number'
  | 'random-string';

interface GeneratorConfig {
  // 通用
  count: number;

  // 密码
  passwordLength: number;
  includeUppercase: boolean;
  includeLowercase: boolean;
  includeNumbers: boolean;
  includeSymbols: boolean;
  excludeSimilar: boolean;
  excludeAmbiguous: boolean;

  // Token/API Key
  tokenLength: number;
  tokenFormat: 'hex' | 'base64' | 'alphanumeric';

  // NanoID
  nanoIdLength: number;
  nanoIdAlphabet: string;

  // 随机数
  numberMin: number;
  numberMax: number;
  numberDecimals: number;

  // 随机字符串
  stringLength: number;
  stringCharset: string;
}

export default function RandomGeneratorTool() {
  const ready = useToolTheme();
  const [activeType, setActiveType] = useState<GeneratorType>('uuid');
  const [results, setResults] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const [config, setConfig] = useState<GeneratorConfig>({
    count: 10,
    passwordLength: 16,
    includeUppercase: true,
    includeLowercase: true,
    includeNumbers: true,
    includeSymbols: true,
    excludeSimilar: false,
    excludeAmbiguous: false,
    tokenLength: 32,
    tokenFormat: 'hex',
    nanoIdLength: 21,
    nanoIdAlphabet: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
    numberMin: 0,
    numberMax: 100,
    numberDecimals: 0,
    stringLength: 16,
    stringCharset: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  });

  // UUID v4
  const generateUUID = (): string => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };

  // GUID (同 UUID 但大写)
  const generateGUID = (): string => {
    return generateUUID().toUpperCase();
  };

  // NanoID
  const generateNanoID = (length: number, alphabet: string): string => {
    let result = '';
    for (let i = 0; i < length; i++) {
      result += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return result;
  };

  // ULID (Universally Unique Lexicographically Sortable Identifier)
  const generateULID = (): string => {
    const timestamp = Date.now();
    const timeChars = timestamp.toString(32).padStart(10, '0');
    const randomChars = generateNanoID(16, '0123456789ABCDEFGHJKMNPQRSTVWXYZ');
    return (timeChars + randomChars).toUpperCase();
  };

  // Snowflake ID (简化版)
  const generateSnowflake = (): string => {
    const timestamp = Date.now() - 1609459200000; // 2021-01-01 起始
    const workerId = Math.floor(Math.random() * 32);
    const sequence = Math.floor(Math.random() * 4096);
    const id = (timestamp << 22) | (workerId << 12) | sequence;
    return id.toString();
  };

  // 密码生成
  const generatePassword = (): string => {
    let charset = '';
    if (config.includeLowercase) charset += 'abcdefghijklmnopqrstuvwxyz';
    if (config.includeUppercase) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (config.includeNumbers) charset += '0123456789';
    if (config.includeSymbols) charset += '!@#$%^&*()_+-=[]{}|;:,.<>?';

    if (config.excludeSimilar) {
      charset = charset.replace(/[il1Lo0O]/g, '');
    }
    if (config.excludeAmbiguous) {
      charset = charset.replace(/[{}[\]()\/\\'"~,;:.<>]/g, '');
    }

    if (!charset) return '';

    let password = '';
    for (let i = 0; i < config.passwordLength; i++) {
      password += charset[Math.floor(Math.random() * charset.length)];
    }
    return password;
  };

  // Token 生成
  const generateToken = (): string => {
    const bytes = new Uint8Array(config.tokenLength);
    crypto.getRandomValues(bytes);

    if (config.tokenFormat === 'hex') {
      return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } else if (config.tokenFormat === 'base64') {
      return btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
    } else {
      // alphanumeric
      const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      return Array.from(bytes)
        .map((b) => charset[b % charset.length])
        .join('');
    }
  };

  // API Key 生成 (格式: prefix_randompart)
  const generateAPIKey = (): string => {
    const prefix = 'sk';
    const randomPart = generateToken();
    return `${prefix}_${randomPart}`;
  };

  // JWT Secret 生成
  const generateJWTSecret = (): string => {
    const bytes = new Uint8Array(64);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes));
  };

  // Hash 生成 (模拟)
  const generateHash = async (): Promise<string> => {
    const randomData = generateToken();
    const encoder = new TextEncoder();
    const data = encoder.encode(randomData);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  };

  // 随机数生成
  const generateRandomNumber = (): string => {
    const range = config.numberMax - config.numberMin;
    const random = Math.random() * range + config.numberMin;
    return config.numberDecimals > 0
      ? random.toFixed(config.numberDecimals)
      : Math.floor(random).toString();
  };

  // 随机字符串生成
  const generateRandomString = (): string => {
    return generateNanoID(config.stringLength, config.stringCharset);
  };

  // 生成
  const handleGenerate = async () => {
    const newResults: string[] = [];

    for (let i = 0; i < config.count; i++) {
      let result = '';

      switch (activeType) {
        case 'uuid':
          result = generateUUID();
          break;
        case 'guid':
          result = generateGUID();
          break;
        case 'nanoid':
          result = generateNanoID(config.nanoIdLength, config.nanoIdAlphabet);
          break;
        case 'ulid':
          result = generateULID();
          break;
        case 'snowflake':
          result = generateSnowflake();
          break;
        case 'password':
          result = generatePassword();
          break;
        case 'token':
          result = generateToken();
          break;
        case 'apikey':
          result = generateAPIKey();
          break;
        case 'jwt-secret':
          result = generateJWTSecret();
          break;
        case 'hash':
          result = await generateHash();
          break;
        case 'random-number':
          result = generateRandomNumber();
          break;
        case 'random-string':
          result = generateRandomString();
          break;
      }

      newResults.push(result);
    }

    setResults(newResults);
  };

  // 复制
  const copyResults = async () => {
    try {
      await navigator.clipboard.writeText(results.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      alert('复制失败');
    }
  };

  const copyOne = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      alert('复制失败');
    }
  };

  if (!ready) return null;

  const generators = [
    { id: 'uuid' as GeneratorType, name: 'UUID v4', icon: Hash, desc: '标准 UUID 格式' },
    { id: 'guid' as GeneratorType, name: 'GUID', icon: Hash, desc: 'UUID 大写格式' },
    { id: 'nanoid' as GeneratorType, name: 'NanoID', icon: Hash, desc: '短小精悍的 ID' },
    { id: 'ulid' as GeneratorType, name: 'ULID', icon: Hash, desc: '可排序的唯一 ID' },
    { id: 'snowflake' as GeneratorType, name: 'Snowflake ID', icon: Hash, desc: '分布式 ID' },
    { id: 'password' as GeneratorType, name: '随机密码', icon: Key, desc: '强密码生成' },
    { id: 'token' as GeneratorType, name: 'Token', icon: Shield, desc: '访问令牌' },
    { id: 'apikey' as GeneratorType, name: 'API Key', icon: Key, desc: 'API 密钥' },
    { id: 'jwt-secret' as GeneratorType, name: 'JWT Secret', icon: Shield, desc: 'JWT 签名密钥' },
    { id: 'hash' as GeneratorType, name: 'Hash', icon: Hash, desc: 'SHA-256 哈希' },
    { id: 'random-number' as GeneratorType, name: '随机数', icon: Dices, desc: '指定范围随机数' },
    { id: 'random-string' as GeneratorType, name: '随机字符串', icon: Dices, desc: '自定义字符集' },
  ];

  return (
    <div className="flex h-screen bg-white dark:bg-gray-900">
      {/* 左侧：生成器选择 */}
      <div className="w-64 border-r border-gray-200 dark:border-gray-800 flex flex-col bg-gray-50 dark:bg-gray-800">
        <div
          className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800"
          data-tauri-drag-region
        >
          <div className="flex items-center gap-2" data-tauri-drag-region>
            <Dices className="text-green-500" size={20} />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">随机生成</span>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-3 space-y-1">
          {generators.map((gen) => (
            <button
              key={gen.id}
              onClick={() => setActiveType(gen.id)}
              className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors ${
                activeType === gen.id
                  ? 'bg-green-500 text-white'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <gen.icon size={16} />
                <span className="text-sm font-medium">{gen.name}</span>
              </div>
              <div
                className={`text-xs ${activeType === gen.id ? 'text-green-100' : 'text-gray-500'}`}
              >
                {gen.desc}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 右侧：配置和结果 */}
      <div className="flex-1 flex flex-col">
        <ToolHeader icon={<Dices className="text-green-500" size={18} />} title={generators.find((g) => g.id === activeType)?.name || '随机生成'} />

        {/* 配置区域 */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800">
          <div className="space-y-4">
            {/* 通用：生成数量 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                生成数量
              </label>
              <input
                type="number"
                min="1"
                max="100"
                value={config.count}
                onChange={(e) => setConfig({ ...config, count: parseInt(e.target.value) || 1 })}
                className="w-32 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm"
              />
            </div>

            {/* 密码配置 */}
            {activeType === 'password' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    密码长度
                  </label>
                  <input
                    type="number"
                    min="4"
                    max="128"
                    value={config.passwordLength}
                    onChange={(e) =>
                      setConfig({ ...config, passwordLength: parseInt(e.target.value) || 16 })
                    }
                    className="w-32 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.includeUppercase}
                      onChange={(e) => setConfig({ ...config, includeUppercase: e.target.checked })}
                      className="rounded"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      包含大写字母 (A-Z)
                    </span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.includeLowercase}
                      onChange={(e) => setConfig({ ...config, includeLowercase: e.target.checked })}
                      className="rounded"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      包含小写字母 (a-z)
                    </span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.includeNumbers}
                      onChange={(e) => setConfig({ ...config, includeNumbers: e.target.checked })}
                      className="rounded"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">包含数字 (0-9)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.includeSymbols}
                      onChange={(e) => setConfig({ ...config, includeSymbols: e.target.checked })}
                      className="rounded"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      包含符号 (!@#$...)
                    </span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.excludeSimilar}
                      onChange={(e) => setConfig({ ...config, excludeSimilar: e.target.checked })}
                      className="rounded"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      排除相似字符 (il1Lo0O)
                    </span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.excludeAmbiguous}
                      onChange={(e) => setConfig({ ...config, excludeAmbiguous: e.target.checked })}
                      className="rounded"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      排除歧义符号 ({`{}[]()...`})
                    </span>
                  </label>
                </div>
              </>
            )}

            {/* NanoID 配置 */}
            {activeType === 'nanoid' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    ID 长度
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="128"
                    value={config.nanoIdLength}
                    onChange={(e) =>
                      setConfig({ ...config, nanoIdLength: parseInt(e.target.value) || 21 })
                    }
                    className="w-32 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    字符集
                  </label>
                  <input
                    type="text"
                    value={config.nanoIdAlphabet}
                    onChange={(e) => setConfig({ ...config, nanoIdAlphabet: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm font-mono"
                  />
                </div>
              </>
            )}

            {/* Token 配置 */}
            {(activeType === 'token' || activeType === 'apikey') && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Token 长度
                  </label>
                  <input
                    type="number"
                    min="8"
                    max="128"
                    value={config.tokenLength}
                    onChange={(e) =>
                      setConfig({ ...config, tokenLength: parseInt(e.target.value) || 32 })
                    }
                    className="w-32 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    格式
                  </label>
                  <select
                    value={config.tokenFormat}
                    onChange={(e) => setConfig({ ...config, tokenFormat: e.target.value as any })}
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm"
                  >
                    <option value="hex">Hex (十六进制)</option>
                    <option value="base64">Base64</option>
                    <option value="alphanumeric">字母数字</option>
                  </select>
                </div>
              </>
            )}

            {/* 随机数配置 */}
            {activeType === 'random-number' && (
              <>
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      最小值
                    </label>
                    <input
                      type="number"
                      value={config.numberMin}
                      onChange={(e) =>
                        setConfig({ ...config, numberMin: parseFloat(e.target.value) || 0 })
                      }
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      最大值
                    </label>
                    <input
                      type="number"
                      value={config.numberMax}
                      onChange={(e) =>
                        setConfig({ ...config, numberMax: parseFloat(e.target.value) || 100 })
                      }
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    小数位数
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="10"
                    value={config.numberDecimals}
                    onChange={(e) =>
                      setConfig({ ...config, numberDecimals: parseInt(e.target.value) || 0 })
                    }
                    className="w-32 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm"
                  />
                </div>
              </>
            )}

            {/* 随机字符串配置 */}
            {activeType === 'random-string' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    字符串长度
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="256"
                    value={config.stringLength}
                    onChange={(e) =>
                      setConfig({ ...config, stringLength: parseInt(e.target.value) || 16 })
                    }
                    className="w-32 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    字符集
                  </label>
                  <input
                    type="text"
                    value={config.stringCharset}
                    onChange={(e) => setConfig({ ...config, stringCharset: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm font-mono"
                  />
                </div>
              </>
            )}
          </div>

          {/* 生成按钮 */}
          <button
            onClick={handleGenerate}
            className="mt-4 w-full px-4 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-medium flex items-center justify-center gap-2"
          >
            <RefreshCw size={18} />
            生成
          </button>
        </div>

        {/* 结果区域 */}
        <div className="flex-1 flex flex-col p-4 overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              生成结果 {results.length > 0 && `(${results.length})`}
            </span>
            {results.length > 0 && (
              <button
                onClick={copyResults}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? '已复制全部' : '复制全部'}
              </button>
            )}
          </div>

          <div className="flex-1 overflow-auto space-y-2">
            {results.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                点击"生成"按钮开始
              </div>
            ) : (
              results.map((result, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 group"
                >
                  <span className="flex-1 font-mono text-sm text-gray-900 dark:text-gray-100 break-all">
                    {result}
                  </span>
                  <button
                    onClick={() => copyOne(result)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-400 hover:text-green-600 dark:hover:text-green-400 transition-all"
                  >
                    <Copy size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
