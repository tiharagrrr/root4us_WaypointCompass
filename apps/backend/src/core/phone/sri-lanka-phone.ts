/**
 * Phone numbers for the SMS adapters. Records hold E.164 (+94...), but every
 * Sri Lankan gateway wants its own shape: Notify.lk and Text.lk take bare
 * local digits (94771234567), Twilio takes E.164. Whatever a user typed -
 * 0771234932, 94 77 123 4932, +94-77-123-4932 - lands in one form here.
 */

/** Sri Lanka's country code, and what a local number looks like without it. */
const LK = '94';
/** A mobile or fixed line without the trunk 0: 771234932, 112345678. */
const LK_SUBSCRIBER = /^[1-9]\d{8}$/;

export class InvalidPhoneNumber extends Error {
  constructor(masked: string) {
    super(`${masked} is not a phone number this gateway can reach`);
    this.name = 'InvalidPhoneNumber';
  }
}

/**
 * E.164 with the leading +, assuming Sri Lanka when no country code is given.
 * A number already carrying another country's code keeps it, so an expat
 * driver on a foreign number still gets their code.
 *
 * @throws InvalidPhoneNumber - the message carries only the masked number.
 */
export function toE164(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  const plus = digits.startsWith('+');
  const bare = digits.replace(/\D/g, '');

  // +<country><number>, already international: trust it, only check the shape.
  if (plus) {
    if (!/^\d{8,15}$/.test(bare))
      throw new InvalidPhoneNumber(maskPhone(phone));
    return `+${bare}`;
  }
  // 0094771234932, the international prefix typed out.
  const national = bare.startsWith('00') ? bare.slice(2) : bare;
  // 94771234932, the country code with no plus.
  if (national.startsWith(LK) && LK_SUBSCRIBER.test(national.slice(2)))
    return `+${national}`;
  // 0771234932, how a number is written in Sri Lanka.
  if (national.startsWith('0') && LK_SUBSCRIBER.test(national.slice(1)))
    return `+${LK}${national.slice(1)}`;
  // 771234932, the subscriber number alone.
  if (LK_SUBSCRIBER.test(national)) return `+${LK}${national}`;
  // Another country's code without the plus: too ambiguous to guess.
  if (national.length >= 10 && national.length <= 15) return `+${national}`;
  throw new InvalidPhoneNumber(maskPhone(phone));
}

/** E.164 without the +, which is what the Sri Lankan gateways' `to` field takes. */
export function toLocalDigits(phone: string): string {
  return toE164(phone).slice(1);
}

/** True for a Sri Lankan number; the local gateways reach no others. */
export function isSriLankan(phone: string): boolean {
  return toE164(phone).startsWith(`+${LK}`);
}

/** A phone number safe for logs and screens: +94776041932 becomes +94 77 ••• 1932. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  const match = /^(\+\d{2})(\d{2})\d*(\d{4})$/.exec(digits);
  return match ? `${match[1]} ${match[2]} ••• ${match[3]}` : '•••';
}
