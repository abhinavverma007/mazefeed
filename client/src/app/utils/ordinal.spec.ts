import { ordinal } from './ordinal';

describe('ordinal', () => {
  it('formats 1st/2nd/3rd correctly', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
  });

  it('formats everything else as th', () => {
    expect(ordinal(4)).toBe('4th');
    expect(ordinal(10)).toBe('10th');
  });

  it('treats the 11-13 teens as an exception even though they end in 1/2/3', () => {
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(12)).toBe('12th');
    expect(ordinal(13)).toBe('13th');
  });

  it('still applies 1st/2nd/3rd past the teens exception (21st, 22nd, 23rd)', () => {
    expect(ordinal(21)).toBe('21st');
    expect(ordinal(22)).toBe('22nd');
    expect(ordinal(23)).toBe('23rd');
    expect(ordinal(111)).toBe('111th');
  });
});
