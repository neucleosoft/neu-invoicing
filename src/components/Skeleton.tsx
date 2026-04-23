interface SkeletonProps {
  className?: string
  style?: React.CSSProperties
}

export function Skeleton({ className = '', style }: SkeletonProps) {
  return <div style={style} className={`animate-pulse rounded bg-gray-200 dark:bg-gray-700 ${className}`} />
}

interface TableSkeletonProps {
  rows?: number
  columns: number
}

export function TableSkeleton({ rows = 6, columns }: TableSkeletonProps) {
  return (
    <div className="overflow-hidden">
      <table className="table">
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r} className="border-t">
              {Array.from({ length: columns }).map((__, c) => (
                <td key={c} className="table-cell">
                  <Skeleton className="h-4" style={widthFor(c, columns)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Vary widths so skeleton rows don't look like a grid
function widthFor(col: number, total: number): React.CSSProperties {
  const widths = ['70%', '45%', '60%', '40%', '55%', '50%', '35%']
  return { width: widths[col % widths.length] ?? (total > 0 ? '50%' : '50%') }
}
