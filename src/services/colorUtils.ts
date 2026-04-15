export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface LabColor {
  l: number;
  a: number;
  b: number;
}

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const normalize = (value: number, divisor: number) => (divisor === 0 ? 0 : clamp(value / divisor, -1, 1));

export function parseRgbString(rgb: string): RgbColor {
  const match = rgb.match(/\d+/g);
  if (!match || match.length < 3) {
    return { r: 0, g: 0, b: 0 };
  }

  const [r, g, b] = match.slice(0, 3).map(Number);
  return { r, g, b };
}

export function rgbToCss(color: RgbColor) {
  return `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`;
}

export function hexToRgb(hex: string): RgbColor {
  const clean = hex.replace('#', '');
  const value = clean.length === 3 ? clean.split('').map((char) => char + char).join('') : clean;

  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

export function rgbToLab({ r, g, b }: RgbColor): LabColor {
  const toLinear = (channel: number) => {
    const scaled = channel / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };

  const rl = toLinear(r);
  const gl = toLinear(g);
  const bl = toLinear(b);

  const x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047;
  const y = (rl * 0.2126 + gl * 0.7152 + bl * 0.0722) / 1;
  const z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883;

  const f = (value: number) => (value > 0.008856 ? value ** (1 / 3) : 7.787 * value + 16 / 116);

  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

export function rgbToHsl({ r, g, b }: RgbColor) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;

  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const lightness = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) {
    return { h: 0, s: 0, l: lightness };
  }

  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);

  let hue = 0;
  switch (max) {
    case rn:
      hue = (gn - bn) / delta + (gn < bn ? 6 : 0);
      break;
    case gn:
      hue = (bn - rn) / delta + 2;
      break;
    default:
      hue = (rn - gn) / delta + 4;
      break;
  }

  return { h: hue / 6, s: saturation, l: lightness };
}

export function deltaE(first: LabColor, second: LabColor) {
  return Math.sqrt((first.l - second.l) ** 2 + (first.a - second.a) ** 2 + (first.b - second.b) ** 2);
}

export function luminance({ r, g, b }: RgbColor) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function colorTemperatureIndex({ r, g, b }: RgbColor) {
  return clamp(((r - b) + (r - g) * 0.35) / 255, -1, 1);
}
