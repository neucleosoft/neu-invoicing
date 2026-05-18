import { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
  /** Optional secondary action — rendered as a quieter ghost button below primary */
  secondaryAction?: {
    label: string
    onClick: () => void
  }
}

export default function EmptyState({ icon: Icon, title, description, action, secondaryAction }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20 px-6 animate-emptyIn">
      <div className="relative mb-7">
        {/* Soft outer halo */}
        <div className="absolute inset-0 -m-4 rounded-full bg-primary-400/10 dark:bg-primary-500/10 blur-2xl" />
        {/* Decorative blur orbs */}
        <span className="absolute -top-2 -right-3 w-6 h-6 rounded-full bg-primary-400/40 blur-md" />
        <span className="absolute -bottom-3 -left-3 w-8 h-8 rounded-full bg-primary-500/30 blur-lg" />
        {/* Icon container with subtle floating animation */}
        <div className="relative w-28 h-28 rounded-3xl bg-gradient-to-br from-primary-50 via-white to-primary-100 dark:from-primary-900/40 dark:via-gray-800 dark:to-primary-800/30 flex items-center justify-center shadow-sm ring-1 ring-primary-100 dark:ring-primary-900/40 animate-floaty">
          {Icon ? (
            <Icon className="w-12 h-12 text-primary-600 dark:text-primary-400" strokeWidth={1.5} />
          ) : (
            <DefaultIllustration />
          )}
        </div>
      </div>

      <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mb-6 leading-relaxed">{description}</p>
      )}
      {(action || secondaryAction) && (
        <div className="flex flex-col sm:flex-row items-center gap-2">
          {action && (
            <button onClick={action.onClick} className="btn btn-primary">
              {action.label}
            </button>
          )}
          {secondaryAction && (
            <button
              onClick={secondaryAction.onClick}
              className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function DefaultIllustration() {
  return (
    <svg width="52" height="52" viewBox="0 0 44 44" fill="none" className="text-primary-600 dark:text-primary-400">
      <rect x="7" y="9" width="30" height="26" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 16h20M12 22h20M12 28h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
