import {
  InvalidPhoneNumber,
  isSriLankan,
  maskPhone,
  toE164,
  toLocalDigits,
} from '../sri-lanka-phone';

describe('toE164', () => {
  it.each([
    ['0776041932', '+94776041932'],
    ['077 604 1932', '+94776041932'],
    ['077-604-1932', '+94776041932'],
    ['+94776041932', '+94776041932'],
    ['+94 77 604 1932', '+94776041932'],
    ['0094776041932', '+94776041932'],
    ['94776041932', '+94776041932'],
    ['776041932', '+94776041932'],
    ['0112345678', '+94112345678'],
  ])('reads %s as %s', (typed, expected) => {
    expect(toE164(typed)).toBe(expected);
  });

  it('keeps another country code instead of assuming Sri Lanka', () => {
    expect(toE164('+6591234567')).toBe('+6591234567');
    expect(isSriLankan('+6591234567')).toBe(false);
  });

  it.each(['12345', '0', '', 'not a number', '07760419'])(
    'refuses %s',
    (typed) => {
      expect(() => toE164(typed)).toThrow(InvalidPhoneNumber);
    },
  );

  it('names only the masked number in its refusal', () => {
    expect(() => toE164('07760419')).toThrow(/•••/);
  });
});

describe('toLocalDigits', () => {
  it('drops the plus for the Sri Lankan gateways', () => {
    expect(toLocalDigits('0776041932')).toBe('94776041932');
  });
});

describe('maskPhone', () => {
  it('keeps the operator prefix and the last four digits', () => {
    expect(maskPhone('+94776041932')).toBe('+94 77 ••• 1932');
    expect(maskPhone('+94 77 604 1932')).toBe('+94 77 ••• 1932');
  });

  it('gives up rather than leak a number it cannot parse', () => {
    expect(maskPhone('0776041932')).toBe('•••');
  });
});
