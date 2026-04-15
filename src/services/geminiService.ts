import { QUESTIONS, QUESTIONNAIRE_AXES } from '../constants';
import { SEASON_ORDER, SEASON_PROFILES, WORKBOOK_SOURCE } from '../personalColorWorkbook';
import { clamp, colorTemperatureIndex, deltaE, hexToRgb, luminance, normalize, parseRgbString, rgbToHsl, rgbToLab } from './colorUtils';
import { ExtractedColors, FinalResult, MeasurementDetails, PhotoAnalysisResult, QuestionnaireScores, RoiMeasurement, SeasonId } from '../types';

const paletteLabCache = new Map<string, ReturnType<typeof rgbToLab>>();

function getPaletteLab(hex: string) {
  if (!paletteLabCache.has(hex)) {
    paletteLabCache.set(hex, rgbToLab(hexToRgb(hex)));
  }
  return paletteLabCache.get(hex)!;
}

function scoreToProbabilities(scores: Record<SeasonId, number>) {
  const min = Math.min(...Object.values(scores));
  const shifted = Object.fromEntries(
    Object.entries(scores).map(([key, value]) => [key, Math.max(0.0001, value - min + 0.0001)]),
  ) as Record<SeasonId, number>;
  const total = Object.values(shifted).reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(Object.entries(shifted).map(([key, value]) => [key, value / total])) as Record<SeasonId, number>;
}

function pairDistanceScore(value: number, target: number, tolerance = 1) {
  return clamp(1 - Math.abs(value - target) / (2 * tolerance), 0, 1);
}

function describeTemperature(value: number) {
  if (value > 0.18) return '웜';
  if (value < -0.18) return '쿨';
  return '중성';
}

function describeClarity(value: number) {
  if (value > 0.25) return '클리어';
  if (value < -0.25) return '뮤트';
  return '중간';
}

function describeLightness(value: number) {
  if (value > 0.35) return '라이트';
  if (value < -0.35) return '딥';
  return '미디엄';
}

function describeContrast(value: number) {
  if (value > 0.35) return '고대비';
  if (value < -0.35) return '저대비';
  return '중간 대비';
}

function sortSeasonEntries(scores: Record<SeasonId, number>) {
  return [...SEASON_ORDER]
    .map((id) => ({ id, score: scores[id], profile: SEASON_PROFILES[id] }))
    .sort((left, right) => right.score - left.score);
}

function weightedAverage(values: Array<[number, number]>) {
  const totalWeight = values.reduce((sum, [, weight]) => sum + weight, 0);
  if (totalWeight === 0) return 0;
  return values.reduce((sum, [value, weight]) => sum + value * weight, 0) / totalWeight;
}

function summarizeResponses(rawResponses: Record<string, string>) {
  const labels = QUESTIONS.map((question) => {
    const selected = question.options.find((option) => option.value === rawResponses[question.id]);
    return selected?.label;
  }).filter(Boolean);

  return labels.slice(0, 3).join(', ');
}

function scoreQuestionnaireSeasons(questionnaireScores: QuestionnaireScores) {
  const scores = {} as Record<SeasonId, number>;

  for (const id of SEASON_ORDER) {
    const profile = SEASON_PROFILES[id];
    scores[id] =
      pairDistanceScore(questionnaireScores.temperature, profile.traits.temperature, 1) * 0.38 +
      pairDistanceScore(questionnaireScores.lightness, profile.traits.lightness, 1) * 0.2 +
      pairDistanceScore(questionnaireScores.clarity, profile.traits.clarity, 1) * 0.25 +
      pairDistanceScore(questionnaireScores.contrast, profile.traits.contrast, 1) * 0.17;
  }

  return scoreToProbabilities(scores);
}

function getFeatureVector(extractedColors: ExtractedColors) {
  const skin = parseRgbString(extractedColors.skin);
  const hair = parseRgbString(extractedColors.hair);
  const eyes = parseRgbString(extractedColors.eyes);
  const lips = parseRgbString(extractedColors.lips);

  const skinHsl = rgbToHsl(skin);
  const hairHsl = rgbToHsl(hair);
  const eyeHsl = rgbToHsl(eyes);
  const lipHsl = rgbToHsl(lips);

  const temperature = weightedAverage([
    [colorTemperatureIndex(skin), 0.45],
    [colorTemperatureIndex(lips), 0.25],
    [colorTemperatureIndex(hair), 0.15],
    [colorTemperatureIndex(eyes), 0.15],
  ]);

  const lightness = normalize(
    weightedAverage([
      [luminance(skin) * 2 - 1, 0.45],
      [luminance(lips) * 2 - 1, 0.2],
      [luminance(eyes) * 2 - 1, 0.15],
      [luminance(hair) * 2 - 1, 0.2],
    ]),
    1,
  );

  const averageSaturation = weightedAverage([
    [skinHsl.s, 0.4],
    [lipHsl.s, 0.25],
    [eyeHsl.s, 0.2],
    [hairHsl.s, 0.15],
  ]);

  const clarity = clamp(averageSaturation * 2 - 1, -1, 1);
  const mutedScore = clamp(1 - averageSaturation, 0, 1);
  const contrast = clamp(
    (Math.max(luminance(skin), luminance(hair), luminance(eyes), luminance(lips)) -
      Math.min(luminance(skin), luminance(hair), luminance(eyes), luminance(lips))) *
      2 -
      0.15,
    -1,
    1,
  );

  return { skin, hair, eyes, lips, temperature, lightness, clarity, contrast, mutedScore };
}

function buildRoiMeasurement(
  label: string,
  color: { r: number; g: number; b: number },
  region: { x: number; y: number; width: number; height: number },
): RoiMeasurement {
  const lab = rgbToLab(color);
  const hsl = rgbToHsl(color);

  return {
    label,
    color: `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`,
    rgb: { r: Math.round(color.r), g: Math.round(color.g), b: Math.round(color.b) },
    lab: {
      l: Number(lab.l.toFixed(2)),
      a: Number(lab.a.toFixed(2)),
      b: Number(lab.b.toFixed(2)),
    },
    hsl: {
      h: Number((hsl.h * 360).toFixed(2)),
      s: Number((hsl.s * 100).toFixed(2)),
      l: Number((hsl.l * 100).toFixed(2)),
    },
    region: {
      x: Math.round(region.x),
      y: Math.round(region.y),
      width: Math.round(region.width),
      height: Math.round(region.height),
    },
  };
}

interface AnalyzePhotoInput {
  extractedColors: ExtractedColors;
  photoQuality: number;
  measurementDetails?: MeasurementDetails;
}

export function analyzePhotoColors(input: AnalyzePhotoInput): PhotoAnalysisResult {
  const { extractedColors, photoQuality, measurementDetails } = input;
  const features = getFeatureVector(extractedColors);
  const sampleLabs = {
    skin: rgbToLab(features.skin),
    hair: rgbToLab(features.hair),
    eyes: rgbToLab(features.eyes),
    lips: rgbToLab(features.lips),
  };

  const rawScores = {} as Record<SeasonId, number>;

  for (const id of SEASON_ORDER) {
    const profile = SEASON_PROFILES[id];
    const nearestDistance = (lab: ReturnType<typeof rgbToLab>) =>
      profile.palette.reduce((best, hex) => Math.min(best, deltaE(lab, getPaletteLab(hex))), Number.POSITIVE_INFINITY);

    const paletteScore = weightedAverage([
      [clamp(1 - nearestDistance(sampleLabs.skin) / 42, 0, 1), 0.45],
      [clamp(1 - nearestDistance(sampleLabs.hair) / 55, 0, 1), 0.2],
      [clamp(1 - nearestDistance(sampleLabs.eyes) / 52, 0, 1), 0.15],
      [clamp(1 - nearestDistance(sampleLabs.lips) / 44, 0, 1), 0.2],
    ]);

    const traitScore =
      pairDistanceScore(features.temperature, profile.traits.temperature, 1) * 0.38 +
      pairDistanceScore(features.lightness, profile.traits.lightness, 1) * 0.18 +
      pairDistanceScore(features.clarity, profile.traits.clarity, 1) * 0.24 +
      pairDistanceScore(features.contrast, profile.traits.contrast, 1) * 0.2;

    rawScores[id] = paletteScore * 0.68 + traitScore * 0.32;
  }

  const seasonScores = scoreToProbabilities(rawScores);
  const sorted = sortSeasonEntries(seasonScores);
  const topScore = sorted[0]?.score ?? 0.25;
  const topSeasonScores = sorted.slice(0, 5).map(({ id, score, profile }) => ({
    seasonId: id,
    seasonName: profile.name,
    score: Number((score * 100).toFixed(2)),
  }));

  return {
    temperature: features.temperature >= 0 ? 'warm' : 'cool',
    temperatureConfidence: clamp(Math.abs(features.temperature) * 0.55 + topScore * 0.35 + photoQuality * 0.1, 0.45, 0.96),
    seasonScores,
    mutedScore: features.mutedScore,
    photoQuality,
    extractedColors,
    measurementDetails: {
      faceBounds: measurementDetails?.faceBounds ?? { x: 0, y: 0, width: 0, height: 0 },
      normalizedFeatures: {
        temperature: Number(features.temperature.toFixed(4)),
        lightness: Number(features.lightness.toFixed(4)),
        clarity: Number(features.clarity.toFixed(4)),
        contrast: Number(features.contrast.toFixed(4)),
        mutedScore: Number(features.mutedScore.toFixed(4)),
      },
      qualityBreakdown: measurementDetails?.qualityBreakdown ?? {
        overall: Number(photoQuality.toFixed(4)),
        exposure: Number(photoQuality.toFixed(4)),
        symmetry: 0,
        distinctness: 0,
        faceSize: 0,
      },
      roiMeasurements:
        measurementDetails?.roiMeasurements ?? [
          buildRoiMeasurement('피부', features.skin, { x: 0, y: 0, width: 0, height: 0 }),
          buildRoiMeasurement('머리', features.hair, { x: 0, y: 0, width: 0, height: 0 }),
          buildRoiMeasurement('눈동자', features.eyes, { x: 0, y: 0, width: 0, height: 0 }),
          buildRoiMeasurement('입술', features.lips, { x: 0, y: 0, width: 0, height: 0 }),
        ],
      topSeasonScores,
    },
  };
}

export function fuseResults(photoData: PhotoAnalysisResult, questionnaireScores: QuestionnaireScores, rawResponses: Record<string, string>): FinalResult {
  const questionnaireSeasonScores = scoreQuestionnaireSeasons(questionnaireScores);

  const photoWeight = clamp(0.18 + photoData.photoQuality * 0.22, 0.18, 0.42);
  const questionnaireWeight = 1 - photoWeight;

  const fusedScores = {} as Record<SeasonId, number>;
  for (const id of SEASON_ORDER) {
    fusedScores[id] = photoData.seasonScores[id] * photoWeight + questionnaireSeasonScores[id] * questionnaireWeight;
  }

  const normalizedScores = scoreToProbabilities(fusedScores);
  const [first, second] = sortSeasonEntries(normalizedScores);
  const photoTop = sortSeasonEntries(photoData.seasonScores)[0];
  const questionTop = sortSeasonEntries(questionnaireSeasonScores)[0];

  const temperatureAgreement =
    (photoData.temperature === 'warm' && questionnaireScores.temperature >= 0) ||
    (photoData.temperature === 'cool' && questionnaireScores.temperature < 0);
  const familyAgreement = photoTop.profile.family === questionTop.profile.family;
  const consistency = familyAgreement && temperatureAgreement ? 'high' : temperatureAgreement || familyAgreement ? 'medium' : 'low';

  const confidence = clamp(
    0.42 +
      first.score * 0.28 +
      (first.score - second.score) * 1.35 +
      photoData.photoQuality * 0.12 +
      (consistency === 'high' ? 0.08 : consistency === 'medium' ? 0.03 : 0),
    0.45,
    0.97,
  );

  const decisionType = photoWeight >= 0.55 ? 'photo' : questionnaireWeight >= 0.55 ? 'questionnaire' : 'hybrid';

  const explanation = [
    `${first.profile.name} 팔레트가 사진 샘플 색과 가장 가깝고, 설문 축에서는 ${describeTemperature(questionnaireScores.temperature)} 온도와 ${describeClarity(questionnaireScores.clarity)} 채도 성향이 함께 확인되었습니다.`,
    `사진 품질 점수는 ${Math.round(photoData.photoQuality * 100)}점으로 반영했고, 엑셀 팔레트 24색 거리 비교와 설문 축 정규화를 함께 사용했습니다.`,
    summarizeResponses(rawResponses) ? `설문에서 특히 "${summarizeResponses(rawResponses)}" 응답이 상위 시즌 판정에 영향을 주었습니다.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    temperature: first.profile.traits.temperature >= 0 ? 'warm' : 'cool',
    seasonTop1: first.profile.name,
    seasonTop2: second.profile.name,
    confidence,
    decisionType,
    evidence: {
      photoSignal: {
        temperature: photoData.temperature === 'warm' ? '웜' : '쿨',
        confidence: photoData.temperatureConfidence,
        dominantSeason: photoTop.profile.name,
      },
      questionSignal: {
        temperature: describeTemperature(questionnaireScores.temperature),
        clarity: describeClarity(questionnaireScores.clarity),
        confidence: clamp(
          0.48 +
            Math.abs(questionnaireScores.temperature) * 0.18 +
            Math.abs(questionnaireScores.clarity) * 0.18 +
            Math.abs(questionnaireScores.contrast) * 0.1,
          0.45,
          0.92,
        ),
      },
      consistency,
      workbookBasis: `${WORKBOOK_SOURCE} / ${first.profile.name} 24색 팔레트`,
    },
    recommendationFeatures: {
      preferredTemperature: first.profile.traits.temperature >= 0 ? '따뜻한 옐로 베이스' : '차가운 블루 베이스',
      preferredClarity: describeClarity(first.profile.traits.clarity),
      preferredLightness: describeLightness(first.profile.traits.lightness),
      contrastLevel: describeContrast(first.profile.traits.contrast),
    },
    palette: first.profile.palette,
    extractedColors: photoData.extractedColors,
    explanation,
  };
}

export function calculateQuestionnaireScores(rawResponses: Record<string, string>): QuestionnaireScores {
  const totals: QuestionnaireScores = { temperature: 0, lightness: 0, clarity: 0, contrast: 0 };
  const axisLimits: QuestionnaireScores = { temperature: 0, lightness: 0, clarity: 0, contrast: 0 };

  for (const question of QUESTIONS) {
    const selected = question.options.find((option) => option.value === rawResponses[question.id]);
    if (selected?.weights) {
      for (const axis of QUESTIONNAIRE_AXES) {
        totals[axis] += selected.weights[axis] ?? 0;
      }
    }

    for (const axis of QUESTIONNAIRE_AXES) {
      const axisMax = Math.max(...question.options.map((option) => Math.abs(option.weights[axis] ?? 0)), 0);
      axisLimits[axis] += axisMax;
    }
  }

  return {
    temperature: normalize(totals.temperature, axisLimits.temperature),
    lightness: normalize(totals.lightness, axisLimits.lightness),
    clarity: normalize(totals.clarity, axisLimits.clarity),
    contrast: normalize(totals.contrast, axisLimits.contrast),
  };
}
