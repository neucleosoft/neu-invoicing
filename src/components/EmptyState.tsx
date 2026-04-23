import { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
}

export default function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="relative mb-6">
        <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-primary-50 to-primary-100 dark:from-primary-900/30 dark:to-primary-800/20 flex items-center justify-center shadow-inner">
          {Icon ? (
            <Icon className="w-10 h-10 text-primary-600 dark:text-primary-400" strokeWidth={1.5} />
          ) : (
            <DefaultIllustration />
          )}
        </div>
        <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-primary-400/30 blur-md" />
        <span className="absolute -bottom-2 -left-2 w-7 h-7 rounded-full bg-primary-500/20 blur-lg" />
      </div>

      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm mb-5">{description}</p>
      )}
      {action && (
        <button onClick={action.onClick} className="btn btn-primary">
          {action.label}
        </button>
      )}
    </div>
  )
}

function DefaultIllustration() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" fill="none" className="text-primary-600 dark:text-primary-400">
      <rect x="7" y="9" width="30" height="26" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 16h20M12 22h20M12 28h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
