import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'

interface SortHeaderProps {
  label: string
  sortKey: string
  activeKey: string | null
  activeDir: 'asc' | 'desc' | null
  onToggle: (key: string) => void
  className?: string
}

export default function SortHeader({ label, sortKey, activeKey, activeDir, onToggle, className = '' }: SortHeaderProps) {
  const isActive = activeKey === sortKey && activeDir !== null
  const Icon = !isActive ? ChevronsUpDown : activeDir === 'asc' ? ChevronUp : ChevronDown

  return (
    <th className={`table-header sticky top-0 z-10 ${className}`}>
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        className={`flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200 transition-colors ${
          isActive ? 'text-gray-900 dark:text-gray-100' : ''
        }`}
      >
        <span>{label}</span>
        <Icon className={`w-3 h-3 ${isActive ? 'opacity-100' : 'opacity-40'}`} />
      </button>
    </th>
  )
}
