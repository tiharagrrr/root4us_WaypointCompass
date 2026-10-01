/** An email address, roughly: enough to tell it from a phone number on A2. */
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** "+94 77 123 4567" or "0771234567" becomes "+94771234567"; anything else stays as typed. */
export const toPhone = (value: string): string => {
  const digits = value.replace(/[\s-]/g, '')
  if (/^0\d{9}$/.test(digits)) return `+94${digits.slice(1)}`
  return digits
}

/** An email gets the invite by email; anything else is a phone number and gets an SMS. */
export const channelOf = (contact: string): 'email' | 'sms' => (contact.includes('@') ? 'email' : 'sms')
