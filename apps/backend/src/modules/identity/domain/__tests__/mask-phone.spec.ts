import { maskPhone } from '../mask-phone';

describe('maskPhone', () => {
  it('keeps the country code, operator prefix and last four digits', () => {
    expect(maskPhone('+94776041932')).toBe('+94 77 ••• 1932');
    expect(maskPhone('+94 77 604 1932')).toBe('+94 77 ••• 1932');
  });

  it('hides anything it does not recognise', () => {
    expect(maskPhone('0776041932')).toBe('•••');
  });
});
