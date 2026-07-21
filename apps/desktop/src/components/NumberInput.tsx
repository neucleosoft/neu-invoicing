import { useState, useEffect } from 'react'

interface NumberInputProps {
  value: number
  onChange: (value: number) => void
  className?: string
  min?: number
  step?: number
  required?: boolean
  placeholder?: string
}

const NumberInput = ({ value, onChange, className = 'input', min, required, placeholder }: NumberInputProps) => {
  // Store what the user is typing as a string (so they can clear the field, type freely)
  const [display, setDisplay] = useState(value === 0 ? '' : String(value))

  // When the parent changes the value (e.g. selecting an item pre-fills the rate), update display
  useEffect(() => {
    setDisplay(value === 0 ? '' : String(value))
  }, [value])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value

    // Allow empty field, digits, one decimal point
    if (raw === '' || /^\d*\.?\d*$/.test(raw)) {
      setDisplay(raw)

      // Send the number to parent as they type (empty = 0)
      const num = parseFloat(raw)
      onChange(isNaN(num) ? 0 : num)
    }
  }

  // When user clicks away, clean up the display (e.g. "3." becomes "3")
  const handleBlur = () => {
    const num = parseFloat(display)
    if (isNaN(num) || display === '') {
      setDisplay('')
      onChange(0)
    } else {
      setDisplay(String(num))
    }
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      className={className}
      value={display}
      onChange={handleChange}
      onBlur={handleBlur}
      min={min}
      required={required}
      placeholder={placeholder || '0'}
    />
  )
}

export default NumberInput
