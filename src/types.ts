export type SeasonFamily = 'spring' | 'summer' | 'autumn' | 'winter';

export type SeasonId =
  | 'light-spring'
  | 'true-spring'
  | 'bright-spring'
  | 'light-summer'
  | 'true-summer'
  | 'soft-summer'
  | 'soft-autumn'
  | 'true-autumn'
  | 'dark-autumn'
  | 'dark-winter'
  | 'true-winter'
  | 'bright-winter';

export interface QuestionnaireScores {
  temperature: number;
  lightness: number;
  clarity: number;
  contrast: number;
}

export interface ExtractedColors {
  skin: string;
  hair: string;
  eyes: string;
  lips: string;
}

export interface RoiMeasurement {
  label: string;
  color: string;
  rgb: { r: number; g: number; b: number };
  lab: { l: number; a: number; b: number };
  hsl: { h: number; s: number; l: number };
  region: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface MeasurementDetails {
  faceBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  normalizedFeatures: {
    temperature: number;
    lightness: number;
    clarity: number;
    contrast: number;
    mutedScore: number;
  };
  qualityBreakdown: {
    overall: number;
    exposure: number;
    symmetry: number;
    distinctness: number;
    faceSize: number;
  };
  roiMeasurements: RoiMeasurement[];
  topSeasonScores: Array<{
    seasonId: SeasonId;
    seasonName: string;
    score: number;
  }>;
}

export interface PhotoAnalysisResult {
  temperature: 'warm' | 'cool';
  temperatureConfidence: number;
  seasonScores: Record<SeasonId, number>;
  mutedScore: number;
  photoQuality: number;
  extractedColors: ExtractedColors;
  measurementDetails: MeasurementDetails;
}

export interface FinalResult {
  temperature: 'warm' | 'cool';
  seasonTop1: string;
  seasonTop2: string;
  confidence: number;
  decisionType: 'hybrid' | 'photo' | 'questionnaire';
  evidence: {
    photoSignal: {
      temperature: string;
      confidence: number;
      dominantSeason: string;
    };
    questionSignal: {
      temperature: string;
      clarity: string;
      confidence: number;
    };
    consistency: 'high' | 'medium' | 'low';
    workbookBasis: string;
  };
  recommendationFeatures: {
    preferredTemperature: string;
    preferredClarity: string;
    preferredLightness: string;
    contrastLevel: string;
  };
  palette: string[];
  extractedColors: ExtractedColors;
  explanation: string;
}

export interface Question {
  id: string;
  text: string;
  options: {
    label: string;
    value: string;
    weights: Partial<QuestionnaireScores>;
  }[];
}

export interface SeasonProfile {
  id: SeasonId;
  name: string;
  englishName: string;
  family: SeasonFamily;
  toneNote: string;
  traits: QuestionnaireScores;
  workbookStats: {
    averageRgb: [number, number, number];
    averageLightness: number;
    averageSaturation: number;
    averageTemperature: number;
    averageContrast: number;
  };
  palette: string[];
}
