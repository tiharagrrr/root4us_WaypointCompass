/** A phone number safe for logs and screens: +94776041932 becomes +94 77 ••• 1932. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  const match = /^(\+\d{2})(\d{2})\d*(\d{4})$/.exec(digits);
  return match ? `${match[1]} ${match[2]} ••• ${match[3]}` : '•••';
}
