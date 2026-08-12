import { useState, useEffect } from 'react';
import { Delete } from 'lucide-react';
import { useToolTheme } from './useToolTheme';
import ToolHeader from './ToolHeader';

const BUTTONS = [
  ['C', '±', '%', '÷'],
  ['7', '8', '9', '×'],
  ['4', '5', '6', '−'],
  ['1', '2', '3', '+'],
  ['0', '.', '='],
];

export default function CalculatorTool() {
  const ready = useToolTheme();
  const [display, setDisplay] = useState('0');
  const [prev, setPrev] = useState<string | null>(null);
  const [op, setOp] = useState<string | null>(null);
  const [waitNext, setWaitNext] = useState(false);

  const handleNumber = (n: string) => {
    if (waitNext) {
      setDisplay(n === '.' ? '0.' : n);
      setWaitNext(false);
    } else {
      if (n === '.' && display.includes('.')) return;
      setDisplay(display === '0' && n !== '.' ? n : display + n);
    }
  };

  const handleOp = (o: string) => {
    if (prev !== null && !waitNext) {
      const result = calculate(parseFloat(prev), parseFloat(display), op!);
      setDisplay(fmt(result));
      setPrev(fmt(result));
    } else {
      setPrev(display);
    }
    setOp(o);
    setWaitNext(true);
  };

  const handleEquals = () => {
    if (prev === null || op === null) return;
    const result = calculate(parseFloat(prev), parseFloat(display), op);
    setDisplay(fmt(result));
    setPrev(null);
    setOp(null);
    setWaitNext(true);
  };

  const handleClear = () => {
    setDisplay('0');
    setPrev(null);
    setOp(null);
    setWaitNext(false);
  };

  const handleToggleSign = () => {
    setDisplay(display.startsWith('-') ? display.slice(1) : '-' + display);
  };

  const handlePercent = () => {
    setDisplay(fmt(parseFloat(display) / 100));
  };

  const handleDelete = () => {
    if (display.length <= 1 || (display.length === 2 && display.startsWith('-'))) {
      setDisplay('0');
    } else {
      setDisplay(display.slice(0, -1));
    }
  };

  const handleBtn = (btn: string) => {
    if ('0123456789.'.includes(btn)) return handleNumber(btn);
    if (btn === 'C') return handleClear();
    if (btn === '±') return handleToggleSign();
    if (btn === '%') return handlePercent();
    if (btn === '=') return handleEquals();
    if ('÷×−+'.includes(btn)) return handleOp(btn);
  };

  // 键盘支持
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 阻止 Enter/Escape/Space 触发按钮默认行为
      if (['Enter', 'Escape', ' '].includes(e.key)) e.preventDefault();

      if (e.key >= '0' && e.key <= '9') return handleNumber(e.key);
      if (e.key === '.') return handleNumber('.');
      if (e.key === '+') return handleOp('+');
      if (e.key === '-') return handleOp('−');
      if (e.key === '*') return handleOp('×');
      if (e.key === '/') {
        e.preventDefault();
        return handleOp('÷');
      }
      if (e.key === 'Enter' || e.key === '=') return handleEquals();
      if (e.key === 'Backspace') return handleDelete();
      if (e.key === 'Escape') return handleClear(); // Escape 只清空，不关闭
      if (e.key === '%') return handlePercent();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const isOp = (btn: string) => '÷×−+='.includes(btn);
  const isSpecial = (btn: string) => ['C', '±', '%'].includes(btn);

  if (!ready) return null;

  return (
    <div className="flex flex-col h-screen bg-gray-900 rounded-2xl overflow-hidden select-none">
      <ToolHeader icon="🧮" title="计算器" closeMode="hide" />

      {/* 显示区 */}
      <div className="flex-1 flex flex-col justify-end px-5 pb-3" data-tauri-drag-region>
        {/* 运算提示 */}
        <div className="text-right text-gray-500 text-sm h-6 truncate">
          {prev !== null ? `${prev} ${op}` : ''}
        </div>
        {/* 主显示 */}
        <div
          className="text-right text-white font-light leading-none truncate"
          style={{
            fontSize: display.length > 10 ? '2rem' : display.length > 7 ? '2.8rem' : '3.5rem',
          }}
        >
          {display}
        </div>
      </div>

      {/* 按键区 */}
      <div className="flex flex-col px-3 pb-4 gap-2">
        {/* 退格键 */}
        <div className="flex justify-end px-1">
          <button
            onClick={handleDelete}
            className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
          >
            <Delete size={18} />
          </button>
        </div>

        {BUTTONS.map((row, ri) => (
          <div
            key={ri}
            className={`grid gap-2 ${row.length === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}
          >
            {row.map((btn) => (
              <button
                key={btn}
                onClick={() => handleBtn(btn)}
                className={`
                  h-14 rounded-2xl text-xl font-medium transition-all active:scale-95
                  ${btn === '0' && row.length === 3 ? 'col-span-1' : ''}
                  ${
                    btn === '='
                      ? 'bg-blue-500 hover:bg-blue-400 text-white'
                      : isOp(btn)
                        ? 'bg-amber-500 hover:bg-amber-400 text-white'
                        : isSpecial(btn)
                          ? 'bg-gray-600 hover:bg-gray-500 text-white'
                          : 'bg-gray-700 hover:bg-gray-600 text-white'
                  }
                `}
              >
                {btn}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function calculate(a: number, b: number, op: string): number {
  switch (op) {
    case '+':
      return a + b;
    case '−':
      return a - b;
    case '×':
      return a * b;
    case '÷':
      return b !== 0 ? a / b : 0;
    default:
      return b;
  }
}

function fmt(n: number): string {
  if (!isFinite(n)) return '错误';
  const s = parseFloat(n.toPrecision(12)).toString();
  return s;
}
