import type { FocusEventHandler } from 'react'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'

interface DateInputProps {
  id?: string
  name?: string
  className?: string
  value?: string
  onChange?: (e: { target: { value: string } }) => void
  onBlur?: FocusEventHandler<HTMLElement>
  required?: boolean
  disabled?: boolean
  min?: string
  max?: string
  placeholder?: string
  autoFocus?: boolean
  title?: string
  // Accepted and ignored — kept so we can drop-in replace <input type="date">
  type?: string
  lang?: string
}

const toISO = (d: Date): string => {
  const y = d.getFullYear()
  const m = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  return `${y}-${m}-${day}`
}

const parseDateValue = (value?: string): Date | null => {
  if (!value) return null

  const isoDateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoDateOnlyMatch) {
    const [, year, month, day] = isoDateOnlyMatch
    return new Date(Number(year), Number(month) - 1, Number(day))
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null

  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())
}

export default function DateInput({
  id,
  name,
  className,
  value,
  onChange,
  onBlur,
  required,
  disabled,
  min,
  max,
  placeholder,
  autoFocus,
  title,
}: DateInputProps) {
  const date = parseDateValue(value)

  return (
    <DatePicker
      id={id}
      name={name}
      selected={date}
      onChange={(d: Date | null) => onChange?.({ target: { value: d ? toISO(d) : '' } })}
      onBlur={onBlur}
      dateFormat="dd/MM/yyyy"
      placeholderText={placeholder || 'DD/MM/YYYY'}
      className={className}
      required={required}
      disabled={disabled}
      autoComplete="off"
      autoFocus={autoFocus}
      title={title}
      minDate={parseDateValue(min)}
      maxDate={parseDateValue(max)}
      portalId="date-picker-portal"
      popperClassName="z-[70]"
      showPopperArrow={false}
    />
  )
}
