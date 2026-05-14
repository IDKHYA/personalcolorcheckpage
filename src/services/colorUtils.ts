/*
 * colorUtils.ts
 *
 * 퍼스널컬러와 의류 추천에서 공통으로 사용하는 색상 수학 유틸리티입니다.
 * HEX/RGB/HSL/Lab 변환, Delta E 거리, 휘도, 색온도 지수를 제공합니다.
 *
 * 이 프로젝트의 핵심 색상 비교는 RGB 값을 직접 빼는 방식이 아닙니다.
 * 저장과 UI 표시는 HEX로 통일하고, 계산 시에는 HEX -> RGB -> Lab으로 변환한 뒤 Delta E 거리로 비교합니다.
 * 이 방식은 사람 눈이 느끼는 색 차이에 더 가까운 기준을 만들기 위한 선택입니다.
 */
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

// 점수, 색상 지수, 신뢰도처럼 범위가 정해진 값을 안전하게 min~max 안으로 제한합니다.
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// 특정 기준값(divisor)으로 나눈 뒤 -1~1 범위로 정규화합니다. 설문/사진 축 점수 계산에서 공통으로 사용됩니다.
export const normalize = (value: number, divisor: number) => (divisor === 0 ? 0 : clamp(value / divisor, -1, 1));

// CSS rgb(...) 문자열에서 숫자 채널만 추출합니다. 얼굴 분석 결과가 문자열로 넘어와도 계산용 RGB 객체로 바꾸기 위한 진입점입니다.
export function parseRgbString(rgb: string): RgbColor {
  const match = rgb.match(/\d+/g);
  if (!match || match.length < 3) {
    return { r: 0, g: 0, b: 0 };
  }

  const [r, g, b] = match.slice(0, 3).map(Number);
  return { r, g, b };
}

// 내부 RGB 객체를 다시 CSS에서 바로 사용할 수 있는 rgb(...) 문자열로 변환합니다.
export function rgbToCss(color: RgbColor) {
  return `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`;
}

// UI/카탈로그/팔레트 저장 형식인 HEX를 계산용 RGB 채널로 변환합니다.
export function hexToRgb(hex: string): RgbColor {
  const clean = hex.replace('#', '');
  const value = clean.length === 3 ? clean.split('').map((char) => char + char).join('') : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(value)) {
    return { r: 0, g: 0, b: 0 };
  }

  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

// RGB를 CIE Lab 색공간으로 변환합니다. Delta E 계산을 위해 사람의 시각 차이에 가까운 좌표계로 옮기는 단계입니다.
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

// RGB를 HSL로 변환합니다. 퍼스널컬러에서는 채도(s), 명도(l), 색상(h) 해석에 사용합니다.
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

// 두 Lab 색상의 유클리드 거리를 계산합니다. 값이 낮을수록 사람이 보기에도 가까운 색으로 판단합니다.
export function deltaE(first: LabColor, second: LabColor) {
  return Math.sqrt((first.l - second.l) ** 2 + (first.a - second.a) ** 2 + (first.b - second.b) ** 2);
}

// CIEDE2000 표준 색차 공식입니다.
// CIE76(단순 유클리드)보다 파란 계열 비균일성을 보정해 사람 눈의 지각과 상관관계가 더 높습니다.
// 의류 팔레트 매칭처럼 "같은 계열인가"를 판단할 때 CIE76보다 정확합니다.
export function deltaE2000(lab1: LabColor, lab2: LabColor): number {
  const { l: L1, a: a1, b: b1 } = lab1;
  const { l: L2, a: a2, b: b2 } = lab2;

  const C1 = Math.sqrt(a1 ** 2 + b1 ** 2);
  const C2 = Math.sqrt(a2 ** 2 + b2 ** 2);
  const Cbar = (C1 + C2) / 2;
  const Cbar7 = Cbar ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 25 ** 7)));
  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);

  const C1p = Math.sqrt(a1p ** 2 + b1 ** 2);
  const C2p = Math.sqrt(a2p ** 2 + b2 ** 2);
  const toHp = (b: number, ap: number): number => {
    if (b === 0 && ap === 0) return 0;
    const h = Math.atan2(b, ap) * (180 / Math.PI);
    return h < 0 ? h + 360 : h;
  };
  const h1p = toHp(b1, a1p);
  const h2p = toHp(b2, a2p);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp: number;
  if (C1p * C2p === 0) {
    dhp = 0;
  } else if (Math.abs(h2p - h1p) <= 180) {
    dhp = h2p - h1p;
  } else if (h2p - h1p > 180) {
    dhp = h2p - h1p - 360;
  } else {
    dhp = h2p - h1p + 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * (Math.PI / 180));

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp: number;
  if (C1p * C2p === 0) {
    hbarp = h1p + h2p;
  } else if (Math.abs(h1p - h2p) <= 180) {
    hbarp = (h1p + h2p) / 2;
  } else if (h1p + h2p < 360) {
    hbarp = (h1p + h2p + 360) / 2;
  } else {
    hbarp = (h1p + h2p - 360) / 2;
  }

  const T =
    1 -
    0.17 * Math.cos((hbarp - 30) * (Math.PI / 180)) +
    0.24 * Math.cos(2 * hbarp * (Math.PI / 180)) +
    0.32 * Math.cos((3 * hbarp + 6) * (Math.PI / 180)) -
    0.20 * Math.cos((4 * hbarp - 63) * (Math.PI / 180));

  const SL = 1 + 0.015 * (Lbarp - 50) ** 2 / Math.sqrt(20 + (Lbarp - 50) ** 2);
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;

  const Cbarp7 = Cbarp ** 7;
  const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + 25 ** 7));
  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const RT = -RC * Math.sin(2 * dTheta * (Math.PI / 180));

  return Math.sqrt(
    (dLp / SL) ** 2 +
    (dCp / SC) ** 2 +
    (dHp / SH) ** 2 +
    RT * (dCp / SC) * (dHp / SH),
  );
}

// 색상의 상대 휘도를 계산합니다. 얼굴 대비, 사진 노출, 의류 밝기 판단의 기반값입니다.
export function luminance({ r, g, b }: RgbColor) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// R과 B 채널 차이를 중심으로 웜/쿨 방향을 -1~1 지수로 환산합니다.
export function colorTemperatureIndex({ r, g, b }: RgbColor) {
  return clamp(((r - b) + (r - g) * 0.35) / 255, -1, 1);
}

// Lab b* 축(노랑↔파랑)을 기반으로 웜/쿨 방향을 -1~1 지수로 환산합니다.
// b* 양수=노랑=웜, 음수=파랑=쿨이며, a* 보정으로 분홍 쿨 뉘앙스를 소폭 반영합니다.
// RGB 채널 차이 방식보다 조명 변화에 덜 흔들리는 지각적 색공간을 사용한 버전입니다.
export function labTemperatureIndex(color: RgbColor): number {
  const lab = rgbToLab(color);
  const bAxis = clamp(lab.b / 32, -1, 1);
  const aCorrection = clamp(lab.a / 28, -1, 1) * -0.18;
  return clamp(bAxis + aCorrection, -1, 1);
}
