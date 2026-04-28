import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'

interface DateInputProps {
  className?: string
  value?: string
  onChange?: (e: { target: { value: string } }) => void
  required?: boolean
  disabled?: boolean
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

export default function DateInput({ className, value, onChange, required, disabled }: DateInputProps) {
  const date = value ? new Date(value + 'T00:00:00') : null

  return (
    <DatePicker
      selected={date}
      onChange={(d: Date | null) => onChange?.({ target: { value: d ? toISO(d) : '' } })}
      dateFormat="dd/MM/yyyy"
      placeholderText="DD/MM/YYYY"
      className={className}
      required={required}
      disabled={disabled}
      autoComplete="off"
    />
  )
}
