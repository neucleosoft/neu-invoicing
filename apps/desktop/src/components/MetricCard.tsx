import { LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'

type Tone = 'green' | 'red' | 'blue' | 'orange' | 'indigo' | 'rose'

const TONE: Record<Tone, { card: string; label: string; value: string; iconBg: string; iconFg: string }> = {
  green: {
    card: 'bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-900/5 dark:border dark:border-green-900/30',
    label: 'text-green-700 dark:text-green-300',
    value: 'text-green-800 dark:text-green-200',
    iconBg: 'bg-green-200/70 dark:bg-green-800/40',
    iconFg: 'text-green-700 dark:text-green-300',
  },
  red: {
    card: 'bg-gradient-to-br from-red-50 to-red-100 dark:from-red-900/20 dark:to-red-900/5 dark:border dark:border-red-900/30',
    label: 'text-red-700 dark:text-red-300',
    value: 'text-red-800 dark:text-red-200',
    iconBg: 'bg-red-200/70 dark:bg-red-800/40',
    iconFg: 'text-red-700 dark:text-red-300',
  },
  blue: {
    card: 'bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-900/5 dark:border dark:border-blue-900/30',
    label: 'text-blue-700 dark:text-blue-300',
    value: 'text-blue-800 dark:text-blue-200',
    iconBg: 'bg-blue-200/70 dark:bg-blue-800/40',
    iconFg: 'text-blue-700 dark:text-blue-300',
  },
  orange: {
    card: 'bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-900/5 dark:border dark:border-orange-900/30',
    label: 'text-orange-700 dark:text-orange-300',
    value: 'text-orange-800 dark:text-orange-200',
    iconBg: 'bg-orange-200/70 dark:bg-orange-800/40',
    iconFg: 'text-orange-700 dark:text-orange-300',
  },
  indigo: {
    card: 'bg-gradient-to-br from-indigo-50 to-indigo-100 dark:from-indigo-900/20 dark:to-indigo-900/5 dark:border dark:border-indigo-900/30',
    label: 'text-indigo-700 dark:text-indigo-300',
    value: 'text-indigo-800 dark:text-indigo-200',
    iconBg: 'bg-indigo-200/70 dark:bg-indigo-800/40',
    iconFg: 'text-indigo-700 dark:text-indigo-300',
  },
  rose: {
    card: 'bg-gradient-to-br from-rose-50 to-rose-100 dark:from-rose-900/20 dark:to-rose-900/5 dark:border dark:border-rose-900/30',
    label: 'text-rose-700 dark:text-rose-300',
    value: 'text-rose-800 dark:text-rose-200',
    iconBg: 'bg-rose-200/70 dark:bg-rose-800/40',
    iconFg: 'text-rose-700 dark:text-rose-300',
  },
}

const valueSize = (value: string | number): string => {
  const len = String(value).length
  if (len >= 15) return 'text-sm'
  if (len >= 13) return 'text-base'
  if (len >= 11) return 'text-lg'
  return 'text-xl'
}

interface Props {
  label: string
  value: string | number
  icon: LucideIcon
  tone: Tone
  to?: string
  hint?: string
}

const MetricCard = ({ label, value, icon: Icon, tone, to, hint }: Props) => {
  const t = TONE[tone]
  const inner = (
    <div className={`relative overflow-hidden rounded-xl p-4 ${t.card} transition-shadow hover:shadow-md flex flex-col h-full`}>
      <div className={`inline-flex items-center justify-center w-8 h-8 rounded-lg ${t.iconBg} mb-3`}>
        <Icon className={`w-4 h-4 ${t.iconFg}`} strokeWidth={2} />
      </div>
      <p className={`text-[11px] font-semibold uppercase tracking-wider ${t.label} leading-snug break-words`}>
        {label}
      </p>
      <p className={`${valueSize(value)} font-bold ${t.value} mt-1 leading-tight break-words`}>
        {value}
      </p>
      {hint && (
        <p className={`text-[11px] mt-1 ${t.label} opacity-80 leading-snug`}>{hint}</p>
      )}
    </div>
  )
  return to ? <Link to={to} className="block h-full">{inner}</Link> : inner
}

export default MetricCard
