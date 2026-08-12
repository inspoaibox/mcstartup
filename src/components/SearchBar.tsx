import { Search } from 'lucide-react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export default function SearchBar({ value, onChange }: SearchBarProps) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="搜索项目名称、别名或描述..."
        className="w-full pl-10 pr-4 py-2.5 input-field rounded-lg text-gray-900 dark:text-white placeholder-gray-400"
      />
    </div>
  );
}
