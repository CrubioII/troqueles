export function isValidEmail(value) {
  const email = (value || '').trim()
  return !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}
