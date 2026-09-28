import { useLayoutEffect, useRef } from 'react'

export default function GroupedIntegerInput({ value, onChange, ...inputProps }) {
  const inputRef = useRef(null)
  const cursorDigitsRef = useRef(null)
  const pastedRef = useRef(false)
  const number = Number(value)
  const display = value === '' || value == null || !Number.isFinite(number)
    ? ''
    : Math.round(number).toLocaleString('es-CO')

  useLayoutEffect(() => {
    const digitsBeforeCursor = cursorDigitsRef.current
    const input = inputRef.current
    if (digitsBeforeCursor == null || document.activeElement !== input) return

    let cursor = 0
    let digits = 0
    while (cursor < input.value.length && digits < digitsBeforeCursor) {
      if (/\d/.test(input.value[cursor])) digits += 1
      cursor += 1
    }
    input.setSelectionRange(cursor, cursor)
    cursorDigitsRef.current = null
  }, [display])

  return (
    <input
      {...inputProps}
      ref={inputRef}
      type="text"
      inputMode="numeric"
      value={display}
      onPaste={() => { pastedRef.current = true }}
      onChange={event => {
        const raw = event.target.value
        cursorDigitsRef.current = raw.slice(0, event.target.selectionStart ?? raw.length).replace(/\D/g, '').length
        // Treat .00 as decimals only when pasted; during deletion it may be a thousands group.
        const pasted = pastedRef.current || event.nativeEvent.inputType === 'insertFromPaste'
        pastedRef.current = false
        const digits = (pasted ? raw.replace(/[.,]00$/, '') : raw).replace(/\D/g, '')
        onChange(digits ? Number(digits) : '')
      }}
    />
  )
}
