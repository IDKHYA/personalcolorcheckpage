/*
 * App.tsx
 *
 * 이 파일은 통합 퍼스널컬러 AI 옷장 앱의 최상위 애플리케이션 계층입니다.
 * React SPA의 페이지 전환, localStorage 기반 영속 상태, 옷장/의류/추천/저장 코디/데일리룩 흐름을 한 곳에서 연결합니다.
 *
 * 큰 흐름은 다음과 같습니다.
 * 1. 퍼스널컬러 진단 결과(FinalResult)를 저장하고 이력을 관리합니다.
 * 2. 옷장(Wardrobe)과 의류(ClothingItem)를 localStorage에서 읽고 저장합니다.
 * 3. 카탈로그 의류와 사용자가 직접 업로드한 의류를 같은 ClothingItem 구조로 통합합니다.
 * 4. 의류 대표 HEX를 Lab 색공간으로 변환해 퍼스널컬러 팔레트와 Delta E 거리 기반 적합도 점수를 계산합니다.
 * 5. 날씨 구간, 보유 상태, 색상 조화도, 퍼스널컬러 점수를 합산해 코디 추천을 생성합니다.
 * 6. 추천 결과를 SavedOutfit으로 저장하고, Try On/데일리룩 레이어 구성으로 확장합니다.
 *
 * 현재는 MVP 속도를 위해 여러 도메인 로직과 화면 컴포넌트가 이 파일에 모여 있습니다.
 * 장기적으로는 wardrobe service, recommendation engine, saved outfit store, page components로 분리하면 유지보수성이 좋아집니다.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Camera,
  Check,
  ChevronRight,
  CloudSun,
  Grid2X2,
  Home,
  List,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Shirt,
  ShoppingBag,
  Sparkles,
  Trash2,
  Upload,
  User,
} from 'lucide-react';
import PhotoAnalyzer from './components/PhotoAnalyzer';
import Questionnaire from './components/Questionnaire';
import { SEASON_PROFILES } from './personalColorWorkbook';
import { FAMILY_GUIDES, FAMILY_LABELS, PERSONAL_COLOR_MODEL_NOTE, SEASON_DETAILS } from './seasonContent';
import { fuseResults } from './services/geminiService';
import { TRAINING_CATALOG_ITEMS } from './data/trainingCatalog';
import type { CatalogItem } from './data/trainingCatalog';
import { deltaE2000, hexToRgb, rgbToHsl, rgbToLab } from './services/colorUtils';
import type { LabColor } from './services/colorUtils';
import { useWeather } from './hooks/useWeather';
import { WeatherBand, WEATHER_BANDS } from './lib/weather';
import { FinalResult, PhotoAnalysisResult, QuestionnaireScores, SeasonId } from './types';

type Page = 'home' | 'personal' | 'wardrobe' | 'recommend' | 'saved' | 'tryon' | 'settings';
type AnalysisStep = 'photo' | 'questionnaire' | 'result';
type WardrobeView = 'list' | 'detail' | 'catalog' | 'preview' | 'manual';
type RecommendationWeatherBand = WeatherBand | '상관없음';
interface AppRouteState {
  page: Page;
  analysisStep: AnalysisStep;
  wardrobeView: WardrobeView;
  selectedWardrobeId: string;
}
type ClothingCategory = '상의' | '하의' | '아우터' | '신발' | '액세서리';
type DailyLookSlot = 'outer' | 'upper' | 'lower' | 'shoes' | 'hat' | 'bag' | 'accessory';
type AvailabilityStatus = '보유중' | '세탁중' | '보관중' | '추천제외';
type FitGrade = 'BEST' | 'GOOD' | 'OK' | 'CHECK';
type RecommendationMode = '데일리' | '출근' | '데이트' | '발표';
type PatternType = 'solid' | 'stripe' | 'plaid' | 'graphic';
type MaterialType = 'cotton' | 'denim' | 'knit' | 'leather' | 'nylon' | 'wool' | 'unknown';
type DenimWash = 'light' | 'mid' | 'dark' | 'black';

interface Wardrobe {
  id: string;
  name: string;
  createdAt: string;
}


interface ClothingAnalysisMeta {
  part?: string;
  part_ko?: string;
  fine_labels?: string[];
  colors?: ClothingColorAnalysis[];
}

interface ClothingColorAnalysis {
  hex?: string;
  ratio?: number;
  rgb?: number[];
}

interface ClothingItem {
  id: string;
  wardrobeId: string;
  imageUrl: string;
  originalImageUrl?: string;
  cutoutImageUrl?: string;
  segmentation?: ClothingSegmentationMeta;
  category: ClothingCategory;
  type: string;
  color: string;
  size: string;
  brand: string;
  createdAt: string;
  representativeColor: string;
  representativeHex: string;
  dominantColors: ClothingColorAnalysis[];
  seasonTag: string;
  patternType: PatternType;
  material: MaterialType;
  availabilityStatus: AvailabilityStatus;
  isNeutral: boolean;
  isDenim: boolean;
  denimWash?: DenimWash;
  sourceType: 'catalog' | 'upload';
  catalogItemId?: string;
}

interface ClothingSegmentationMeta {
  width: number;
  height: number;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  model: string;
  version?: string;
  processedAt: string;
  colors?: ClothingColorAnalysis[];
}

interface BackgroundRemoveResult {
  imageDataUrl: string;
  width: number;
  height: number;
  bbox: ClothingSegmentationMeta['bbox'];
  colors?: ClothingColorAnalysis[];
  model: string;
  version?: string;
  processedAt: string;
  predictedSeason?: string;
  seasonConfidence?: number;
  seasonProbabilities?: Record<string, number>;
  predictedMaterial?: string;
}

interface ScoredClothingItem extends ClothingItem {
  personalFitScore: number | null;
  fitGrade: FitGrade | null;
  fitReason: string;
  avoidRisk: boolean;
}

interface OutfitRecommendation {
  id: string;
  title: string;
  harmonyType: string;
  score: number;
  personalScore: number;
  harmonyScore: number;
  weatherScore: number;
  stabilityScore: number;
  items: ScoredClothingItem[];
  reason: string;
  weatherBand: RecommendationWeatherBand;
  mode: RecommendationMode;
}

interface SavedOutfit {
  id: string;
  title: string;
  score: number;
  itemIds: string[];
  colorHexes: string[];
  weatherBand: RecommendationWeatherBand;
  mode: RecommendationMode;
  savedAt: string;
  dailyLookState?: DailyLookState;
}

interface DailyLookLayer {
  itemId: string;
  category: ClothingCategory;
  slot: DailyLookSlot;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  zIndex: number;
  visible: boolean;
}

interface DailyLookTextLayer {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  rotation: number;
  zIndex: number;
  visible: boolean;
}

interface DailyLookState {
  canvas: {
    width: number;
    height: number;
  };
  layers: DailyLookLayer[];
  textLayers?: DailyLookTextLayer[];
  isConfirmed: boolean;
  confirmedImage?: string;
  confirmedAt?: string;
}

interface PersonalColorRecord {
  id: string;
  measuredAt: string;
  result: FinalResult;
}

const STORAGE_KEYS = {
  personalColor: 'integrated_personal_color_result',
  personalHistory: 'integrated_personal_color_history',
  wardrobes: 'integrated_wardrobes',
  clothing: 'integrated_clothing_items',
  saved: 'integrated_saved_outfits',
} as const;

const CATEGORY_OPTIONS: ClothingCategory[] = ['상의', '하의', '아우터', '신발', '액세서리'];
const CATALOG_TABS: Array<'전체' | ClothingCategory> = ['전체', '아우터', '상의', '하의', '신발', '액세서리'];
const RECOMMENDATION_MODES: RecommendationMode[] = ['데일리', '출근', '데이트', '발표'];
const AVAILABILITY_OPTIONS: AvailabilityStatus[] = ['보유중', '세탁중', '보관중', '추천제외'];
const SEASON_TAGS = ['봄/가을', '여름', '겨울', '사계절'];
const DAILY_LOOK_CANVAS = { width: 1080, height: 1440 };
const CUTOUT_VERSION = 'hard-alpha-v3';
const DENIM_WASH_LABELS: Record<DenimWash, string> = {
  light: '연청',
  mid: '중청',
  dark: '진청',
  black: '흑청',
};

const PATTERN_LABELS: Record<PatternType, string> = {
  solid: '무지',
  stripe: '스트라이프',
  plaid: '체크',
  graphic: '그래픽',
};

const MATERIAL_LABELS: Record<MaterialType, string> = {
  cotton: '면',
  denim: '데님',
  knit: '니트',
  leather: '레더',
  nylon: '나일론',
  wool: '울',
  unknown: '미분류',
};

const DAILY_LOOK_SLOT_BY_CATEGORY: Record<ClothingCategory, DailyLookSlot> = {
  아우터: 'outer',
  상의: 'upper',
  하의: 'lower',
  신발: 'shoes',
  액세서리: 'accessory',
};

const PRECISION_TARGET_BY_CATEGORY: Record<ClothingCategory, string> = {
  상의: 'upper',
  하의: 'lower',
  아우터: 'outer',
  신발: 'shoes',
  액세서리: 'accessory',
};

const CATEGORY_UI_META: Record<ClothingCategory, { label: string; hint: string; slot: DailyLookSlot }> = {
  상의: { label: '상의', hint: '티셔츠·니트·셔츠', slot: 'upper' },
  하의: { label: '하의', hint: '팬츠·스커트', slot: 'lower' },
  아우터: { label: '아우터', hint: '재킷·코트', slot: 'outer' },
  신발: { label: '신발', hint: '스니커즈·부츠', slot: 'shoes' },
  액세서리: { label: '액세서리', hint: '가방·모자', slot: 'accessory' },
};

const DAILY_LOOK_SLOT_PRESETS: Record<DailyLookSlot, { x: number; y: number; scale: number; rotation: number; zIndex: number }> = {
  // 추후 아이템이 늘어도 slot 프리셋만 추가/조정하면 자동 배치 흐름을 확장할 수 있습니다.
  outer: { x: 235, y: 365, scale: 0.86, rotation: -2, zIndex: 0 },
  upper: { x: 545, y: 350, scale: 0.8, rotation: 1, zIndex: 2 },
  lower: { x: 545, y: 700, scale: 0.9, rotation: 0, zIndex: 1 },
  shoes: { x: 760, y: 1120, scale: 0.48, rotation: -4, zIndex: 3 },
  hat: { x: 785, y: 190, scale: 0.38, rotation: 5, zIndex: 4 },
  bag: { x: 240, y: 1010, scale: 0.46, rotation: 0, zIndex: 5 },
  accessory: { x: 830, y: 610, scale: 0.35, rotation: 4, zIndex: 6 },
};

const SEASON_LABELS: Record<SeasonId, string> = {
  'light-spring': '라이트 스프링',
  'true-spring': '트루 스프링',
  'bright-spring': '브라이트 스프링',
  'light-summer': '라이트 서머',
  'true-summer': '트루 서머',
  'soft-summer': '소프트 서머',
  'soft-autumn': '소프트 어텀',
  'true-autumn': '트루 어텀',
  'dark-autumn': '다크 어텀',
  'dark-winter': '다크 윈터',
  'true-winter': '트루 윈터',
  'bright-winter': '브라이트 윈터',
};

const TYPES: Record<ClothingCategory, string[]> = {
  상의: ['반팔티', '긴팔티', '니트', '셔츠', '가디건', '맨투맨'],
  하의: ['청바지', '슬랙스', '스커트', '반바지', '조거팬츠'],
  아우터: ['재킷', '코트', '패딩', '트렌치코트', '블레이저'],
  신발: ['스니커즈', '로퍼', '부츠', '샌들'],
  액세서리: ['가방', '모자', '스카프', '벨트'],
};

const SIZES = {
  tops: ['XS', 'S', 'M', 'L', 'XL'],
  bottoms: ['24', '25', '26', '27', '28', '29', '30', '31', '32'],
  shoes: ['220', '230', '240', '250', '260', '270', '280'],
};

const COLOR_META: Record<string, { representative: string; hex: string; neutral?: boolean; denim?: boolean }> = {
  화이트: { representative: '화이트', hex: '#F7F7F4', neutral: true },
  아이보리: { representative: '아이보리', hex: '#F1E8D7', neutral: true },
  블랙: { representative: '블랙', hex: '#171717', neutral: true },
  차콜: { representative: '차콜', hex: '#34363A', neutral: true },
  그레이: { representative: '그레이', hex: '#8B8F97', neutral: true },
  멜란지: { representative: '멜란지', hex: '#B8B8B2', neutral: true },
  네이비: { representative: '네이비', hex: '#22334D', neutral: true },
  블루: { representative: '블루', hex: '#6F95C9' },
  스카이블루: { representative: '스카이블루', hex: '#A9CBE8' },
  데님: { representative: '데님', hex: '#5C7898', denim: true },
  베이지: { representative: '베이지', hex: '#D7C2A1', neutral: true },
  샌드: { representative: '샌드', hex: '#CDBB9E', neutral: true },
  스톤: { representative: '스톤', hex: '#B8B2A8', neutral: true },
  브라운: { representative: '브라운', hex: '#795342' },
  모카: { representative: '모카', hex: '#6F5548' },
  레드: { representative: '레드', hex: '#C7474C' },
  옐로우: { representative: '옐로우', hex: '#E7C84A' },
  핑크: { representative: '핑크', hex: '#D8A8B5' },
  민트: { representative: '민트', hex: '#A8D8C2' },
  그린: { representative: '그린', hex: '#88A97E' },
  포레스트: { representative: '포레스트', hex: '#31523C' },
  올리브: { representative: '올리브', hex: '#7D8051' },
  라임: { representative: '라임', hex: '#C8DD8B' },
  카키: { representative: '카키', hex: '#737A57' },
  퍼플: { representative: '퍼플', hex: '#8B79C9' },
  라벤더: { representative: '라벤더', hex: '#B8A8D4' },
};

const COLOR_NAME_PATTERNS: Array<[RegExp, keyof typeof COLOR_META]> = [
  [/(off[-\s]?black|washed[-\s]?black|pure[-\s]?black|black|블랙|흑청)/i, '블랙'],
  [/(charcoal|차콜)/i, '차콜'],
  [/(heather[-\s]?grey|heather[-\s]?gray|melange[-\s]?gray|멜란지[-\s]?그레이|멜란지)/i, '멜란지'],
  [/(grey|gray|그레이|회색)/i, '그레이'],
  [/(navy|네이비)/i, '네이비'],
  [/(royal[-\s]?blue|purple[-\s]?blue|dusty[-\s]?blue|soft[-\s]?blue|pale[-\s]?blue|sky[-\s]?blue|blue|블루|파랑|스카이)/i, '블루'],
  [/(ivory|아이보리)/i, '아이보리'],
  [/(white|화이트|흰색)/i, '화이트'],
  [/(sand|샌드)/i, '샌드'],
  [/(stone|스톤)/i, '스톤'],
  [/(beige|베이지)/i, '베이지'],
  [/(dark[-\s]?mocha|mocha|모카)/i, '모카'],
  [/(brown|브라운|갈색)/i, '브라운'],
  [/(dusty[-\s]?pink|pink|핑크)/i, '핑크'],
  [/(yellow|옐로우|노랑)/i, '옐로우'],
  [/(pale[-\s]?mint|mint|민트)/i, '민트'],
  [/(forest|포레스트)/i, '포레스트'],
  [/(moss|olive|올리브|모스)/i, '올리브'],
  [/(pale[-\s]?lime|lime|라임)/i, '라임'],
  [/(green|그린|초록)/i, '그린'],
  [/(khaki|카키)/i, '카키'],
  [/(purple|퍼플|보라)/i, '퍼플'],
  [/(lavender|라벤더)/i, '라벤더'],
];

const WEATHER_RULES: Record<WeatherBand, string[]> = {
  '4도 이하': ['패딩', '코트', '니트', '가디건'],
  '5~8도': ['코트', '재킷', '니트', '맨투맨'],
  '9~11도': ['블레이저', '재킷', '니트', '긴팔티', '셔츠'],
  '12~16도': ['블레이저', '셔츠', '긴팔티', '니트', '맨투맨'],
  '17~19도': ['셔츠', '가디건', '긴팔티', '맨투맨'],
  '20~22도': ['반팔티', '셔츠', '블라우스'],
  '23~27도': ['반팔티', '긴바지', '반바지', '블라우스', '스커트'],
  '28도 이상': ['반팔티', '반바지', '샌들', '스커트'],
};

const WEATHER_BAND_ORDER: WeatherBand[] = ['4도 이하', '5~8도', '9~11도', '12~16도', '17~19도', '20~22도', '23~27도', '28도 이상'];

// 선택된 기온 구간에 맞는 의류 키워드를 가져옵니다.
// 바로 아래 구간의 키워드도 함께 포함해 날씨 경계값에서 추천이 너무 급격히 바뀌지 않게 합니다.
function getAllowedWeatherKeywords(band: RecommendationWeatherBand) {
  if (band === '상관없음') return [];
  const bandIndex = WEATHER_BAND_ORDER.indexOf(band);
  const lowerBand = bandIndex > 0 ? WEATHER_BAND_ORDER[bandIndex - 1] : null;
  return Array.from(new Set([...(WEATHER_RULES[band] ?? []), ...(lowerBand ? WEATHER_RULES[lowerBand] ?? [] : [])]));
}

// seasonTag 기반으로 현재 기온 구간에 맞지 않는 옷을 제외합니다.
// 겨울 옷은 더운 날, 여름 옷은 추운 날 추천에서 하드 컷합니다.
// 점수 조정은 getWeatherScore()가 담당하고, 이 함수는 명백히 맞지 않는 경우만 제외합니다.
function isWeatherEligible(item: ScoredClothingItem, band: RecommendationWeatherBand): boolean {
  if (band === '상관없음') return true;
  const bandIndex = WEATHER_BAND_ORDER.indexOf(band as WeatherBand);
  if (item.seasonTag === '여름' && bandIndex <= 2) return false;
  if (item.seasonTag === '겨울' && bandIndex >= 5) return false;
  return true;
}

// 가상착용 캔버스에서 의류가 올라갈 레이어 슬롯을 결정합니다.
function slotForItem(item: ScoredClothingItem): DailyLookSlot {
  if (item.category !== '액세서리') return DAILY_LOOK_SLOT_BY_CATEGORY[item.category];
  if (item.type.includes('모자')) return 'hat';
  if (item.type.includes('가방')) return 'bag';
  return 'accessory';
}

// 추천 저장 직후 보이는 데일리룩 보드는 플랫레이 구도를 우선합니다.
// 핵심 상하의는 중앙 축에 두고, 아우터/가방/모자/신발/액세서리는 주변 여백에 분산해 예시 이미지처럼 한눈에 보이게 합니다.
function dailyLookFlatlayPreset(slot: DailyLookSlot, slotIndex: number): { x: number; y: number; scale: number; rotation: number; zIndex: number } {
  const preset = DAILY_LOOK_SLOT_PRESETS[slot];
  const offsets: Partial<Record<DailyLookSlot, Array<Partial<typeof preset>>>> = {
    outer: [
      { x: 235, y: 365, rotation: -3 },
      { x: 825, y: 365, scale: 0.78, rotation: 3 },
    ],
    upper: [
      { x: 545, y: 350 },
      { x: 390, y: 315, scale: 0.68, rotation: -5 },
    ],
    lower: [
      { x: 545, y: 700 },
      { x: 690, y: 715, scale: 0.76, rotation: 4 },
    ],
    shoes: [
      { x: 760, y: 1120, rotation: -5 },
      { x: 630, y: 1160, rotation: 5 },
    ],
    hat: [
      { x: 785, y: 190 },
      { x: 900, y: 265, scale: 0.32, rotation: -8 },
    ],
    bag: [
      { x: 240, y: 1010 },
      { x: 190, y: 760, scale: 0.38, rotation: -4 },
    ],
    accessory: [
      { x: 830, y: 610 },
      { x: 250, y: 670, rotation: -8 },
      { x: 830, y: 910, scale: 0.3, rotation: 7 },
    ],
  };
  return { ...preset, ...(offsets[slot]?.[slotIndex] ?? {}) };
}

// 저장 코디를 가상착용 레이어 배열로 변환합니다.
// 이전에 사용자가 위치/크기를 조정한 레이어가 있으면 그대로 복원하고, 새 아이템만 기본 프리셋을 적용합니다.
function buildDailyLookLayers(items: ScoredClothingItem[], previous?: DailyLookState): DailyLookLayer[] {
  const previousByItem = new Map(previous?.layers.map((layer) => [layer.itemId, layer]));
  const slotUsage = new Map<DailyLookSlot, number>();
  return items.map((item) => {
    const restored = previousByItem.get(item.id);
    if (restored) return restored;
    const slot = slotForItem(item);
    const slotIndex = slotUsage.get(slot) ?? 0;
    slotUsage.set(slot, slotIndex + 1);
    const preset = dailyLookFlatlayPreset(slot, slotIndex);
    return {
      itemId: item.id,
      category: item.category,
      slot,
      x: preset.x,
      y: preset.y,
      scale: preset.scale,
      rotation: preset.rotation,
      zIndex: preset.zIndex,
      visible: true,
    };
  });
}

// 가상착용 전체 상태를 생성합니다. 캔버스 크기, 레이어, 확정 이미지 정보를 하나로 묶습니다.
function buildDailyLookState(items: ScoredClothingItem[], previous?: DailyLookState): DailyLookState {
  return {
    canvas: previous?.canvas ?? DAILY_LOOK_CANVAS,
    layers: buildDailyLookLayers(items, previous),
    textLayers: previous?.textLayers ?? [],
    isConfirmed: previous?.isConfirmed ?? false,
    confirmedImage: previous?.confirmedImage,
    confirmedAt: previous?.confirmedAt,
  };
}

// 저장 코디의 itemId 목록을 실제 의류 객체로 복원하고, 착용 레이어 순서에 맞게 정렬합니다.
function getMvpDailyLookItems(outfit: SavedOutfit | undefined, items: ScoredClothingItem[]) {
  const outfitItems = outfit?.itemIds.map((id) => items.find((item) => item.id === id)).filter(Boolean) as ScoredClothingItem[] | undefined;
  if (!outfitItems) return [];
  const orderedSlots: DailyLookSlot[] = ['outer', 'upper', 'lower', 'shoes', 'hat', 'bag', 'accessory'];
  return [...outfitItems]
    .filter((item) => ['아우터', '상의', '하의', '신발', '액세서리'].includes(item.category))
    .sort((left, right) => orderedSlots.indexOf(slotForItem(left)) - orderedSlots.indexOf(slotForItem(right)));
}

// 누끼 이미지가 있으면 우선 사용하고, 없으면 원본 의류 이미지를 표시합니다.
function clothingDisplayImage(item: ClothingItem) {
  return item.cutoutImageUrl || item.imageUrl;
}

// 업로드 이미지가 너무 크면 서버 전송 전에 브라우저에서 축소합니다.
// 배경 제거 API의 처리 시간과 payload 크기를 줄이기 위한 전처리입니다.
async function resizeImageFileForUpload(file: File, maxSide = 1280) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return file;
  context.drawImage(bitmap, 0, 0, width, height);
  return new Promise<Blob>((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? file), 'image/jpeg', 0.9);
  });
}

// 카탈로그 이미지 URL을 서버 업로드 가능한 Blob으로 변환합니다.
async function imageUrlToUploadBlob(imageUrl: string) {
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`이미지를 불러오지 못했습니다: ${response.status}`);
  return response.blob();
}

// 서버 배경 제거 API를 호출해 의류 누끼 이미지와 색상 메타데이터를 받습니다.
async function requestBackgroundRemoval(blob: Blob, fileName = 'clothing.jpg') {
  const formData = new FormData();
  formData.append('file', blob, fileName);
  const response = await fetch('/api/background/remove', { method: 'POST', body: formData });
  if (!response.ok) throw new Error(`누끼 API 오류: ${response.status}`);
  return response.json() as Promise<BackgroundRemoveResult>;
}

// 사용자가 특정 의류 부위만 다시 추출하고 싶을 때 호출하는 정밀 추출 API입니다.
async function requestPrecisionExtraction(blob: Blob, targetPart: string, fileName = 'clothing.jpg') {
  const formData = new FormData();
  formData.append('file', blob, fileName);
  formData.append('targetPart', targetPart);
  const response = await fetch('/api/clothing/extract', { method: 'POST', body: formData });
  if (!response.ok) throw new Error(`정밀 누끼 API 오류: ${response.status}`);
  return response.json() as Promise<BackgroundRemoveResult>;
}

// 수동으로 정의한 샘플 카탈로그 데이터를 앱 내부 CatalogItem 형태로 만듭니다.
function catalog(id: string, name: string, category: ClothingCategory, subcategory: string, color: string, size: string, brand: string, imageUrl: string): CatalogItem {
  const meta = buildColorMeta(category, subcategory, color);
  return { catalogItemId: id, name, category, subcategory, imageUrl, color, size, brand, ...meta, sourceType: 'catalog' };
}

// 이미지 경로에 잘못된 % 문자가 있어도 브라우저 URL 파싱이 깨지지 않게 보정합니다.
function safeAssetUrl(url: string) {
  return url.replace(/%(?![0-9A-Fa-f]{2})/g, '%25');
}

// 이미지 분석 결과의 part 정보를 사용해 카테고리를 보정합니다.
// fallback이 액세서리로 들어온 경우에도 실제로는 하의/아우터/신발일 수 있어 여기서 정리합니다.
function categoryFromMeta(meta: ClothingAnalysisMeta | undefined, fallback: ClothingCategory): ClothingCategory {
  if (fallback !== '액세서리') return fallback;
  if (meta?.part === 'lower') return '하의';
  if (meta?.part === 'outer') return '아우터';
  if (meta?.part === 'footwear') return '신발';
  if (meta?.part === 'accessory') return '액세서리';
  if (meta?.part === 'upper') return '상의';
  return fallback;
}

function isHexColor(value: string | undefined) {
  return Boolean(value && /^#[0-9a-fA-F]{6}$/.test(value));
}

function colorMetaForInput(color: string) {
  if (isHexColor(color)) return { representative: color.toUpperCase(), hex: color.toUpperCase() };
  return COLOR_META[color] ?? COLOR_META.화이트;
}

// 분석 JSON의 색상 후보 중 비율이 가장 큰 색을 대표색으로 선택합니다.
function dominantColorFromAnalysis(colors: ClothingColorAnalysis[] | undefined) {
  return [...(colors ?? [])].filter((color) => color.hex).sort((left, right) => (right.ratio ?? 0) - (left.ratio ?? 0))[0];
}

// K-means/누끼 API에서 넘어온 색상 후보를 추천 엔진이 쓰기 좋은 상위 3개 팔레트로 정리합니다.
function normalizeDominantColors(colors: ClothingColorAnalysis[] | undefined, fallbackHex: string) {
  const normalized = [...(colors ?? [])]
    .filter((color) => color.hex)
    .sort((left, right) => (right.ratio ?? 0) - (left.ratio ?? 0))
    .slice(0, 3)
    .map((color) => ({
      hex: color.hex,
      rgb: color.rgb,
      ratio: color.ratio ?? 0,
    }));
  return normalized.length > 0 ? normalized : [{ hex: fallbackHex, ratio: 1 }];
}

// 상품명에 포함된 색상 단어를 정규식으로 찾아 대표색 이름을 추정합니다.
// 이미지 분석보다 상품명이 더 명확한 경우를 보완하기 위한 규칙입니다.
function colorNameFromProductName(name: string) {
  return COLOR_NAME_PATTERNS.find(([pattern]) => pattern.test(name))?.[1];
}

function normalizePatternType(value: string | undefined): PatternType {
  if (!value) return 'solid';
  if (/stripe|스트라이프|줄무늬/i.test(value)) return 'stripe';
  if (/plaid|check|체크|타탄|깅엄/i.test(value)) return 'plaid';
  if (/graphic|그래픽|로고|프린트|레터링|캐릭터/i.test(value)) return 'graphic';
  return 'solid';
}

function inferPatternType(text: string): PatternType {
  return normalizePatternType(text);
}

function inferDenimWash(text: string, hex: string | undefined): DenimWash | undefined {
  if (/흑청|black denim|washed black/i.test(text)) return 'black';
  if (/연청|light denim|light blue/i.test(text)) return 'light';
  if (/중청|mid denim|medium blue/i.test(text)) return 'mid';
  if (/진청|생지|raw denim|dark denim|indigo/i.test(text)) return 'dark';
  if (!hex) return undefined;

  const { r, g, b } = hexToRgb(hex);
  const brightness = (r * 0.299) + (g * 0.587) + (b * 0.114);
  const blueBias = b - Math.max(r, g);
  if (brightness < 58) return 'black';
  if (brightness > 150 && blueBias > 5) return 'light';
  if (brightness > 90) return 'mid';
  return 'dark';
}

function inferMaterial(category: ClothingCategory, type: string, color: string, sourceText = ''): MaterialType {
  const text = `${category} ${type} ${color} ${sourceText}`;
  if (/데님|청바지|청자켓|jean|denim/i.test(text)) return 'denim';
  if (/니트|가디건|스웨터|knit/i.test(text)) return 'knit';
  if (/레더|가죽|leather/i.test(text)) return 'leather';
  if (/나일론|윈드브레이커|바람막이|nylon|wind/i.test(text)) return 'nylon';
  if (/울|wool|코트/i.test(text)) return 'wool';
  if (/셔츠|티셔츠|맨투맨|반팔|긴팔|cotton/i.test(text)) return 'cotton';
  return 'unknown';
}

function displayClothingColor(item: Pick<ClothingItem, 'representativeColor' | 'representativeHex' | 'isDenim' | 'denimWash'>) {
  if (item.isDenim && item.denimWash) return DENIM_WASH_LABELS[item.denimWash];
  return isHexColor(item.representativeColor) ? item.representativeHex : item.representativeColor;
}

// 이미지 분석 메타데이터와 파일명/기본값을 합쳐 CatalogItem을 생성합니다.
// 상품명 색상은 라벨 용도로만 사용하고, 실제 대표 HEX는 분석 dominant HEX를 우선 보존합니다.
function catalogFromAnalysis(
  id: string,
  name: string,
  category: ClothingCategory,
  subcategory: string,
  fallbackColor: string,
  size: string,
  brand: string,
  imageUrl: string,
  meta: ClothingAnalysisMeta | undefined,
): CatalogItem {
  const dominantColor = dominantColorFromAnalysis(meta?.colors);
  const color = colorNameFromProductName(name) ?? dominantColor?.hex ?? fallbackColor;
  const baseMeta = buildColorMeta(category, subcategory, color, meta?.colors, name);
  return {
    catalogItemId: id,
    name,
    category,
    subcategory,
    imageUrl,
    color,
    size,
    brand,
    ...baseMeta,
    representativeHex: dominantColor?.hex ?? baseMeta.representativeHex,
    sourceType: 'catalog',
  };
}

// 색상명과 의류 타입에서 추천 계산에 필요한 대표 HEX, 계절 태그, 패턴/재질/데님 워시를 파생합니다.
function buildColorMeta(category: ClothingCategory, type: string, color: string, colors?: ClothingColorAnalysis[], sourceText = '') {
  const colorMeta = colorMetaForInput(color);
  const text = `${category} ${type} ${color} ${sourceText}`;
  const material = inferMaterial(category, type, color, sourceText);
  const isDenim = material === 'denim' || Boolean((COLOR_META[color]?.denim) || /청|데님|jean|denim/i.test(text));
  const dominantColors = normalizeDominantColors(colors, colorMeta.hex);
  const primaryHex = dominantColors[0]?.hex ?? colorMeta.hex;
  const denimWash = isDenim ? inferDenimWash(text, primaryHex) : undefined;
  const representativeColor = isDenim && denimWash ? DENIM_WASH_LABELS[denimWash] : colorMeta.representative;
  return {
    representativeColor,
    representativeHex: primaryHex,
    dominantColors,
    seasonTag: getSeasonTag(type, category),
    patternType: inferPatternType(text),
    material,
    isNeutral: Boolean(COLOR_META[color]?.neutral),
    isDenim,
    denimWash,
  };
}

// 의류 타입/카테고리로 착용 계절 태그를 추정합니다.
// 이 값은 날씨 추천에서 여름옷/겨울옷을 감점하거나 보너스 주는 기준으로 쓰입니다.
function getSeasonTag(type: string, category: ClothingCategory) {
  if (type.includes('패딩') || type.includes('코트') || type.includes('니트')) return '겨울';
  if (type.includes('반팔') || type.includes('반바지') || type.includes('샌들')) return '여름';
  if (category === '아우터' || type.includes('셔츠') || type.includes('블레이저')) return '봄/가을';
  return '사계절';
}

const INITIAL_WARDROBES: Wardrobe[] = [
  { id: 'w-demo-1', name: '출근용 옷장', createdAt: '2026-04-24T00:00:00.000Z' },
  { id: 'w-demo-2', name: '주말 캐주얼 옷장', createdAt: '2026-04-24T00:00:00.000Z' },
  { id: 'w-demo-3', name: '발표/중요 일정 옷장', createdAt: '2026-04-24T00:00:00.000Z' },
];

const INITIAL_CATALOG_ITEMS: CatalogItem[] = [
  catalog('catalog-1', '베이직 무지 화이트 반팔 티셔츠', '상의', '반팔티', '화이트', 'M', 'Fitly Basic', 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=700&q=80'),
  catalog('catalog-2', '오버핏 스트라이프 셔츠', '상의', '셔츠', '블루', 'M', 'Monday Label', 'https://images.unsplash.com/photo-1596755094514-f87e32f85e2c?auto=format&fit=crop&w=700&q=80'),
  catalog('catalog-3', '블록 꼬지 터틀넥 니트', '상의', '니트', '아이보리', 'S', 'Soft Day', 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?auto=format&fit=crop&w=700&q=80'),
  catalog('catalog-4', '파스텔 크롭 가디건', '상의', '가디건', '핑크', 'S', 'Cotton Room', 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=700&q=80'),
  catalog('catalog-5', '빈티지 그래픽 맨투맨', '상의', '맨투맨', '블랙', 'L', 'Graphic Lab', 'https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?auto=format&fit=crop&w=700&q=80'),
  catalog('catalog-6', '스트레이트 핏 연청 데님', '하의', '청바지', '데님', '28', 'Denim Standard', 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=700&q=80'),
  catalog('catalog-7', '와이드 핀턱 슬랙스', '하의', '슬랙스', '블랙', '29', 'Office Form', 'https://images.unsplash.com/photo-1506629905607-d9c297d4c040?auto=format&fit=crop&w=700&q=80'),
  catalog('catalog-8', '치노 숏 팬츠', '하의', '반바지', '베이지', '28', 'Sunny Wear', 'https://images.unsplash.com/photo-1591195853828-11db59a44f6b?auto=format&fit=crop&w=700&q=80'),
  catalog('catalog-9', '롱 플리츠 스커트', '하의', '스커트', '카키', 'M', 'Calm Line', 'https://images.unsplash.com/photo-1583496661160-fb5886a13d27?auto=format&fit=crop&w=700&q=80'),
  catalog('catalog-10', '생지 데님 팬츠', '하의', '청바지', '데님', '29', 'Denim Standard', 'https://images.unsplash.com/photo-1473966968600-fa801b869a1a?auto=format&fit=crop&w=700&q=80'),
  catalog('catalog-11', '싱글 버튼 오버핏 블레이저', '아우터', '블레이저', '브라운', 'M', 'Office Form', 'https://images.unsplash.com/photo-1551489186-cf8726f514f8?auto=format&fit=crop&w=700&q=80'),
  catalog('catalog-12', '클래식 비건 레더 자켓', '아우터', '재킷', '블랙', 'M', 'Monday Label', 'https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=700&q=80'),
  catalog('catalog-13', '베이직 트렌치 코트', '아우터', '트렌치코트', '베이지', 'M', 'Soft Day', 'https://images.unsplash.com/photo-1520975954732-35dd22299614?auto=format&fit=crop&w=700&q=80'),
  catalog('catalog-14', '루즈핏 청자켓', '아우터', '재킷', '데님', 'M', 'Denim Standard', 'https://images.unsplash.com/photo-1544966503-7cc5ac882d5f?auto=format&fit=crop&w=700&q=80'),
  catalog('catalog-15', '경량 필딩 자켓', '아우터', '재킷', '카키', 'L', 'Daily Layer', 'https://images.unsplash.com/photo-1548883354-94bcfe321cbb?auto=format&fit=crop&w=700&q=80'),
  catalog('catalog-16', '화이트 스니커즈', '신발', '스니커즈', '화이트', '270', 'Clean Step', 'https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=700&q=80'),
];

const ACTIVE_CATALOG_ITEMS = TRAINING_CATALOG_ITEMS;

// 카탈로그 상품을 사용자의 특정 옷장에 들어가는 실제 ClothingItem으로 복사합니다.
// 같은 카탈로그라도 옷장별로 별도 id를 갖게 해 삭제/상태 변경을 독립적으로 처리합니다.
function fromCatalog(item: CatalogItem, wardrobeId: string): ClothingItem {
  return {
    id: `c-${wardrobeId}-${item.catalogItemId}`,
    wardrobeId,
    imageUrl: item.imageUrl,
    category: item.category,
    type: item.subcategory,
    color: item.color,
    size: item.size,
    brand: item.brand,
    createdAt: new Date().toISOString(),
    representativeColor: item.representativeColor,
    representativeHex: item.representativeHex,
    dominantColors: item.dominantColors,
    seasonTag: item.seasonTag,
    patternType: item.patternType,
    material: item.material,
    availabilityStatus: '보유중',
    isNeutral: item.isNeutral,
    isDenim: item.isDenim,
    denimWash: item.denimWash,
    sourceType: 'catalog',
    catalogItemId: item.catalogItemId,
  };
}

function catalogToDailyLookItem(item: CatalogItem): ScoredClothingItem {
  return {
    ...fromCatalog(item, 'catalog-dailylook'),
    id: `catalog-dailylook-${item.catalogItemId}`,
    personalFitScore: null,
    fitGrade: null,
    fitReason: '카탈로그에서 데일리룩 만들기에 추가한 아이템입니다.',
    avoidRisk: false,
  };
}

const INITIAL_CLOTHING: ClothingItem[] = [];

// localStorage에서 JSON 데이터를 읽고 실패하면 fallback을 반환합니다.
// 저장 데이터가 깨져도 앱이 빈 화면으로 죽지 않게 하는 방어 코드입니다.
function loadJson<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}

// 앱 상태를 localStorage에 저장합니다.
// 저장 실패는 사용자 흐름을 막지 않도록 console 경고로만 남깁니다.
function saveJson<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // 누끼 PNG data URL이 커질 수 있으므로 저장소 한도 초과가 앱 전체 오류로 번지지 않게 막습니다.
    console.warn(`localStorage 저장 실패: ${key}`, error);
  }
}

function normalizeClothingMeta(item: ClothingItem): ClothingItem {
  const meta = buildColorMeta(item.category, item.type, item.color, item.dominantColors ?? item.segmentation?.colors, item.brand);
  return {
    ...item,
    representativeColor: item.representativeColor ?? meta.representativeColor,
    representativeHex: item.representativeHex ?? meta.representativeHex,
    dominantColors: item.dominantColors?.length ? item.dominantColors : meta.dominantColors,
    patternType: normalizePatternType(item.patternType),
    material: item.material ?? meta.material,
    isNeutral: item.isNeutral ?? meta.isNeutral,
    isDenim: item.isDenim ?? meta.isDenim,
    denimWash: item.denimWash ?? meta.denimWash,
  };
}

// 저장된 카탈로그 의류를 최신 카탈로그 메타데이터와 동기화합니다.
// 이미지 경로나 분석 메타가 바뀌어도 기존 사용자의 옷장 항목이 최신 기준을 따르게 합니다.
function reconcileStoredClothing(items: ClothingItem[]) {
  const catalogMap = new Map(ACTIVE_CATALOG_ITEMS.map((item) => [item.catalogItemId, item]));
  return items
    .filter((item) => item.sourceType !== 'catalog' || item.catalogItemId?.startsWith('catalog-'))
    .map((item) => {
      if (item.sourceType !== 'catalog') return normalizeClothingMeta(item);
      const catalogItem = catalogMap.get(item.catalogItemId ?? '');
      if (!catalogItem) return normalizeClothingMeta(item);
      return normalizeClothingMeta({
        ...item,
        imageUrl: catalogItem.imageUrl,
        category: catalogItem.category,
        type: catalogItem.subcategory,
        color: catalogItem.color,
        brand: catalogItem.brand,
        representativeColor: catalogItem.representativeColor,
        representativeHex: catalogItem.representativeHex,
        dominantColors: catalogItem.dominantColors,
        seasonTag: catalogItem.seasonTag,
        patternType: catalogItem.patternType,
        material: catalogItem.material,
        isNeutral: catalogItem.isNeutral,
        isDenim: catalogItem.isDenim,
        denimWash: catalogItem.denimWash,
      });
    });
}

// 모바일 레이아웃/카메라 처리 분기를 위한 viewport 검사입니다.
function isMobileViewport() {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 860px)').matches;
}

// 숫자 적합도 점수를 UI용 등급 라벨로 변환합니다.
function gradeFromScore(score: number): FitGrade {
  if (score >= 88) return 'BEST';
  if (score >= 74) return 'GOOD';
  if (score >= 58) return 'OK';
  return 'CHECK';
}

// 단일 HEX에 대해 팔레트 점수와 회피 페널티를 계산합니다.
function scoreSingleHex(
  hex: string,
  paletteLabs: LabColor[],
  avoidLabs: LabColor[],
): { paletteScore: number; avoidPenalty: number } {
  const lab = rgbToLab(hexToRgb(hex));
  const paletteDistance = Math.min(...paletteLabs.map((p) => deltaE2000(lab, p)));
  const avoidDistance = avoidLabs.length ? Math.min(...avoidLabs.map((a) => deltaE2000(lab, a))) : 100;
  return {
    paletteScore: Math.max(0, 100 - paletteDistance * 4.5),
    avoidPenalty: avoidDistance < 10 ? 22 : avoidDistance < 16 ? 10 : 0,
  };
}

// 의류 대표색과 사용자의 퍼스널컬러 팔레트를 비교해 의류 적합도를 계산합니다.
// dominantColors 배열이 있으면 최대 3색을 비율 가중 평균으로 매칭해 체크/스트라이프 의류 정확도를 높입니다.
function scoreItemForPersonalColor(item: ClothingItem, result: FinalResult | null): ScoredClothingItem {
  if (!result) {
    return {
      ...item,
      personalFitScore: null,
      fitGrade: null,
      fitReason: '측정 후 계산됨',
      avoidRisk: false,
    };
  }

  const worstColors = SEASON_DETAILS[result.seasonTop1Id]?.worstColors ?? [];
  const paletteLabs = result.palette.map((hex) => rgbToLab(hexToRgb(hex)));
  const avoidLabs = worstColors.map((hex) => rgbToLab(hexToRgb(hex)));

  // dominantColors가 있으면 상위 3색 비율 가중 평균, 없으면 대표색 단일값 사용
  const colorSamples: { hex: string; ratio: number }[] =
    item.dominantColors && item.dominantColors.length > 0
      ? item.dominantColors.slice(0, 3).map((c) => ({ hex: c.hex ?? item.representativeHex, ratio: c.ratio ?? 1 }))
      : [{ hex: item.representativeHex, ratio: 1 }];

  const totalRatio = colorSamples.reduce((sum, c) => sum + c.ratio, 0) || 1;
  let weightedPaletteScore = 0;
  let weightedAvoidPenalty = 0;
  for (const { hex, ratio } of colorSamples) {
    const w = ratio / totalRatio;
    const { paletteScore, avoidPenalty } = scoreSingleHex(hex, paletteLabs, avoidLabs);
    weightedPaletteScore += paletteScore * w;
    weightedAvoidPenalty += avoidPenalty * w;
  }

  const utilityBonus = item.isNeutral || item.isDenim ? 8 : 0;
  const score = Math.max(0, Math.min(100, Math.round(weightedPaletteScore + utilityBonus - weightedAvoidPenalty)));

  return {
    ...item,
    personalFitScore: score,
    fitGrade: gradeFromScore(score),
    fitReason: `${SEASON_LABELS[result.seasonTop1Id]} 팔레트 기준 ${score}점`,
    avoidRisk: weightedAvoidPenalty > 5,
  };
}

// 의류 하나가 현재 날씨 구간에 얼마나 맞는지 점수화합니다.
// 상태값(세탁중/보관중/추천제외)도 함께 반영해 실제 착용 가능성을 점수에 넣습니다.
function getWeatherScore(item: ScoredClothingItem, band: RecommendationWeatherBand) {
  if (band === '상관없음') {
    if (item.availabilityStatus === '추천제외') return 0;
    if (item.availabilityStatus === '세탁중') return 35;
    if (item.availabilityStatus === '보관중') return 55;
    return item.isNeutral || item.isDenim ? 82 : 72;
  }
  const keywords = getAllowedWeatherKeywords(band);
  if (item.availabilityStatus === '추천제외') return 0;
  if (item.availabilityStatus === '세탁중') return 20;
  if (item.availabilityStatus === '보관중') return 45;
  let score = 60;
  if (keywords.some((keyword) => item.type.includes(keyword))) score += 28;
  if (item.seasonTag === '사계절') score += 8;
  if (band.includes('28') && item.seasonTag === '겨울') score -= 30;
  if ((band.includes('4') || band.includes('5~8')) && item.seasonTag === '여름') score -= 25;
  return Math.max(0, Math.min(100, score));
}

// 같은 카탈로그 상품이 여러 번 추천 후보에 들어오는 것을 막기 위한 중복 기준 키입니다.
function itemUniqueKey(item: ScoredClothingItem) {
  return item.catalogItemId ?? item.imageUrl;
}

// 추천 후보 배열에서 같은 상품을 한 번만 남깁니다.
function dedupeRecommendationItems(items: ScoredClothingItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = itemUniqueKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// 코디 조합 중복을 막기 위해 아이템 키를 정렬해 조합 키로 만듭니다.
function outfitUniqueKey(items: ScoredClothingItem[]) {
  return items.map(itemUniqueKey).sort().join('|');
}

// HSL 색상환에서 두 HEX 색상의 hue 각도 차이를 0~180° 범위로 반환합니다.
function hueAngleDiff(hex1: string, hex2: string): number {
  const h1 = rgbToHsl(hexToRgb(hex1)).h * 360;
  const h2 = rgbToHsl(hexToRgb(hex2)).h * 360;
  const diff = Math.abs(h1 - h2);
  return diff > 180 ? 360 - diff : diff;
}

// Itten 색상 이론에 따른 조화 유형과 기본 점수입니다.
const HARMONY_BASE_SCORES: Record<string, number> = {
  monochromatic: 80,  // 0~15°: 같은 색 명도/채도 변주
  analogous: 82,      // 16~45°: 인접색, 차분하고 통일감 있음
  tension: 55,        // 46~90°: 어색한 충돌 구간
  triadic: 76,        // 91~135°: 균형 잡힌 3색 조화
  complementary: 88,  // 136~180°: 보색, 강하고 세련된 대비
};

function classifyHarmonyType(angleDiff: number): string {
  if (angleDiff <= 15) return 'monochromatic';
  if (angleDiff <= 45) return 'analogous';
  if (angleDiff <= 90) return 'tension';
  if (angleDiff <= 135) return 'triadic';
  return 'complementary';
}

const HARMONY_TITLE_KO: Record<string, string> = {
  monochromatic: '심플 모노톤',
  analogous: '자연스러운 유사색',
  tension: '포인트 배색',
  triadic: '다채로운 삼색',
  complementary: '선명한 대비',
  neutral: '차분한 무채색',
};

const HARMONY_BADGE_KO: Record<string, string> = {
  monochromatic: '단색 조화',
  analogous: '유사색 조화',
  tension: '포인트 배색',
  triadic: '삼각 배색',
  complementary: '보색 대비',
  neutral: '무채색 조화',
};

function getHarmonyType(items: ScoredClothingItem[]): string {
  const top = items.find((i) => i.category === '상의');
  const bottom = items.find((i) => i.category === '하의');
  if (!top || !bottom) return 'neutral';
  if (top.isNeutral || bottom.isNeutral) return 'neutral';
  return classifyHarmonyType(hueAngleDiff(top.representativeHex, bottom.representativeHex));
}

function scoreGrade(score: number): string {
  if (score >= 90) return 'S';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  return 'D';
}

// 코디 내 패턴 조합 페널티를 계산합니다. 그래픽+솔리드, 같은 패턴 중복은 감점됩니다.
function calculatePatternPenalty(items: ScoredClothingItem[]): number {
  const patterns = items.map((i) => i.patternType).filter((p) => p !== 'solid');
  if (patterns.length <= 1) return 0;
  if (patterns.includes('graphic') && patterns.length > 1) return 22;
  if (patterns[0] === patterns[1]) return 14;
  return 8;
}

// Itten 색상 이론 기반 hue 각도로 조화 유형을 분류하고, 퍼스널컬러 시즌의 대비 선호도로 점수를 조정합니다.
function calculateHarmonyScore(items: ScoredClothingItem[], result: FinalResult | null): number {
  const top = items.find((i) => i.category === '상의');
  const bottom = items.find((i) => i.category === '하의');
  if (!top || !bottom) return 75;

  const patternPenalty = calculatePatternPenalty(items);

  // 중성색은 hue가 무의미하므로 별도 처리합니다.
  if (top.isNeutral || bottom.isNeutral) {
    return Math.min(100, Math.max(0, 85 - patternPenalty));
  }

  const angleDiff = hueAngleDiff(top.representativeHex, bottom.representativeHex);
  const harmonyType = classifyHarmonyType(angleDiff);
  let score = HARMONY_BASE_SCORES[harmonyType];

  // 시즌 대비 선호도에 따라 타입별 가산/감산을 적용합니다.
  const preferredContrast = result ? SEASON_PROFILES[result.seasonTop1Id].traits.contrast : 0;
  if (harmonyType === 'complementary') score += preferredContrast > 0.5 ? 6 : preferredContrast < -0.2 ? -10 : 0;
  if (harmonyType === 'analogous') score += preferredContrast < -0.2 ? 6 : 0;

  return Math.min(100, Math.max(0, score - patternPenalty));
}

// 동일 아이템이 결과 목록에 과도하게 반복되지 않도록 아이템당 최대 등장 횟수를 제한합니다.
function diversifyRecommendations(outfits: OutfitRecommendation[], maxPerItem = 3): OutfitRecommendation[] {
  const appearances = new Map<string, number>();
  return outfits.filter((outfit) => {
    if (outfit.items.some((item) => (appearances.get(item.id) ?? 0) >= maxPerItem)) return false;
    outfit.items.forEach((item) => appearances.set(item.id, (appearances.get(item.id) ?? 0) + 1));
    return true;
  });
}

// 상의/하의/아우터/신발 후보를 조합해 코디 추천 리스트를 만듭니다.
// 최종 점수는 퍼스널컬러 38%, 날씨 22%, 색상 조화 28%, 착용 안정성 12%로 계산합니다.
function buildRecommendations(items: ScoredClothingItem[], band: RecommendationWeatherBand, mode: RecommendationMode, result: FinalResult | null): OutfitRecommendation[] {
  const available = dedupeRecommendationItems(items.filter((item) => item.availabilityStatus !== '추천제외' && item.availabilityStatus !== '세탁중'));
  const weatherFiltered = band === '상관없음' ? available : available.filter((item) => isWeatherEligible(item, band));
  const tops = weatherFiltered.filter((item) => item.category === '상의');
  const bottoms = weatherFiltered.filter((item) => item.category === '하의');
  const outerwear = weatherFiltered.filter((item) => item.category === '아우터');
  const outfits: OutfitRecommendation[] = [];
  const seenOutfits = new Set<string>();
  const outerOptions = [undefined, ...outerwear.sort((a, b) => getWeatherScore(b, band) - getWeatherScore(a, band))];

  tops.forEach((top) => {
    bottoms.forEach((bottom) => {
      outerOptions.forEach((outer) => {
        const outfitItems = dedupeRecommendationItems([outer, top, bottom].filter(Boolean) as ScoredClothingItem[]);
        if (outfitItems.length < 2) return;
        const key = outfitUniqueKey(outfitItems);
        if (seenOutfits.has(key)) return;
        seenOutfits.add(key);
        const personalScore = Math.round(outfitItems.reduce((sum, item) => sum + (item.personalFitScore ?? 55), 0) / outfitItems.length);
        const weatherScore = Math.round(outfitItems.reduce((sum, item) => sum + getWeatherScore(item, band), 0) / outfitItems.length);
        const harmonyScore = calculateHarmonyScore(outfitItems, result);
        const stabilityScore = outfitItems.every((item) => item.availabilityStatus === '보유중') ? 92 : 68;
        const score = Math.round(personalScore * 0.38 + weatherScore * 0.22 + harmonyScore * 0.28 + stabilityScore * 0.12);
        const harmonyType = getHarmonyType(outfitItems);
        outfits.push({
          id: `${top.id}-${bottom.id}-${outer?.id ?? 'noouter'}`,
          title: `${HARMONY_TITLE_KO[harmonyType] ?? ''} ${mode} 코디`,
          harmonyType,
          score,
          personalScore,
          harmonyScore,
          weatherScore,
          stabilityScore,
          items: outfitItems,
          reason: band === '상관없음' ? '퍼스널 컬러 적합도와 코디 안정성을 우선 반영했습니다.' : `퍼스널 컬러 적합도와 ${band} 날씨 조건을 함께 반영했습니다.`,
          weatherBand: band,
          mode,
        });
      });
    });
  });

  return diversifyRecommendations(outfits.sort((a, b) => b.score - a.score).slice(0, 60));
}

// 앱의 최상위 상태 컨테이너입니다.
// 퍼스널컬러 결과, 옷장/의류, 추천 코디, 저장 코디, 라우팅 상태를 여기서 관리하고 하위 화면에 props로 내려줍니다.
function App() {
  const [page, setPage] = useState<Page>('home');
  const [analysisStep, setAnalysisStep] = useState<AnalysisStep>('photo');
  const [photoData, setPhotoData] = useState<PhotoAnalysisResult | null>(null);
  const [personalColorResult, setPersonalColorResult] = useState<FinalResult | null>(() => loadJson<FinalResult | null>(STORAGE_KEYS.personalColor, null));
  const [personalColorHistory, setPersonalColorHistory] = useState<PersonalColorRecord[]>(() => loadJson<PersonalColorRecord[]>(STORAGE_KEYS.personalHistory, []));
  const [wardrobes, setWardrobes] = useState<Wardrobe[]>(() => loadJson(STORAGE_KEYS.wardrobes, INITIAL_WARDROBES));
  const [clothingItems, setClothingItems] = useState<ClothingItem[]>(() => reconcileStoredClothing(loadJson(STORAGE_KEYS.clothing, INITIAL_CLOTHING)));
  const [savedOutfits, setSavedOutfits] = useState<SavedOutfit[]>(() => loadJson(STORAGE_KEYS.saved, []));
  const [activeTryOnOutfitId, setActiveTryOnOutfitId] = useState<string | null>(null);
  const [selectedWardrobeId, setSelectedWardrobeId] = useState(() => INITIAL_WARDROBES[0].id);
  const [wardrobeView, setWardrobeView] = useState<WardrobeView>('list');
  const [catalogCategory, setCatalogCategory] = useState<'전체' | ClothingCategory>('전체');
  const [detailCategory, setDetailCategory] = useState<'전체' | ClothingCategory>('전체');
  const [selectedCatalogIds, setSelectedCatalogIds] = useState<string[]>([]);
  const [catalogSaveMode, setCatalogSaveMode] = useState<'create' | 'append'>('append');
  const [newWardrobeName, setNewWardrobeName] = useState('나의 새 옷장');
  const [wardrobeSearch, setWardrobeSearch] = useState('');
  const [detailSearch, setDetailSearch] = useState('');
  const [detailLayout, setDetailLayout] = useState<'grid' | 'list'>('grid');
  const [recommendMode, setRecommendMode] = useState<RecommendationMode>('데일리');
  const [recommendSearch, setRecommendSearch] = useState('');
  const [recommendRequested, setRecommendRequested] = useState(false);
  const [selectedRecommendWardrobes, setSelectedRecommendWardrobes] = useState<Set<string>>(() => new Set(INITIAL_WARDROBES.map((item) => item.id)));
  const weatherState = useWeather();
  const [weatherBand, setWeatherBand] = useState<RecommendationWeatherBand>('20~22도');
  const [weatherTouched, setWeatherTouched] = useState(false);
  const [manual, setManual] = useState({
    imageUrl: '',
    originalImageUrl: '',
    cutoutImageUrl: '',
    imageFile: null as File | null,
    segmentation: null as ClothingSegmentationMeta | null,
    category: '상의' as ClothingCategory,
    type: '반팔티',
    color: '화이트',
    size: 'M',
    brand: '',
    seasonTag: '사계절',
    availabilityStatus: '보유중' as AvailabilityStatus,
    predictedSeasonTag: null as string | null,
    predictedMaterial: null as string | null,
  });
  const [backgroundRemoveStatus, setBackgroundRemoveStatus] = useState<'idle' | 'processing' | 'done' | 'error'>('idle');
  const [backgroundRemoveError, setBackgroundRemoveError] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const routeStateRef = useRef<AppRouteState>({
    page: 'home',
    analysisStep: 'photo',
    wardrobeView: 'list',
    selectedWardrobeId: INITIAL_WARDROBES[0].id,
  });
  const routeInitializedRef = useRef(false);

  const getRouteState = (): AppRouteState => ({
    page,
    analysisStep,
    wardrobeView,
    selectedWardrobeId,
  });

  const sameRoute = (left: AppRouteState, right: AppRouteState) =>
    left.page === right.page &&
    left.analysisStep === right.analysisStep &&
    left.wardrobeView === right.wardrobeView &&
    left.selectedWardrobeId === right.selectedWardrobeId;

  const applyRouteState = (route: Partial<AppRouteState>) => {
    const next: AppRouteState = {
      ...routeStateRef.current,
      ...route,
    };
    routeStateRef.current = next;
    setPage(next.page);
    setAnalysisStep(next.analysisStep);
    setWardrobeView(next.wardrobeView);
    setSelectedWardrobeId(next.selectedWardrobeId);
  };

  const navigate = (route: Partial<AppRouteState>, options: { replace?: boolean } = {}) => {
    const next: AppRouteState = {
      ...getRouteState(),
      ...route,
    };

    if (sameRoute(routeStateRef.current, next)) return;

    applyRouteState(next);

    if (typeof window === 'undefined') return;
    const historyState = { fitlyRoute: next };
    if (options.replace) {
      window.history.replaceState(historyState, '', window.location.href);
    } else {
      window.history.pushState(historyState, '', window.location.href);
    }
  };

  const goPage = (nextPage: Page) => {
    navigate({
      page: nextPage,
      analysisStep: nextPage === 'personal' ? 'photo' : analysisStep,
      wardrobeView: nextPage === 'wardrobe' ? 'list' : wardrobeView,
    });
  };

  const goBack = () => {
    if (typeof window === 'undefined') {
      navigate({ page: 'home' }, { replace: true });
      return;
    }
    window.history.back();
  };

  useEffect(() => {
    routeStateRef.current = getRouteState();
  }, [page, analysisStep, wardrobeView, selectedWardrobeId]);

  useEffect(() => {
    if (routeInitializedRef.current || typeof window === 'undefined') return;
    routeInitializedRef.current = true;
    const initialRoute = getRouteState();
    routeStateRef.current = initialRoute;
    window.history.replaceState({ fitlyRoute: initialRoute }, '', window.location.href);

    const handlePopState = (event: PopStateEvent) => {
      const route = event.state?.fitlyRoute as AppRouteState | undefined;
      applyRouteState(route ?? {
        page: 'home',
        analysisStep: 'photo',
        wardrobeView: 'list',
        selectedWardrobeId: wardrobes[0]?.id ?? INITIAL_WARDROBES[0].id,
      });
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (!weatherTouched && weatherState.data) setWeatherBand(weatherState.data.weatherBand);
  }, [weatherState.data, weatherTouched]);

  useEffect(() => {
    if (!personalColorResult || personalColorHistory.length > 0) return;
    const migrated = [{ id: `pc-${Date.now()}`, measuredAt: new Date().toISOString(), result: personalColorResult }];
    setPersonalColorHistory(migrated);
    saveJson(STORAGE_KEYS.personalHistory, migrated);
  }, [personalColorHistory.length, personalColorResult]);

  useEffect(() => {
    if (!wardrobes.some((wardrobe) => wardrobe.id === selectedWardrobeId)) {
      setSelectedWardrobeId(wardrobes[0]?.id ?? '');
    }
    setSelectedRecommendWardrobes((prev) => {
      const next = new Set([...prev].filter((id) => wardrobes.some((wardrobe) => wardrobe.id === id)));
      if (next.size === 0) wardrobes.forEach((wardrobe) => next.add(wardrobe.id));
      return next;
    });
  }, [selectedWardrobeId, wardrobes]);

  const scoredItems = useMemo(() => clothingItems.map((item) => scoreItemForPersonalColor(item, personalColorResult)), [clothingItems, personalColorResult]);
  const dailyLookSourceItems = useMemo(() => [...scoredItems, ...ACTIVE_CATALOG_ITEMS.map(catalogToDailyLookItem)], [scoredItems]);
  const activeWardrobe = wardrobes.find((wardrobe) => wardrobe.id === selectedWardrobeId) ?? wardrobes[0];
  const activeItems = scoredItems.filter((item) => item.wardrobeId === activeWardrobe?.id);
  const filteredCatalog = catalogCategory === '전체' ? ACTIVE_CATALOG_ITEMS : ACTIVE_CATALOG_ITEMS.filter((item) => item.category === catalogCategory);
  const selectedCatalogItems = ACTIVE_CATALOG_ITEMS.filter((item) => selectedCatalogIds.includes(item.catalogItemId));
  const recommendItems = scoredItems.filter((item) => selectedRecommendWardrobes.has(item.wardrobeId));
  const recommendations = useMemo(() => buildRecommendations(recommendItems, weatherBand, recommendMode, personalColorResult), [recommendItems, weatherBand, recommendMode, personalColorResult]);
  const wardrobeHealthScore = Math.round(scoredItems.reduce((sum, item) => sum + (item.personalFitScore ?? 100), 0) / Math.max(scoredItems.length, 1));
  const readyWardrobeCount = wardrobes.filter((wardrobe) => {
    const items = clothingItems.filter((item) => item.wardrobeId === wardrobe.id);
    return items.some((item) => item.category === '상의') && items.some((item) => item.category === '하의');
  }).length;

  const persistWardrobes = (next: Wardrobe[]) => {
    setWardrobes(next);
    saveJson(STORAGE_KEYS.wardrobes, next);
  };

  const persistClothing = (next: ClothingItem[]) => {
    setClothingItems(next);
    saveJson(STORAGE_KEYS.clothing, next);
  };

  const completeQuestionnaire = (scores: QuestionnaireScores, rawResponses: Record<string, string>) => {
    if (!photoData) return;
    const result = fuseResults(photoData, scores, rawResponses);
    const record = { id: `pc-${Date.now()}`, measuredAt: new Date().toISOString(), result };
    const nextHistory = [record, ...personalColorHistory].slice(0, 20);
    setPersonalColorResult(result);
    setPersonalColorHistory(nextHistory);
    saveJson(STORAGE_KEYS.personalColor, result);
    saveJson(STORAGE_KEYS.personalHistory, nextHistory);
    navigate({ page: 'personal', analysisStep: 'result' });
  };

  const createWardrobe = (name: string) => {
    const wardrobe: Wardrobe = { id: `w-${Date.now()}`, name, createdAt: new Date().toISOString() };
    persistWardrobes([wardrobe, ...wardrobes]);
    setSelectedWardrobeId(wardrobe.id);
    return wardrobe.id;
  };

  const saveCatalogSelection = () => {
    if (selectedCatalogIds.length === 0) return;
    const targetWardrobeId = catalogSaveMode === 'create' ? createWardrobe(newWardrobeName.trim() || '나의 새 옷장') : activeWardrobe?.id;
    if (!targetWardrobeId) return;
    const existingCatalogIds = new Set(clothingItems.filter((item) => item.wardrobeId === targetWardrobeId).map((item) => item.catalogItemId));
    const additions = selectedCatalogItems
      .filter((item) => !existingCatalogIds.has(item.catalogItemId))
      .map((item) => fromCatalog(item, targetWardrobeId));
    persistClothing([...clothingItems, ...additions]);
    setSelectedCatalogIds([]);
    navigate({ page: 'wardrobe', wardrobeView: 'detail', selectedWardrobeId: targetWardrobeId }, { replace: true });
    setCatalogSaveMode('append');
  };

  const addManualItem = () => {
    if (!activeWardrobe) return;
    const detectedColor = dominantColorFromAnalysis(manual.segmentation?.colors);
    const meta = buildColorMeta(manual.category, manual.type, manual.color, manual.segmentation?.colors, manual.brand);
    const item: ClothingItem = {
      id: `manual-${Date.now()}`,
      wardrobeId: activeWardrobe.id,
      imageUrl: manual.cutoutImageUrl || manual.imageUrl || 'https://images.unsplash.com/photo-1648483098902-7af8f711498f?auto=format&fit=crop&w=700&q=80',
      originalImageUrl: manual.originalImageUrl || manual.imageUrl || undefined,
      cutoutImageUrl: manual.cutoutImageUrl || undefined,
      segmentation: manual.segmentation ?? undefined,
      category: manual.category,
      type: manual.type,
      color: manual.color,
      size: manual.size,
      brand: manual.brand || '직접 등록',
      createdAt: new Date().toISOString(),
      representativeColor: meta.representativeColor,
      representativeHex: detectedColor?.hex ?? meta.representativeHex,
      dominantColors: meta.dominantColors,
      seasonTag: (manual.predictedSeasonTag && manual.predictedSeasonTag !== '미분류')
        ? manual.predictedSeasonTag
        : manual.seasonTag,
      patternType: meta.patternType,
      material: (manual.predictedMaterial as MaterialType | null) ?? meta.material,
      availabilityStatus: manual.availabilityStatus,
      isNeutral: meta.isNeutral,
      isDenim: meta.isDenim,
      denimWash: meta.denimWash,
      sourceType: 'upload',
    };
    persistClothing([...clothingItems, item]);
    navigate({ page: 'wardrobe', wardrobeView: 'detail' }, { replace: true });
  };

  const deleteClothing = (id: string) => persistClothing(clothingItems.filter((item) => item.id !== id));
  const renameWardrobe = (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    persistWardrobes(wardrobes.map((wardrobe) => (wardrobe.id === id ? { ...wardrobe, name: trimmed } : wardrobe)));
  };

  const deleteWardrobe = (id: string) => {
    const nextWardrobes = wardrobes.filter((wardrobe) => wardrobe.id !== id);
    persistWardrobes(nextWardrobes);
    persistClothing(clothingItems.filter((item) => item.wardrobeId !== id));
    setSelectedWardrobeId(nextWardrobes[0]?.id ?? '');
  };

  const saveOutfit = (outfit: OutfitRecommendation) => {
    const key = outfit.items.map((item) => item.id).join(',');
    if (savedOutfits.some((saved) => saved.itemIds.join(',') === key)) return;
    const next = [{
      id: `saved-${Date.now()}`,
      title: outfit.title,
      score: outfit.score,
      itemIds: outfit.items.map((item) => item.id),
      colorHexes: outfit.items.map((item) => item.representativeHex),
      weatherBand: outfit.weatherBand,
      mode: outfit.mode,
      savedAt: new Date().toISOString(),
      dailyLookState: buildDailyLookState(outfit.items),
    }, ...savedOutfits];
    setSavedOutfits(next);
    saveJson(STORAGE_KEYS.saved, next);
  };

  const deleteSavedOutfit = (id: string) => {
    const next = savedOutfits.filter((outfit) => outfit.id !== id);
    setSavedOutfits(next);
    saveJson(STORAGE_KEYS.saved, next);
  };

  const updateSavedOutfitDailyLook = (id: string, dailyLookState: DailyLookState, itemIds?: string[]) => {
    const sourceMap = new Map<string, ScoredClothingItem>(dailyLookSourceItems.map((item) => [item.id, item]));
    const uniqueItemIds = Array.from(new Set(itemIds));
    const next = savedOutfits.map((outfit) => {
      if (outfit.id !== id) return outfit;
      const nextItemIds = itemIds ? uniqueItemIds : outfit.itemIds;
      return {
        ...outfit,
        itemIds: nextItemIds,
        colorHexes: nextItemIds.map((itemId) => sourceMap.get(itemId)?.representativeHex).filter(Boolean) as string[],
        dailyLookState,
      };
    });
    setSavedOutfits(next);
    saveJson(STORAGE_KEYS.saved, next);
  };

  const createBlankDailyLook = () => {
    const outfit: SavedOutfit = {
      id: `saved-${Date.now()}`,
      title: '새 데일리룩',
      score: 0,
      itemIds: [],
      colorHexes: [],
      weatherBand: '상관없음',
      mode: '데일리',
      savedAt: new Date().toISOString(),
      dailyLookState: buildDailyLookState([]),
    };
    const next = [outfit, ...savedOutfits];
    setSavedOutfits(next);
    saveJson(STORAGE_KEYS.saved, next);
    setActiveTryOnOutfitId(outfit.id);
    navigate({ page: 'tryon' });
  };

  const openDailyLookMaker = (id: string) => {
    setActiveTryOnOutfitId(id);
    navigate({ page: 'tryon' });
  };

  const ensureDailyLookCutouts = async (itemIds: string[]) => {
    const targets = clothingItems.filter((item) => itemIds.includes(item.id) && (!item.cutoutImageUrl || item.segmentation?.version !== CUTOUT_VERSION));
    for (const item of targets) {
      try {
        const sourceUrl = item.originalImageUrl || item.imageUrl;
        const sourceBlob = await imageUrlToUploadBlob(sourceUrl);
        const result = await requestBackgroundRemoval(sourceBlob, `${item.id}.png`);
        const detectedColor = dominantColorFromAnalysis(result.colors);
        const nextColor = detectedColor?.hex ?? item.color;
        const nextMeta = buildColorMeta(item.category, item.type, nextColor, result.colors, item.brand);
        setClothingItems((prev) => {
          const next = prev.map((entry) => entry.id === item.id ? {
            ...entry,
            imageUrl: result.imageDataUrl,
            cutoutImageUrl: result.imageDataUrl,
            originalImageUrl: entry.originalImageUrl || sourceUrl,
            segmentation: {
              width: result.width,
              height: result.height,
              bbox: result.bbox,
              colors: result.colors ?? [],
              model: result.model,
              version: result.version ?? CUTOUT_VERSION,
              processedAt: result.processedAt,
            },
            color: nextColor,
            representativeColor: nextMeta.representativeColor,
            representativeHex: detectedColor?.hex ?? nextMeta.representativeHex,
            dominantColors: nextMeta.dominantColors,
            patternType: nextMeta.patternType,
            material: nextMeta.material,
            isNeutral: nextMeta.isNeutral,
            isDenim: nextMeta.isDenim,
            denimWash: nextMeta.denimWash,
          } : entry);
          saveJson(STORAGE_KEYS.clothing, next);
          return next;
        });
      } catch (error) {
        throw new Error(`${item.type} 누끼 처리 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
      }
    }
  };

  const applyPersonalColorRecord = (record: PersonalColorRecord) => {
    const nextHistory = [record, ...personalColorHistory.filter((entry) => entry.id !== record.id)].slice(0, 20);
    setPersonalColorResult(record.result);
    setPersonalColorHistory(nextHistory);
    saveJson(STORAGE_KEYS.personalColor, record.result);
    saveJson(STORAGE_KEYS.personalHistory, nextHistory);
  };

  const resetPersonalColor = () => {
    setPersonalColorResult(null);
    setPhotoData(null);
    setAnalysisStep('photo');
    localStorage.removeItem(STORAGE_KEYS.personalColor);
    setPersonalColorHistory([]);
    localStorage.removeItem(STORAGE_KEYS.personalHistory);
  };

  const resetAllData = () => {
    resetPersonalColor();
    persistWardrobes(INITIAL_WARDROBES);
    persistClothing(INITIAL_CLOTHING);
    setSavedOutfits([]);
    saveJson(STORAGE_KEYS.saved, []);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    setManual((prev) => ({ ...prev, imageUrl: objectUrl, originalImageUrl: objectUrl, cutoutImageUrl: '', imageFile: file, segmentation: null }));
    setBackgroundRemoveStatus('idle');
    setBackgroundRemoveError('');
  };

  const removeManualBackground = async () => {
    if (!manual.imageFile) {
      setBackgroundRemoveStatus('error');
      setBackgroundRemoveError('먼저 앨범에서 이미지를 선택하거나 사진을 찍어주세요.');
      return;
    }
    setBackgroundRemoveStatus('processing');
    setBackgroundRemoveError('');
    let success = false;
    try {
      const resized = await resizeImageFileForUpload(manual.imageFile);
      const result = await requestBackgroundRemoval(resized, manual.imageFile.name || 'clothing.jpg');
      const detectedColor = dominantColorFromAnalysis(result.colors);
      setManual((prev) => ({
        ...prev,
        imageUrl: result.imageDataUrl,
        cutoutImageUrl: result.imageDataUrl,
        color: detectedColor?.hex ?? prev.color,
        segmentation: {
          width: result.width,
          height: result.height,
          bbox: result.bbox,
          colors: result.colors ?? [],
          model: result.model,
          version: result.version ?? CUTOUT_VERSION,
          processedAt: result.processedAt,
        },
      }));
      success = true;
    } catch (error) {
      setBackgroundRemoveError(error instanceof Error ? error.message : '누끼 처리에 실패했습니다.');
    } finally {
      setBackgroundRemoveStatus(success ? 'done' : 'error');
    }
  };

  const extractManualClothingPrecisely = async () => {
    if (!manual.imageFile) {
      setBackgroundRemoveStatus('error');
      setBackgroundRemoveError('먼저 앨범에서 이미지를 선택하거나 사진을 찍어주세요.');
      return;
    }
    setBackgroundRemoveStatus('processing');
    setBackgroundRemoveError('');
    let success = false;
    try {
      const resized = await resizeImageFileForUpload(manual.imageFile);
      const targetPart = PRECISION_TARGET_BY_CATEGORY[manual.category];
      const result = await requestPrecisionExtraction(resized, targetPart, manual.imageFile.name || 'clothing.jpg');
      const detectedColor = dominantColorFromAnalysis(result.colors);
      setManual((prev) => ({
        ...prev,
        imageUrl: result.imageDataUrl,
        cutoutImageUrl: result.imageDataUrl,
        color: detectedColor?.hex ?? prev.color,
        segmentation: {
          width: result.width,
          height: result.height,
          bbox: result.bbox,
          colors: result.colors ?? [],
          model: result.model,
          version: result.version ?? 'fashion-segformer-v1',
          processedAt: result.processedAt,
        },
        predictedSeasonTag: result.predictedSeason ?? null,
        predictedMaterial: result.predictedMaterial ?? null,
      }));
      success = true;
    } catch (error) {
      setBackgroundRemoveError(error instanceof Error ? error.message : '정밀 누끼 처리에 실패했습니다.');
    } finally {
      setBackgroundRemoveStatus(success ? 'done' : 'error');
    }
  };

  const handleManualCategory = (category: ClothingCategory) => {
    const size = category === '하의' ? SIZES.bottoms[0] : category === '신발' ? SIZES.shoes[0] : SIZES.tops[1];
    setManual((prev) => ({ ...prev, category, type: TYPES[category][0], size }));
  };

  const openCatalog = (mode: 'create' | 'append') => {
    setCatalogSaveMode(mode);
    setSelectedCatalogIds([]);
    setCatalogCategory('전체');
    navigate({ page: 'wardrobe', wardrobeView: 'catalog' });
  };

  return (
    <div className="fitly-shell">
      <Sidebar page={page} go={goPage} personalColorResult={personalColorResult} />
      <div className="mobile-app-frame">
        <header className="mobile-header">
          <button type="button" onClick={() => goPage('home')}><Home size={19} /></button>
          <span className="mobile-brand-title"><strong>Fitly</strong><small>Personal_Color_Project</small></span>
          <button type="button" onClick={() => goPage('settings')}><User size={17} /></button>
        </header>
        <main className="app-main">
          {page === 'home' && (
            <HomeDashboard
              personalColorResult={personalColorResult}
              wardrobes={wardrobes}
              scoredItems={scoredItems}
              savedOutfits={savedOutfits}
              weather={weatherState.data}
              weatherLoading={weatherState.loading}
              weatherError={weatherState.error}
              weatherSource={weatherState.source}
              weatherBand={weatherBand}
              refreshWeather={weatherState.refresh}
              recommendationCount={recommendations.length}
              go={goPage}
              openCatalog={() => openCatalog('create')}
              openManual={() => navigate({ page: 'wardrobe', wardrobeView: 'manual' })}
            />
          )}

          {page === 'personal' && (
            <section className="page-stack">
              <PageTitle title="나만의 퍼스널컬러 찾기" description="촬영과 설문으로 측정한 결과가 옷장 추천 기준으로 저장됩니다." icon={<Camera />} />
              {analysisStep === 'photo' && <PhotoAnalyzer onAnalysisComplete={(result) => { setPhotoData(result); navigate({ page: 'personal', analysisStep: 'questionnaire' }); }} />}
              {analysisStep === 'questionnaire' && <Questionnaire onComplete={completeQuestionnaire} />}
              {analysisStep === 'result' && personalColorResult && <PersonalResult result={personalColorResult} onRetry={() => navigate({ page: 'personal', analysisStep: 'photo' })} />}
            </section>
          )}

          {page === 'wardrobe' && (
            <WardrobeSection
              view={wardrobeView}
              setView={(view) => navigate({ page: 'wardrobe', wardrobeView: view })}
              onBack={goBack}
              wardrobes={wardrobes}
              activeWardrobe={activeWardrobe}
              allItems={scoredItems}
              activeItems={activeItems}
              wardrobeHealthScore={wardrobeHealthScore}
              readyWardrobeCount={readyWardrobeCount}
              wardrobeSearch={wardrobeSearch}
              setWardrobeSearch={setWardrobeSearch}
              detailSearch={detailSearch}
              setDetailSearch={setDetailSearch}
              detailCategory={detailCategory}
              setDetailCategory={setDetailCategory}
              detailLayout={detailLayout}
              setDetailLayout={setDetailLayout}
              catalogItems={filteredCatalog}
              catalogCategory={catalogCategory}
              setCatalogCategory={setCatalogCategory}
              selectedCatalogIds={selectedCatalogIds}
              setSelectedCatalogIds={setSelectedCatalogIds}
              selectedCatalogItems={selectedCatalogItems}
              catalogSaveMode={catalogSaveMode}
              setCatalogSaveMode={setCatalogSaveMode}
              newWardrobeName={newWardrobeName}
              setNewWardrobeName={setNewWardrobeName}
              onSelectWardrobe={(id) => navigate({ page: 'wardrobe', selectedWardrobeId: id, wardrobeView: 'detail' })}
              onRenameWardrobe={renameWardrobe}
              onDeleteWardrobe={deleteWardrobe}
              onDeleteItem={deleteClothing}
              onOpenCatalog={openCatalog}
              onSaveCatalog={saveCatalogSelection}
              onRecommend={() => {
                if (activeWardrobe) setSelectedRecommendWardrobes(new Set([activeWardrobe.id]));
                setRecommendRequested(true);
                navigate({ page: 'recommend' });
              }}
              manual={manual}
              setManual={setManual}
              fileInputRef={fileInputRef}
              cameraInputRef={cameraInputRef}
              onFileChange={handleFileChange}
              onRemoveBackground={removeManualBackground}
              onPrecisionExtract={extractManualClothingPrecisely}
              backgroundRemoveStatus={backgroundRemoveStatus}
              backgroundRemoveError={backgroundRemoveError}
              onCategory={handleManualCategory}
              onSaveManual={addManualItem}
            />
          )}

          {page === 'recommend' && (
            !personalColorResult ? (
              <section className="page-stack">
                <BackTitle title="AI 옷장 추천" description="실시간 날씨와 퍼스널컬러, 상황을 함께 반영합니다." onBack={goBack} />
                <EmptyState title="퍼스널 컬러 측정이 필요합니다." description="추천은 측정 결과가 저장된 뒤 활성화됩니다." action={<button className="black-button" type="button" onClick={() => navigate({ page: 'personal', analysisStep: 'photo' })}>측정하러 가기</button>} />
              </section>
            ) : (
              <RecommendationDashboard
                personalColorResult={personalColorResult}
                wardrobes={wardrobes}
                items={scoredItems}
                selectedWardrobes={selectedRecommendWardrobes}
                setSelectedWardrobes={setSelectedRecommendWardrobes}
                search={recommendSearch}
                setSearch={setRecommendSearch}
                mode={recommendMode}
                setMode={(value) => { setRecommendMode(value); setRecommendRequested(false); }}
                weatherBand={weatherBand}
                setWeatherBand={(value) => { setWeatherTouched(true); setWeatherBand(value); setRecommendRequested(false); }}
                weather={weatherState.data}
                weatherLoading={weatherState.loading}
                weatherError={weatherState.error}
                weatherSource={weatherState.source}
                refreshWeather={weatherState.refresh}
                recommendations={recommendations}
                requested={recommendRequested}
                setRequested={setRecommendRequested}
                onSave={saveOutfit}
                onBack={goBack}
              />
            )
          )}

          {page === 'saved' && <SavedOutfits saved={savedOutfits} items={dailyLookSourceItems} onDelete={deleteSavedOutfit} onMakeDailyLook={openDailyLookMaker} onCreateDailyLook={createBlankDailyLook} />}
          {page === 'tryon' && <TryOn saved={savedOutfits} items={dailyLookSourceItems} wardrobes={wardrobes} activeOutfitId={activeTryOnOutfitId} onSaveDailyLook={updateSavedOutfitDailyLook} onEnsureCutouts={ensureDailyLookCutouts} onBack={() => goPage('saved')} />}
          {page === 'settings' && (
            <section className="page-stack">
              <PageTitle title="설정" description="데모 사용자 1명의 저장 데이터를 관리합니다." icon={<Settings />} />
              <PersonalColorHistoryPanel history={personalColorHistory} current={personalColorResult} onApply={applyPersonalColorRecord} />
              <section className="panel settings-panel">
                <button className="line-button" type="button" onClick={resetPersonalColor}><RotateCcw size={16} /> 퍼스널 컬러 결과 초기화</button>
                <button className="black-button" type="button" onClick={resetAllData}><Check size={16} /> 전체 데모 데이터 초기화</button>
              </section>
            </section>
          )}
        </main>
        <MobileNav page={page} go={goPage} />
      </div>
    </div>
  );
}

// 데스크톱 좌측 네비게이션입니다. 현재 페이지와 진단 완료 여부를 함께 보여줍니다.
function Sidebar({ page, go, personalColorResult }: { page: Page; go: (page: Page) => void; personalColorResult: FinalResult | null }) {
  const items: Array<[Page, string, typeof Home]> = [
    ['home', '홈', Home],
    ['wardrobe', '옷장', ShoppingBag],
    ['recommend', 'AI 추천', Sparkles],
    ['saved', '데일리룩', Bookmark],
    ['settings', '설정', Settings],
  ];
  return (
    <aside className="desktop-sidebar">
      <button className="sidebar-logo" type="button" onClick={() => go('home')}>
        <span className="brand-mark">F</span>
        <span><strong>Fitly</strong><small>Personal_Color_Project</small></span>
      </button>
      <nav className="sidebar-nav">
        {items.map(([key, label, Icon]) => (
          <button key={key} className={page === key ? 'active' : ''} type="button" onClick={() => go(key)}>
            <Icon size={17} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <button className="sidebar-profile" type="button" onClick={() => go('settings')}>
        <span><User size={15} /></span>
        <span><strong>내 프로필</strong><small>{personalColorResult ? SEASON_LABELS[personalColorResult.seasonTop1Id] : '미측정'}</small></span>
      </button>
    </aside>
  );
}

// 모바일 하단 네비게이션입니다. 좁은 화면에서 주요 페이지 이동을 담당합니다.
function MobileNav({ page, go }: { page: Page; go: (page: Page) => void }) {
  const items: Array<[Page, string, typeof Home]> = [
    ['home', '홈', Home],
    ['wardrobe', '옷장', ShoppingBag],
    ['recommend', '추천', Sparkles],
    ['saved', '데일리룩', Bookmark],
    ['settings', '설정', Settings],
  ];
  return (
    <nav className="mobile-bottom-nav">
      {items.map(([key, label, Icon]) => (
        <button key={key} className={page === key ? 'active' : ''} type="button" onClick={() => go(key)}>
          <Icon size={19} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

// 각 페이지 상단의 제목/설명 영역을 통일하기 위한 작은 표시 컴포넌트입니다.
function PageTitle({ title, description, icon }: { title: string; description: string; icon?: React.ReactNode }) {
  return <div className="section-title">{icon}<div><h1>{title}</h1><p>{description}</p></div></div>;
}

// 홈 대시보드입니다. 진단 상태, 옷장 현황, 오늘 추천으로 들어가는 시작점을 제공합니다.
function HomeDashboard(props: {
  personalColorResult: FinalResult | null;
  wardrobes: Wardrobe[];
  scoredItems: ScoredClothingItem[];
  savedOutfits: SavedOutfit[];
  weather: ReturnType<typeof useWeather>['data'];
  weatherLoading: boolean;
  weatherError: string;
  weatherSource: 'geolocation' | 'fallback';
  weatherBand: RecommendationWeatherBand;
  refreshWeather: () => void;
  recommendationCount: number;
  go: (page: Page) => void;
  openCatalog: () => void;
  openManual: () => void;
}) {
  const latestOutfit = props.savedOutfits[0];
  const latestItems = latestOutfit?.itemIds.map((id) => props.scoredItems.find((item) => item.id === id)).filter(Boolean) as ScoredClothingItem[] | undefined;
  return (
    <section className="home-grid">
      <button className="home-card home-main-card" type="button" onClick={() => props.go('personal')}>
        <span className="card-kicker">Personal Color</span>
        <h1>나만의 퍼스널컬러 찾기</h1>
        <p>촬영과 설문으로 나의 퍼스널 컬러를 찾고 옷장 추천 기준으로 저장합니다.</p>
        <span className="home-link">측정 시작 <ArrowRight size={16} /></span>
      </button>
      <div className="home-side-actions">
        <button className="home-card" type="button" onClick={props.openCatalog}><h2>나만의 옷장 만들기</h2><p>DB 의류를 골라 빠르게 옷장을 구성합니다.</p></button>
        <button className="home-card" type="button" onClick={props.openManual}><h2>나만의 옷 추가</h2><p>사진 업로드와 직접 입력으로 옷을 추가합니다.</p></button>
        <button className="home-card" type="button" onClick={() => props.go('saved')}><h2>데일리룩 만들기</h2><p>저장한 데일리룩 조합을 하나의 룩 이미지로 편집합니다.</p></button>
      </div>
      <WeatherCard weather={props.weather} loading={props.weatherLoading} error={props.weatherError} source={props.weatherSource} weatherBand={props.weatherBand} refresh={props.refreshWeather} />
      <section className="home-card stat-home">
        <h2>내 옷장 현황</h2>
        <div className="home-stat-grid">
          <span><strong>{props.wardrobes.length}</strong><small>옷장</small></span>
          <span><strong>{props.scoredItems.length}</strong><small>아이템</small></span>
        </div>
      </section>
      <button className="home-card saved-home-card" type="button" onClick={() => props.go('saved')}>
        <h2>최근 데일리룩</h2>
        {latestOutfit ? (
          <>
            <p>{latestOutfit.title} · {latestOutfit.score}점</p>
            <span className="saved-home-preview">
              {latestItems?.slice(0, 4).map((item) => <img key={item.id} src={clothingDisplayImage(item)} alt={item.type} />)}
            </span>
          </>
        ) : <p>아직 저장된 데일리룩이 없습니다.</p>}
      </button>
      <section className="home-card wardrobe-mini-list">
        <h2>내 옷장 목록</h2>
        {props.wardrobes.slice(0, 3).map((wardrobe) => <button key={wardrobe.id} type="button" onClick={() => props.go('wardrobe')}>{wardrobe.name}<ChevronRight size={15} /></button>)}
      </section>
    </section>
  );
}

// 옷장 페이지의 상태 분기 컴포넌트입니다. 목록/상세/카탈로그/수동등록 화면을 현재 view에 따라 전환합니다.
function WardrobeSection(props: {
  view: WardrobeView;
  setView: (view: WardrobeView) => void;
  onBack: () => void;
  wardrobes: Wardrobe[];
  activeWardrobe?: Wardrobe;
  allItems: ScoredClothingItem[];
  activeItems: ScoredClothingItem[];
  wardrobeHealthScore: number;
  readyWardrobeCount: number;
  wardrobeSearch: string;
  setWardrobeSearch: (value: string) => void;
  detailSearch: string;
  setDetailSearch: (value: string) => void;
  detailCategory: '전체' | ClothingCategory;
  setDetailCategory: (value: '전체' | ClothingCategory) => void;
  detailLayout: 'grid' | 'list';
  setDetailLayout: (value: 'grid' | 'list') => void;
  catalogItems: CatalogItem[];
  catalogCategory: '전체' | ClothingCategory;
  setCatalogCategory: (value: '전체' | ClothingCategory) => void;
  selectedCatalogIds: string[];
  setSelectedCatalogIds: React.Dispatch<React.SetStateAction<string[]>>;
  selectedCatalogItems: CatalogItem[];
  catalogSaveMode: 'create' | 'append';
  setCatalogSaveMode: (value: 'create' | 'append') => void;
  newWardrobeName: string;
  setNewWardrobeName: (value: string) => void;
  onSelectWardrobe: (id: string) => void;
  onRenameWardrobe: (id: string, name: string) => void;
  onDeleteWardrobe: (id: string) => void;
  onDeleteItem: (id: string) => void;
  onOpenCatalog: (mode: 'create' | 'append') => void;
  onSaveCatalog: () => void;
  onRecommend: () => void;
  manual: {
    imageUrl: string;
    category: ClothingCategory;
    type: string;
    color: string;
    size: string;
    brand: string;
    seasonTag: string;
    availabilityStatus: AvailabilityStatus;
  };
  setManual: React.Dispatch<React.SetStateAction<any>>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  cameraInputRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveBackground: () => void;
  onPrecisionExtract: () => void;
  backgroundRemoveStatus: 'idle' | 'processing' | 'done' | 'error';
  backgroundRemoveError: string;
  onCategory: (category: ClothingCategory) => void;
  onSaveManual: () => void;
}) {
  if (props.view === 'detail' && props.activeWardrobe) {
    return <WardrobeDetailView {...props} activeWardrobe={props.activeWardrobe} />;
  }
  if (props.view === 'catalog') return <CatalogSelectionView {...props} />;
  if (props.view === 'preview') return <CatalogPreviewView {...props} />;
  if (props.view === 'manual') return <ManualAdd {...props} />;
  return <WardrobeOverview {...props} />;
}

// 사용자의 옷장 목록과 생성 UI를 보여주는 화면입니다.
function WardrobeOverview(props: {
  wardrobes: Wardrobe[];
  allItems: ScoredClothingItem[];
  wardrobeHealthScore: number;
  readyWardrobeCount: number;
  wardrobeSearch: string;
  setWardrobeSearch: (value: string) => void;
  onSelectWardrobe: (id: string) => void;
  onRenameWardrobe: (id: string, name: string) => void;
  onDeleteWardrobe: (id: string) => void;
  onOpenCatalog: (mode: 'create' | 'append') => void;
  onRecommend: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const filtered = props.wardrobes.filter((wardrobe) => wardrobe.name.toLowerCase().includes(props.wardrobeSearch.toLowerCase()));

  const startEditing = () => {
    setDraftNames(Object.fromEntries(props.wardrobes.map((wardrobe) => [wardrobe.id, wardrobe.name])));
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setDraftNames({});
    setIsEditing(false);
  };

  const saveEditing = () => {
    props.wardrobes.forEach((wardrobe) => {
      const nextName = draftNames[wardrobe.id];
      if (nextName !== undefined && nextName.trim() !== wardrobe.name) {
        props.onRenameWardrobe(wardrobe.id, nextName);
      }
    });
    setIsEditing(false);
  };

  return (
    <section className="wardrobe-page">
      <div className="wardrobe-heading">
        <div><h1>옷장</h1></div>
      </div>
      <div className="wardrobe-summary-row">
        <StatCard label="옷장 수" value={`${props.wardrobes.length}개`} />
        <StatCard label="전체 아이템" value={`${props.allItems.length}개`} />
      </div>
      <div className="wardrobe-toolbar">
        <label className="search-field"><Search size={17} /><input value={props.wardrobeSearch} onChange={(event) => props.setWardrobeSearch(event.target.value)} placeholder="옷장 검색..." /></label>
        {isEditing ? (
          <>
            <button className="line-button" type="button" onClick={cancelEditing}>취소</button>
            <button className="black-button" type="button" onClick={saveEditing}><Check size={16} /> 저장</button>
          </>
        ) : (
          <button className="line-button" type="button" onClick={startEditing}>수정</button>
        )}
        <button className="black-button" type="button" onClick={() => props.onOpenCatalog('create')}><Plus size={16} /> 옷장 추가</button>
      </div>
      <div className="wardrobe-card-grid">
        {filtered.map((wardrobe) => (
          <WardrobeCard
            key={wardrobe.id}
            wardrobe={wardrobe}
            items={props.allItems.filter((item) => item.wardrobeId === wardrobe.id)}
            editing={isEditing}
            draftName={draftNames[wardrobe.id] ?? wardrobe.name}
            onDraftName={(value) => setDraftNames((prev) => ({ ...prev, [wardrobe.id]: value }))}
            onOpen={() => props.onSelectWardrobe(wardrobe.id)}
            onDelete={() => props.onDeleteWardrobe(wardrobe.id)}
          />
        ))}
      </div>
    </section>
  );
}

// 작은 통계 카드입니다. 홈/옷장 요약에서 숫자 정보를 압축해 보여줍니다.
function StatCard({ label, value }: { label: string; value: string }) {
  return <section className="stat-card"><span>{label}</span><strong>{value}</strong></section>;
}

// 옷장 하나를 카드로 표시합니다. 이름 수정/삭제/상세 진입 액션을 포함합니다.
function WardrobeCard({
  wardrobe,
  items,
  editing,
  draftName,
  onDraftName,
  onOpen,
  onDelete,
}: {
  key?: React.Key;
  wardrobe: Wardrobe;
  items: ScoredClothingItem[];
  editing: boolean;
  draftName: string;
  onDraftName: (value: string) => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const counts = {
    상의: items.filter((item) => item.category === '상의').length,
    하의: items.filter((item) => item.category === '하의').length,
    아우터: items.filter((item) => item.category === '아우터').length,
  };
  return (
    <article className="wardrobe-card">
        <button className="wardrobe-mosaic" type="button" onClick={onOpen}>
        {Array.from({ length: 4 }).map((_, index) => items[index] ? <img key={items[index].id} src={clothingDisplayImage(items[index])} alt={items[index].type} /> : <span key={index} />)}
      </button>
      <div className="wardrobe-card-body">
        {editing ? (
          <label className="wardrobe-name-edit">
            <span>옷장 이름</span>
            <input value={draftName} onChange={(event) => onDraftName(event.target.value)} />
          </label>
        ) : (
          <button className="wardrobe-card-title" type="button" onClick={onOpen}>
            <span><strong>{wardrobe.name}</strong><small>{items.length}개의 옷</small></span>
            <ChevronRight size={18} />
          </button>
        )}
        <div className="pill-row"><span>상의 {counts.상의}</span><span>하의 {counts.하의}</span><span>아우터 {counts.아우터}</span></div>
        {editing && <button className="text-danger" type="button" onClick={onDelete}>삭제</button>}
      </div>
    </article>
  );
}

// 선택한 옷장 안의 의류 목록과 필터/검색/추가 진입 버튼을 보여줍니다.
function WardrobeDetailView(props: {
  activeWardrobe: Wardrobe;
  activeItems: ScoredClothingItem[];
  detailSearch: string;
  setDetailSearch: (value: string) => void;
  detailCategory: '전체' | ClothingCategory;
  setDetailCategory: (value: '전체' | ClothingCategory) => void;
  detailLayout: 'grid' | 'list';
  setDetailLayout: (value: 'grid' | 'list') => void;
  setView: (view: WardrobeView) => void;
  onBack: () => void;
  onDeleteItem: (id: string) => void;
  onOpenCatalog: (mode: 'create' | 'append') => void;
  onRecommend: () => void;
  onRenameWardrobe: (id: string, name: string) => void;
}) {
  const filtered = props.activeItems.filter((item) => (props.detailCategory === '전체' || item.category === props.detailCategory) && `${item.type} ${item.color} ${item.brand}`.toLowerCase().includes(props.detailSearch.toLowerCase()));
  const health = Math.round(props.activeItems.reduce((sum, item) => sum + (item.personalFitScore ?? 100), 0) / Math.max(props.activeItems.length, 1));
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(props.activeWardrobe.name);
  const saveName = () => {
    props.onRenameWardrobe(props.activeWardrobe.id, draftName);
    setIsEditing(false);
  };
  return (
    <section className="wardrobe-page">
      <BackTitle
        title={props.activeWardrobe.name}
        description={`${props.activeItems.length}개의 아이템`}
        onBack={props.onBack}
        right={isEditing ? (
          <div className="detail-edit-actions">
            <button className="line-button" type="button" onClick={() => { setDraftName(props.activeWardrobe.name); setIsEditing(false); }}>취소</button>
            <button className="black-button" type="button" onClick={saveName}><Check size={15} /> 저장</button>
          </div>
        ) : (
          <button className="line-button" type="button" onClick={() => setIsEditing(true)}>수정</button>
        )}
      />
      {isEditing && (
        <section className="panel wardrobe-detail-edit">
          <label>옷장 이름<input value={draftName} onChange={(event) => setDraftName(event.target.value)} /></label>
        </section>
      )}
      <section className="wardrobe-health-panel">
        <div className="health-head"><span><ShoppingBag size={17} /> 옷장 건강도</span><strong>{health}점</strong></div>
        <h2>{health >= 90 ? '구성이 좋아요.' : '보완하면 추천 품질이 더 좋아져요.'}</h2>
        <div className="health-grid">{CATEGORY_OPTIONS.slice(0, 4).map((category) => <span key={category}><small>{category}</small><strong>{props.activeItems.filter((item) => item.category === category).length}개</strong></span>)}</div>
        <p className="wardrobe-warning">겨울 대응 아이템이 적어요.</p>
      </section>
      <div className="detail-toolbar">
        <div className="catalog-tabs">{CATALOG_TABS.slice(0, 5).map((tab) => <button key={tab} className={props.detailCategory === tab ? 'active' : ''} onClick={() => props.setDetailCategory(tab)}>{tab}</button>)}</div>
        <div className="detail-actions">
          <label className="search-field compact"><Search size={15} /><input value={props.detailSearch} onChange={(event) => props.setDetailSearch(event.target.value)} placeholder="색상/대표색/브랜드 검색..." /></label>
          <button className={props.detailLayout === 'grid' ? 'icon-button active' : 'icon-button'} type="button" onClick={() => props.setDetailLayout('grid')} aria-label="격자 보기"><Grid2X2 size={16} /></button>
          <button className={props.detailLayout === 'list' ? 'icon-button active' : 'icon-button'} type="button" onClick={() => props.setDetailLayout('list')} aria-label="목록 보기"><List size={16} /></button>
          <button className="black-button" type="button" onClick={props.onRecommend}><Sparkles size={15} /> AI 추천</button>
          <button className="black-button" type="button" onClick={() => props.onOpenCatalog('append')}><Plus size={15} /> DB에서 담기</button>
        </div>
      </div>
      <div className={props.detailLayout === 'list' ? 'clothing-grid list-view' : 'clothing-grid'}>
        {filtered.map((item) => <ClothingCard key={item.id} item={item} onDelete={() => props.onDeleteItem(item.id)} />)}
      </div>
    </section>
  );
}

// 의류 하나를 카드로 표시합니다. 퍼스널컬러 적합도와 상태 정보를 함께 보여줍니다.
function ClothingCard({ item, onDelete }: { key?: React.Key; item: ScoredClothingItem; onDelete: () => void }) {
  return (
    <article className="clothing-card">
      <img src={clothingDisplayImage(item)} alt={item.type} />
      <div className="clothing-body">
        <span className="category-label">{item.category}</span>
        <strong>{item.type}</strong>
        <small>{item.color} · {item.seasonTag}</small>
        <span className="catalog-color-row"><Chip hex={item.representativeHex} /> {item.representativeHex}</span>
        <div className="item-meta-row">
          <span>{item.fitGrade ?? '측정 대기'}</span>
          <span>{item.availabilityStatus}</span>
          <Chip hex={item.representativeHex} />
        </div>
        <button className="text-danger" type="button" onClick={onDelete}><Trash2 size={13} /> 삭제</button>
      </div>
    </article>
  );
}

// 카탈로그에서 추가할 의류를 고르는 화면입니다.
function CatalogSelectionView(props: {
  setView: (view: WardrobeView) => void;
  onBack: () => void;
  catalogItems: CatalogItem[];
  catalogCategory: '전체' | ClothingCategory;
  setCatalogCategory: (value: '전체' | ClothingCategory) => void;
  selectedCatalogIds: string[];
  setSelectedCatalogIds: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  const [subcat, setSubcat] = useState('전체');
  const prevCategory = React.useRef(props.catalogCategory);
  if (prevCategory.current !== props.catalogCategory) {
    prevCategory.current = props.catalogCategory;
    setSubcat('전체');
  }

  const subcategories = props.catalogCategory === '전체' ? [] :
    ['전체', ...Array.from(new Set(props.catalogItems.map((i) => i.subcategory))).sort()];
  const displayItems = subcat === '전체' ? props.catalogItems : props.catalogItems.filter((i) => i.subcategory === subcat);
  const selected = new Set(props.selectedCatalogIds);

  return (
    <section className="wardrobe-page catalog-selection-page">
      <BackTitle title="나만의 옷장 만들기" description="관리자가 준비한 의류 DB에서 체크해서 내 옷장을 빠르게 구성해요." onBack={props.onBack} right={<button className="selection-count" type="button" onClick={() => selected.size > 0 && props.setView('preview')}>{selected.size}개 선택됨 <ArrowRight size={16} /></button>} />
      <div className="catalog-head"><h2><Shirt size={19} /> 내 옷 고르기</h2><p>이미 준비된 옷들 중에서 체크해서 나만의 옷장을 구성해 보세요.</p></div>
      <section className="catalog-browser-panel">
        <div className="catalog-tabs band catalog-tabs-sticky">{CATALOG_TABS.map((tab) => <button key={tab} className={props.catalogCategory === tab ? 'active' : ''} onClick={() => props.setCatalogCategory(tab)}>{tab}</button>)}</div>
        {subcategories.length > 1 && (
          <div className="catalog-subtabs">
            {subcategories.map((sc) => <button key={sc} type="button" className={subcat === sc ? 'active' : ''} onClick={() => setSubcat(sc)}>{sc}</button>)}
          </div>
        )}
        <div className="catalog-scroll-box">
          <div className="catalog-card-grid">
            {displayItems.map((item) => (
              <button key={item.catalogItemId} className={selected.has(item.catalogItemId) ? 'catalog-pick-card selected' : 'catalog-pick-card'} type="button" onClick={() => props.setSelectedCatalogIds((prev) => prev.includes(item.catalogItemId) ? prev.filter((id) => id !== item.catalogItemId) : [...prev, item.catalogItemId])}>
                <img src={item.imageUrl} alt={item.name} />
                {selected.has(item.catalogItemId) && <span className="selected-check"><Check size={15} /></span>}
                <span className="category-label">{item.category}</span>
                <strong>{item.subcategory}</strong>
                <small>{item.seasonTag}</small>
                <span className="catalog-color-row"><Chip hex={item.representativeHex} /> {item.representativeHex}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </section>
  );
}

// 카탈로그 상품을 옷장에 넣기 전에 이미지/색상/카테고리를 미리 확인하는 화면입니다.
function CatalogPreviewView(props: {
  setView: (view: WardrobeView) => void;
  onBack: () => void;
  selectedCatalogItems: CatalogItem[];
  catalogSaveMode: 'create' | 'append';
  setCatalogSaveMode: (value: 'create' | 'append') => void;
  wardrobes: Wardrobe[];
  activeWardrobe?: Wardrobe;
  newWardrobeName: string;
  setNewWardrobeName: (value: string) => void;
  onSaveCatalog: () => void;
}) {
  const selectedByCategory = (category: ClothingCategory) => props.selectedCatalogItems.filter((item) => item.category === category);
  return (
    <section className="wardrobe-page">
      <BackTitle title="나만의 옷장 만들기" description="관리자가 준비한 의류 DB에서 체크해서 내 옷장을 빠르게 구성해요." onBack={props.onBack} />
      <div className="preview-subtitle"><button type="button" onClick={props.onBack}><ArrowLeft size={19} /></button><div><h2>선택한 옷 미리보기</h2><p>새 옷장을 만들거나, 기존 옷장에 담아 바로 사용할 수 있어요.</p></div></div>
      <section className="preview-stage">
        <button className="line-button ai-preview-button" type="button"><Sparkles size={16} /> AI 퍼스널컬러 맞춤 추천</button>
        {(['아우터', '상의', '하의'] as ClothingCategory[]).map((category) => (
          <div className="preview-row" key={category}>
            <strong>{category}</strong>
            <div className="preview-slots">
              {selectedByCategory(category).length === 0 ? <span className="empty-slot">비어있음</span> : selectedByCategory(category).map((item) => <span className="preview-thumb" key={item.catalogItemId}><img src={item.imageUrl} alt={item.name} /><small>{item.name}</small></span>)}
            </div>
          </div>
        ))}
      </section>
      <div className="preview-bottom">
        <section className="panel save-method">
          <h2><Shirt size={18} /> 저장 방식</h2>
          <p>새 옷장을 만들지, 기존 옷장에 담을지 선택해 주세요.</p>
          <div className="save-mode-row">
            <button className={props.catalogSaveMode === 'create' ? 'selected' : ''} type="button" onClick={() => props.setCatalogSaveMode('create')}><strong>새 옷장 만들기</strong><small>선택한 옷들로 새로운 옷장을 만듭니다.</small></button>
            <button className={props.catalogSaveMode === 'append' ? 'selected' : ''} type="button" onClick={() => props.setCatalogSaveMode('append')}><strong>기존 옷장에 담기</strong><small>현재 옷장에 이어서 아이템을 채워 넣습니다.</small></button>
          </div>
          {props.catalogSaveMode === 'create' ? <label>새 옷장 이름<input value={props.newWardrobeName} onChange={(event) => props.setNewWardrobeName(event.target.value)} /></label> : <label>담을 옷장<select value={props.activeWardrobe?.id ?? ''} disabled>{props.wardrobes.map((wardrobe) => <option key={wardrobe.id} value={wardrobe.id}>{wardrobe.name}</option>)}</select></label>}
        </section>
        <section className="panel selection-summary">
          <h2>선택 요약</h2>
          <div className="summary-grid"><span><small>총 선택</small><strong>{props.selectedCatalogItems.length}개</strong></span><span><small>상의/하의</small><strong>{selectedByCategory('상의').length}/{selectedByCategory('하의').length}</strong></span><span><small>아우터</small><strong>{selectedByCategory('아우터').length}개</strong></span><span><small>저장 대상</small><strong>{props.catalogSaveMode === 'create' ? '새 옷장' : '기존 옷장'}</strong></span></div>
          <button className="black-button full" type="button" onClick={props.onSaveCatalog}>선택한 옷 {props.catalogSaveMode === 'create' ? '새 옷장에 담기' : '기존 옷장에 담기'} <ChevronRight size={16} /></button>
        </section>
      </div>
    </section>
  );
}

// 뒤로가기 버튼이 있는 서브 화면 제목 영역입니다.
function BackTitle({ title, description, onBack, right }: { title: string; description: string; onBack: () => void; right?: React.ReactNode }) {
  return <div className="back-title"><button className="round-back" type="button" onClick={onBack}><ArrowLeft size={18} /></button><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{right && <div className="back-title-right">{right}</div>}</div>;
}

// 사용자가 직접 의류를 등록하는 화면입니다. 이미지, 카테고리, 타입, 색상, 사이즈, 브랜드를 입력받습니다.
function ManualAdd(props: {
  setView: (view: WardrobeView) => void;
  onBack: () => void;
  manual: any;
  setManual: React.Dispatch<React.SetStateAction<any>>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  cameraInputRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveBackground: () => void;
  onPrecisionExtract: () => void;
  backgroundRemoveStatus: 'idle' | 'processing' | 'done' | 'error';
  backgroundRemoveError: string;
  onCategory: (category: ClothingCategory) => void;
  onSaveManual: () => void;
}) {
  const sizes = props.manual.category === '하의' ? SIZES.bottoms : props.manual.category === '신발' ? SIZES.shoes : SIZES.tops;
  const detectedColors = props.manual.segmentation?.colors ?? [];
  const selectedColorMeta = colorMetaForInput(props.manual.color);
  const structuredMeta = buildColorMeta(props.manual.category, props.manual.type, props.manual.color, detectedColors, props.manual.brand);
  return (
    <section className="wardrobe-page">
      <BackTitle title="나만의 옷 추가" description="사진을 올리고 색상, 종류, 보유 상태를 직접 입력합니다." onBack={props.onBack} />
      <section className="panel manual-layout">
        <div>
          <div className="image-preview">{props.manual.imageUrl ? <img src={props.manual.imageUrl} alt="preview" /> : <Upload />}</div>
          <div className="upload-actions">
            <button className="line-button" onClick={() => props.fileInputRef.current?.click()} type="button">앨범에서 선택</button>
            <button className="line-button" onClick={() => props.cameraInputRef.current?.click()} type="button">사진 찍기</button>
            <button className="line-button" onClick={props.onRemoveBackground} disabled={!props.manual.imageFile || props.backgroundRemoveStatus === 'processing'} type="button">{props.backgroundRemoveStatus === 'processing' ? '누끼 처리 중' : '누끼 따기'}</button>
            <button className="line-button" onClick={props.onPrecisionExtract} disabled={!props.manual.imageFile || props.backgroundRemoveStatus === 'processing'} type="button">{props.backgroundRemoveStatus === 'processing' ? '처리 중' : '정밀 누끼'}</button>
            <button className="line-button" onClick={() => props.setManual((prev: any) => ({ ...prev, imageUrl: 'https://images.unsplash.com/photo-1648483098902-7af8f711498f?auto=format&fit=crop&w=700&q=80', originalImageUrl: '', cutoutImageUrl: '', imageFile: null, segmentation: null }))} type="button">샘플 사용</button>
          </div>
          {props.backgroundRemoveStatus === 'done' && <p className="manual-helper success">누끼 PNG가 적용되었습니다.</p>}
          {props.backgroundRemoveStatus === 'error' && <p className="manual-helper error">{props.backgroundRemoveError}</p>}
          <div className="structured-meta-panel">
            <span>재질 <strong>{MATERIAL_LABELS[structuredMeta.material]}</strong></span>
            <span>패턴 <strong>{PATTERN_LABELS[structuredMeta.patternType]}</strong></span>
            {structuredMeta.isDenim && structuredMeta.denimWash && <span>데님 톤 <strong>{DENIM_WASH_LABELS[structuredMeta.denimWash]}</strong></span>}
          </div>
          {detectedColors.length > 0 && (
            <div className="detected-palette" aria-label="누끼 이미지 대표 색상">
              <strong>감지 색상</strong>
              <div>
                {detectedColors.map((color: ClothingColorAnalysis) => (
                  <button
                    key={color.hex}
                    type="button"
                    title={`${color.hex} · ${Math.round((color.ratio ?? 0) * 100)}%`}
                    onClick={() => props.setManual((prev: any) => ({ ...prev, color: color.hex }))}
                  >
                    <i style={{ backgroundColor: color.hex }} />
                    <span>{color.hex}</span>
                    <em>{Math.round((color.ratio ?? 0) * 100)}%</em>
                  </button>
                ))}
              </div>
            </div>
          )}
          <input ref={props.fileInputRef} type="file" accept="image/*" hidden onChange={props.onFileChange} />
          <input ref={props.cameraInputRef} type="file" accept="image/*" capture="environment" hidden onChange={props.onFileChange} />
        </div>
        <div className="form-grid manual-form">
          <fieldset className="category-picker">
            <legend>카테고리</legend>
            <div>
              {CATEGORY_OPTIONS.map((category) => {
                const meta = CATEGORY_UI_META[category];
                return (
                  <button className={props.manual.category === category ? 'active' : ''} key={category} type="button" onClick={() => props.onCategory(category)}>
                    <strong>{meta.label}</strong>
                    <small>{meta.hint}</small>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <label>종류<select value={props.manual.type} onChange={(event) => props.setManual((prev: any) => ({ ...prev, type: event.target.value }))}>{TYPES[props.manual.category as ClothingCategory].map((item) => <option key={item}>{item}</option>)}</select></label>
          <fieldset className="color-picker">
            <legend>색상</legend>
            <div className="selected-color-summary">
              <i style={{ backgroundColor: selectedColorMeta.hex }} />
              <span><strong>{isHexColor(props.manual.color) ? '감지 원색' : props.manual.color}</strong><small>{selectedColorMeta.hex}</small></span>
            </div>
            <div className="color-picker-grid">
              {Object.entries(COLOR_META).map(([name, meta]) => (
                <button className={props.manual.color === name ? 'active' : ''} key={name} type="button" onClick={() => props.setManual((prev: any) => ({ ...prev, color: name }))}>
                  <i style={{ backgroundColor: meta.hex }} />
                  <span>{name}</span>
                  <small>{meta.hex}</small>
                </button>
              ))}
            </div>
          </fieldset>
          <label>사이즈<select value={props.manual.size} onChange={(event) => props.setManual((prev: any) => ({ ...prev, size: event.target.value }))}>{sizes.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>브랜드<input value={props.manual.brand} onChange={(event) => props.setManual((prev: any) => ({ ...prev, brand: event.target.value }))} placeholder="선택 입력" /></label>
          <label>계절 태그<select value={props.manual.seasonTag} onChange={(event) => props.setManual((prev: any) => ({ ...prev, seasonTag: event.target.value }))}>{SEASON_TAGS.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>보유 상태<select value={props.manual.availabilityStatus} onChange={(event) => props.setManual((prev: any) => ({ ...prev, availabilityStatus: event.target.value }))}>{AVAILABILITY_OPTIONS.map((item) => <option key={item}>{item}</option>)}</select></label>
          <button className="black-button" type="button" onClick={props.onSaveManual}>옷장에 저장</button>
        </div>
      </section>
    </section>
  );
}

// 추천 페이지입니다. 날씨, 목적 모드, 옷장 선택값을 바탕으로 코디 추천 리스트를 보여줍니다.
function RecommendationDashboard(props: {
  personalColorResult: FinalResult;
  wardrobes: Wardrobe[];
  items: ScoredClothingItem[];
  selectedWardrobes: Set<string>;
  setSelectedWardrobes: React.Dispatch<React.SetStateAction<Set<string>>>;
  search: string;
  setSearch: (value: string) => void;
  mode: RecommendationMode;
  setMode: (value: RecommendationMode) => void;
  weatherBand: RecommendationWeatherBand;
  setWeatherBand: (value: RecommendationWeatherBand) => void;
  weather: ReturnType<typeof useWeather>['data'];
  weatherLoading: boolean;
  weatherError: string;
  weatherSource: 'geolocation' | 'fallback';
  refreshWeather: () => void;
  recommendations: OutfitRecommendation[];
  requested: boolean;
  setRequested: (value: boolean) => void;
  onSave: (outfit: OutfitRecommendation) => void;
  onBack: () => void;
}) {
  const [weatherExpanded, setWeatherExpanded] = useState(false);
  const [wardrobePickerOpen, setWardrobePickerOpen] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(() => !isMobileViewport());
  const filteredWardrobes = props.wardrobes.filter((wardrobe) => wardrobe.name.toLowerCase().includes(props.search.toLowerCase()));
  const selectedItems = props.items.filter((item) => props.selectedWardrobes.has(item.wardrobeId));
  const topCount = selectedItems.filter((item) => item.category === '상의').length;
  const bottomCount = selectedItems.filter((item) => item.category === '하의').length;
  const neutralCount = selectedItems.filter((item) => item.isNeutral || item.isDenim).length;
  const unavailableCount = selectedItems.filter((item) => item.availabilityStatus !== '보유중').length;
  const canRecommend = props.selectedWardrobes.size > 0 && topCount > 0 && bottomCount > 0;
  const allFilteredSelected = filteredWardrobes.length > 0 && filteredWardrobes.every((wardrobe) => props.selectedWardrobes.has(wardrobe.id));

  const toggleWardrobe = (id: string) => {
    props.setSelectedWardrobes((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    props.setRequested(false);
  };

  const toggleAll = () => {
    props.setSelectedWardrobes((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filteredWardrobes.forEach((wardrobe) => next.delete(wardrobe.id));
      } else {
        filteredWardrobes.forEach((wardrobe) => next.add(wardrobe.id));
      }
      return next;
    });
    props.setRequested(false);
  };

  return (
    <section className="recommend-page">
      <BackTitle title="AI 옷장 추천" description="" onBack={props.onBack} />
      <div className="recommend-layout">
        <div className="recommend-main">
          <section className="recommend-choice-panel">
            <section className="recommend-weather-card">
              <div className="recommend-card-head">
                <div><h2><CloudSun size={17} /> 실시간 날씨</h2></div>
                <button className="line-button compact-toggle" type="button" onClick={() => setWeatherExpanded((prev) => !prev)}>{weatherExpanded ? '접기' : '펼치기'}</button>
              </div>
              <div className="weather-info-grid compact-weather">
                <span><small>현재 위치</small><strong>{props.weatherLoading ? '확인 중' : props.weather?.locationLabel ?? (props.weatherSource === 'fallback' ? '서울 기준' : '현재 위치')}</strong></span>
                <span><small>현재 기온</small><strong>{props.weather ? `${Math.round(props.weather.temperature)}도` : '-'}</strong></span>
                <span><small>날씨 상태</small><strong>{props.weatherError || props.weather?.weatherText || '정보 없음'}</strong></span>
                <span><small>추천 구간</small><strong>{props.weatherBand}</strong></span>
                {weatherExpanded && (
                  <>
                    <span><small>미세먼지</small><strong>{formatDustValue(props.weather?.airQuality?.pm10)}</strong></span>
                    <span><small>초미세먼지</small><strong>{formatDustValue(props.weather?.airQuality?.pm25)}</strong></span>
                    <span><small>마스크</small><strong>{props.weather?.airQuality?.maskRecommendation ?? '정보 확인 중'}</strong></span>
                    <span><small>외출 준비</small><strong>{props.weather?.shouldCarryUmbrella ? `우산 챙기기 · ${props.weather.umbrellaReason}` : '우산 필요 낮음'}</strong></span>
                  </>
                )}
              </div>
            </section>

            <section className="recommend-control-panel">
              <div className="fixed-season"><span>퍼스널컬러</span><strong>{SEASON_LABELS[props.personalColorResult.seasonTop1Id]}</strong></div>
              <label><span>상황</span><select value={props.mode} onChange={(event) => props.setMode(event.target.value as RecommendationMode)}>{RECOMMENDATION_MODES.map((mode) => <option key={mode}>{mode}</option>)}</select></label>
              <label><span>날씨</span><select value={props.weatherBand} onChange={(event) => props.setWeatherBand(event.target.value as RecommendationWeatherBand)}><option>상관없음</option>{WEATHER_BANDS.map((band) => <option key={band}>{band}</option>)}</select></label>
            </section>

            <button className="black-button full" type="button" onClick={() => setWardrobePickerOpen(true)}>옷장 선택 {props.selectedWardrobes.size}개</button>
          </section>

          {wardrobePickerOpen && <div className="picker-backdrop" role="presentation" onClick={() => setWardrobePickerOpen(false)} />}
          <div className={wardrobePickerOpen ? 'recommend-wardrobe-picker open' : 'recommend-wardrobe-picker'}>
            <div className="picker-head">
              <h2>옷장 선택</h2>
              <button className="line-button" type="button" onClick={() => setWardrobePickerOpen(false)}>닫기</button>
            </div>
            <label className="search-field"><Search size={16} /><input value={props.search} onChange={(event) => props.setSearch(event.target.value)} placeholder="옷장 검색" /></label>
            <button className="line-button full" type="button" onClick={toggleAll}>{allFilteredSelected ? '전체 해제' : '전체 선택'}</button>
            <div className="recommend-wardrobe-grid">
            {filteredWardrobes.map((wardrobe) => {
              const wardrobeItems = props.items.filter((item) => item.wardrobeId === wardrobe.id);
              const selected = props.selectedWardrobes.has(wardrobe.id);
              return (
                <button key={wardrobe.id} className={selected ? 'recommend-wardrobe-card selected' : 'recommend-wardrobe-card'} type="button" onClick={() => toggleWardrobe(wardrobe.id)}>
                  <span className="recommend-mosaic">{Array.from({ length: 4 }).map((_, index) => wardrobeItems[index] ? <img key={wardrobeItems[index].id} src={clothingDisplayImage(wardrobeItems[index])} alt={wardrobeItems[index].type} /> : <i key={index} />)}</span>
                  <span className="recommend-card-body">
                    <strong>{wardrobe.name}</strong>
                    <small>{wardrobeItems.length}개의 아이템</small>
                    <span className="pill-row"><span>상의 {wardrobeItems.filter((item) => item.category === '상의').length}</span><span>하의 {wardrobeItems.filter((item) => item.category === '하의').length}</span></span>
                  </span>
                  <span className="recommend-check">{selected && <Check size={16} />}</span>
                </button>
              );
            })}
            </div>
          </div>
          <button className="recommend-action-button mobile-only-action" type="button" disabled={!canRecommend} onClick={() => props.setRequested(true)}><Sparkles size={16} /> 추천 받기</button>
        </div>

        <aside className="recommend-summary-panel">
          <button className="summary-toggle" type="button" onClick={() => setSummaryExpanded((prev) => !prev)}>
            <span><Sparkles size={18} /> 추천 요약</span>
            <strong>{summaryExpanded ? '접기' : '펼치기'}</strong>
          </button>
          {summaryExpanded && (
            <>
              <dl>
                <div><dt>퍼스널컬러</dt><dd>{SEASON_LABELS[props.personalColorResult.seasonTop1Id]}</dd></div>
                <div><dt>추천 상황</dt><dd>{props.mode}</dd></div>
                <div><dt>날씨 구간</dt><dd>{props.weatherBand}</dd></div>
                <div><dt>선택 옷장</dt><dd>{props.selectedWardrobes.size}개</dd></div>
                <div><dt>전체 의류</dt><dd>{selectedItems.length}개</dd></div>
              </dl>
              <section className="recommend-ready-box">
                <h3>추천 가능 여부</h3>
                <div className="summary-grid compact">
                  <span><small>상의</small><strong>{topCount}개</strong></span>
                  <span><small>하의</small><strong>{bottomCount}개</strong></span>
                  <span><small>무채색</small><strong>{neutralCount}개</strong></span>
                  <span><small>상태</small><strong>{unavailableCount > 0 ? '보완 필요' : '양호'}</strong></span>
                </div>
                {!canRecommend && <p>최소 상의 1개와 하의 1개가 포함된 옷장을 선택해주세요.</p>}
              </section>
            </>
          )}
          <button className="recommend-action-button desktop-only-action" type="button" disabled={!canRecommend} onClick={() => props.setRequested(true)}><Sparkles size={16} /> 추천 받기</button>
        </aside>
        <section className="recommend-results">
          {props.requested && (
            props.recommendations.length === 0
              ? <EmptyState title="추천 가능한 조합이 부족합니다." description="선택한 옷장에 상의와 하의를 함께 추가해 주세요." />
              : <RecommendationList recommendations={props.recommendations} onSave={props.onSave} />
          )}
        </section>
      </div>
    </section>
  );
}

// 현재 날씨와 추천에 사용되는 기온 구간을 보여주는 카드입니다.
function WeatherCard({ weather, loading, error, source, weatherBand }: { weather: ReturnType<typeof useWeather>['data']; loading: boolean; error: string; source: 'geolocation' | 'fallback'; weatherBand: RecommendationWeatherBand; refresh: () => void }) {
  return (
    <section className="home-card weather-card">
      <div>
        <div className="weather-title"><CloudSun size={18} /><h2>실시간 날씨</h2></div>
        <p>{loading ? '날씨 정보를 불러오는 중입니다.' : error || (weather ? `${weather.locationLabel} · ${Math.round(weather.temperature)}도 · ${weather.weatherText}` : '날씨 정보 없음')}</p>
        <div className="weather-advice-row">
          <span>미세먼지 : {formatDustValue(weather?.airQuality?.pm10)}</span>
          <span>초미세먼지 : {formatDustValue(weather?.airQuality?.pm25)}</span>
          <span>마스크 : {weather?.airQuality?.maskRecommendation ?? '정보 확인 중'}</span>
          <span>{weather?.shouldCarryUmbrella ? `우산 챙기기 · ${weather.umbrellaReason}` : '우산 필요 낮음'}</span>
        </div>
        <small>{source === 'geolocation' ? '현재 위치 기반' : '서울 기준'} · 추천 구간 {weatherBand}</small>
      </div>
    </section>
  );
}

// 미세먼지 값이 없을 때 UI에 '-'로 표시하기 위한 포맷 함수입니다.
function formatDustValue(value: number | null | undefined) {
  return value == null ? '확인 중' : String(Math.round(value));
}

// 퍼스널컬러 최종 결과 요약 카드입니다. 홈/결과 화면에서 시즌과 추천 특징을 빠르게 보여줍니다.
function PersonalResult({ result, onRetry }: { result: FinalResult; onRetry: () => void }) {
  const topSeason = SEASON_DETAILS[result.seasonTop1Id];
  const secondSeason = SEASON_DETAILS[result.seasonTop2Id];
  const familyGuide = FAMILY_GUIDES[topSeason.family];
  const adjacentSeasons = topSeason.adjacent.map((id) => SEASON_DETAILS[id]);
  const fusionPhotoPercent = `${Math.round(result.evidence.fusionWeights.photo * 100)}%`;
  const fusionQuestionPercent = `${Math.round(result.evidence.fusionWeights.questionnaire * 100)}%`;
  const bestColors = result.palette.slice(0, 10);
  const similarColors = result.palette.slice(10, 16);

  return (
    <section className="personal-result-page">
      <section className="personal-result-hero panel">
        <span className="result-badge">4계절 대분류 + 12계절 세부 진단</span>
        <h1>{topSeason.title}</h1>
        <p className="result-subtitle">{FAMILY_LABELS[topSeason.family]} 계열 안에서 가장 잘 맞는 세부 시즌</p>
        <p>{topSeason.commonAliasSentence}</p>
        <p className="result-hero-copy">얼굴 색 샘플과 설문 반응을 함께 본 하이브리드 판정입니다. 4계절 대분류 위에 12계절 세부 구조를 올려 결과를 설명합니다.</p>
        <button className="black-button" type="button" onClick={onRetry}><RotateCcw size={16} /> 다시 측정</button>
      </section>

      <div className="result-main-grid">
        <section className="panel result-explain-card">
          <PanelTitle title="왜 이렇게 나왔나요?" />
          <div className="result-pill-row">
            <span>{topSeason.title}</span>
            <span>보통 {topSeason.commonAlias}</span>
            <span>2순위 {secondSeason.title}</span>
          </div>
          <div className="result-copy-stack">
            <p>{topSeason.summary}</p>
            <p>{topSeason.styling}</p>
            <p>{topSeason.whyItFits}</p>
            <p>{result.explanation}</p>
          </div>
          <div className="result-info-grid">
            <InfoBox title="4계절과 12계절의 관계" body={PERSONAL_COLOR_MODEL_NOTE.overview} />
            <InfoBox title="현재 대분류 해석" body={`${familyGuide.title}\n${familyGuide.summary}\n하위 계절: ${familyGuide.seasons}`} />
          </div>
          <InfoBox title="인접 계절 개념" body={PERSONAL_COLOR_MODEL_NOTE.adjacency} chips={adjacentSeasons.map((season) => season.title)} />
        </section>

        <section className="panel result-evidence-card">
          <PanelTitle title="근거 요약" />
          <MetricBox title="사진 신호" value={`${result.evidence.photoSignal.temperature} / ${SEASON_DETAILS[result.evidence.photoSignal.dominantSeasonId].title}`} />
          <MetricBox title="설문 신호" value={`${result.evidence.questionSignal.temperature} / ${result.evidence.questionSignal.clarity}`} />
          <MetricBox title="하이브리드 비율" value={`사진 ${fusionPhotoPercent} / 설문 ${fusionQuestionPercent}`} detail={result.evidence.boundary.note} />
          <MetricBox title="추천 특징" value={`온도감 ${result.recommendationFeatures.preferredTemperature}`} detail={`선명도 ${result.recommendationFeatures.preferredClarity} · 명도 ${result.recommendationFeatures.preferredLightness} · 대비감 ${result.recommendationFeatures.contrastLevel}`} />
          <InfoBox title="보통 이렇게도 불러요" body={`${topSeason.title}은 실무나 상담 현장에서 ${topSeason.commonAlias}처럼 부르는 경우도 많습니다.`} />
        </section>
      </div>

      <div className="result-main-grid color-section-grid">
        <section className="panel">
          <PanelTitle title="잘 어울리는 색상" />
          <p>{topSeason.bestColorDescription}</p>
          <ColorTileGrid colors={bestColors} />
          <InfoBox title="톤이 유사한 보조 활용 색상" body="같은 시즌 안에서 톤이 비슷한 색을 함께 쓰면 자연스럽고 활용 범위도 넓어집니다." colors={similarColors} />
          <section className="avoid-color-box">
            <h3>피해야 하는 색상</h3>
            <p>{topSeason.worstColorsDescription}</p>
            <ColorTileGrid colors={topSeason.worstColors} />
          </section>
        </section>

        <section className="panel result-frame-card">
          <PanelTitle title="색상 해석 프레임" />
          <InfoBox title="HSV 3축 이해" body={PERSONAL_COLOR_MODEL_NOTE.hsv} />
          <InfoBox title="현재 결과에서 중요한 포인트" body="얼굴 샘플 색과 팔레트 거리, 설문에서 드러난 온도감, 선명도, 명도, 대비 반응을 같이 비교한 결과입니다. 단순히 웜/쿨만 보는 것이 아니라 같은 계열 안에서도 밝은 축인지, 부드러운 축인지까지 함께 해석합니다." />
        </section>
      </div>
    </section>
  );
}

// 이전 진단 기록을 보여주고, 과거 결과를 현재 결과로 다시 적용할 수 있게 합니다.
function PersonalColorHistoryPanel({ history, current, onApply }: { history: PersonalColorRecord[]; current: FinalResult | null; onApply: (record: PersonalColorRecord) => void }) {
  const [selectedRecord, setSelectedRecord] = useState<PersonalColorRecord | null>(null);
  const selectedResult = selectedRecord?.result;
  const selectedSeason = selectedResult ? SEASON_DETAILS[selectedResult.seasonTop1Id] : null;

  return (
    <section className="panel personal-history-panel">
      <PanelTitle title="나의 퍼스널 컬러 기록" />
      {!current && history.length === 0 ? (
        <p>아직 저장된 측정 기록이 없습니다.</p>
      ) : (
        <div className="history-grid">
          {history.map((record, index) => {
            const result = record.result;
            const isCurrent = index === 0 && Boolean(current);
            return (
              <article className={isCurrent ? 'history-card current' : 'history-card'} key={record.id}>
                <button className="history-card-main" type="button" onClick={() => setSelectedRecord(record)}>
                  <span>
                    <small>{new Date(record.measuredAt).toLocaleString('ko-KR')}</small>
                    <strong>{SEASON_LABELS[result.seasonTop1Id]}</strong>
                    <em>2순위 {SEASON_LABELS[result.seasonTop2Id]}</em>
                  </span>
                  <span className="mini-palette">{result.palette.slice(0, 5).map((hex, idx) => <Chip key={`${hex}-${idx}`} hex={hex} />)}</span>
                </button>
                <div className="history-actions">
                  <button className="line-button" type="button" onClick={() => setSelectedRecord(record)}>자세히 보기</button>
                  {isCurrent ? <span className="current-label">현재 적용 중</span> : <button className="black-button" type="button" onClick={() => onApply(record)}>이 결과 적용</button>}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {selectedRecord && selectedResult && selectedSeason && (
        <div className="history-detail-backdrop" role="presentation" onClick={() => setSelectedRecord(null)}>
          <section className="history-detail-modal" role="dialog" aria-modal="true" aria-label="퍼스널 컬러 상세 정보" onClick={(event) => event.stopPropagation()}>
            <div className="history-detail-head">
              <div>
                <small>{new Date(selectedRecord.measuredAt).toLocaleString('ko-KR')}</small>
                <h3>{selectedSeason.title}</h3>
                <p>2순위 {SEASON_LABELS[selectedResult.seasonTop2Id]}</p>
              </div>
              <button className="line-button" type="button" onClick={() => setSelectedRecord(null)}>닫기</button>
            </div>
            <p>{selectedSeason.summary}</p>
            <p>{selectedSeason.styling}</p>
            <section>
              <h4>잘 어울리는 색상</h4>
              <ColorTileGrid colors={selectedResult.palette.slice(0, 10)} compact />
            </section>
            <section>
              <h4>주의할 색상</h4>
              <ColorTileGrid colors={selectedSeason.worstColors} compact />
            </section>
            <div className="history-detail-actions">
              <button className="black-button" type="button" onClick={() => { onApply(selectedRecord); setSelectedRecord(null); }}>이 결과 적용</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

// 패널 내부 소제목을 통일하는 표시 컴포넌트입니다.
function PanelTitle({ title }: { title: string }) {
  return <h2 className="panel-title">{title}</h2>;
}

// 설명 문장, 태그, 색상칩을 한 박스에 묶어 보여주는 정보 컴포넌트입니다.
function InfoBox({ title, body, chips, colors }: { title: string; body: string; chips?: string[]; colors?: string[] }) {
  return (
    <section className="info-box">
      <h3>{title}</h3>
      {body.split('\n').map((line) => <p key={line}>{line}</p>)}
      {chips && <div className="result-pill-row">{chips.map((chip) => <span key={chip}>{chip}</span>)}</div>}
      {colors && <ColorTileGrid colors={colors} compact />}
    </section>
  );
}

// 점수/개수 같은 핵심 수치를 한 줄로 강조하는 컴포넌트입니다.
function MetricBox({ title, value, detail }: { title: string; value: string; detail?: string }) {
  return (
    <section className="metric-box">
      <small>{title}</small>
      <strong>{value}</strong>
      {detail && <p>{detail}</p>}
    </section>
  );
}

// HEX 팔레트를 색상 타일 그리드로 표시합니다.
function ColorTileGrid({ colors, compact }: { colors: string[]; compact?: boolean }) {
  return (
    <div className={compact ? 'color-tile-grid compact' : 'color-tile-grid'}>
      {colors.map((hex, idx) => <span key={`${hex}-${idx}`}><i style={{ backgroundColor: hex }} /><small>{hex}</small></span>)}
    </div>
  );
}

// 계산된 코디 추천 결과를 리스트로 보여주고 저장 액션을 제공합니다.
function RecommendationList({ recommendations, onSave }: { recommendations: OutfitRecommendation[]; onSave: (outfit: OutfitRecommendation) => void }) {
  return (
    <section className="recommendation-scroll-box">
      <div className="outfit-grid">
        {recommendations.map((outfit) => (
          <article className="panel outfit-card" key={outfit.id}>
            <div className="result-head">
              <div>
                <h3>{outfit.title}</h3>
                <div className="outfit-meta-row">
                  <span className="harmony-badge">{HARMONY_BADGE_KO[outfit.harmonyType] ?? outfit.harmonyType}</span>
                  <span className="outfit-band-tag">{outfit.weatherBand}</span>
                </div>
              </div>
              <div className="score-circle">
                <strong>{outfit.score}</strong>
                <span>점</span>
              </div>
            </div>
            <div className="outfit-color-strip">
              {outfit.items.map((item) => (
                <span key={item.id} className="outfit-color-swatch" style={{ background: item.representativeHex }} title={item.type} />
              ))}
            </div>
            <div className="recommend-item-strip">
              {outfit.items.map((item) => (
                <div key={item.id} className="outfit-item-thumb">
                  <img src={clothingDisplayImage(item)} alt={item.type} />
                  {item.fitGrade && <span className={`fit-badge fit-${item.fitGrade.toLowerCase()}`}>{item.fitGrade}</span>}
                  <span className="item-type-label">{item.type}</span>
                </div>
              ))}
            </div>
            <div className="score-grade-row">
              <span title={`퍼스널컬러 적합도 ${outfit.personalScore}점`}>퍼컬 <strong className={`grade-${scoreGrade(outfit.personalScore)}`}>{scoreGrade(outfit.personalScore)}</strong></span>
              <span title={`색상 조화도 ${outfit.harmonyScore}점`}>조화 <strong className={`grade-${scoreGrade(outfit.harmonyScore)}`}>{scoreGrade(outfit.harmonyScore)}</strong></span>
              <span title={`날씨 적합도 ${outfit.weatherScore}점`}>날씨 <strong className={`grade-${scoreGrade(outfit.weatherScore)}`}>{scoreGrade(outfit.weatherScore)}</strong></span>
            </div>
            <button className="line-button" onClick={() => onSave(outfit)}>데일리룩 저장</button>
          </article>
        ))}
      </div>
    </section>
  );
}

// 저장된 추천 코디의 자동 배치 상태를 카드용 보드 미리보기로 렌더링합니다.
function DailyLookBoardPreview({ outfit, items }: { outfit: SavedOutfit; items: ScoredClothingItem[] }) {
  const itemById = new Map<string, ScoredClothingItem>(items.map((item) => [item.id, item]));
  const state = outfit.dailyLookState ?? buildDailyLookState(outfit.itemIds.map((id) => itemById.get(id)).filter(Boolean) as ScoredClothingItem[]);
  return (
    <div className="saved-dailylook-board" aria-label={`${outfit.title} 자동 배치 미리보기`}>
      {[...state.layers].filter((layer) => layer.visible).sort((left, right) => left.zIndex - right.zIndex).map((layer) => {
        const item = itemById.get(layer.itemId);
        if (!item) return null;
        return (
          <div
            className="saved-board-layer"
            key={layer.itemId}
            style={{
              left: `${(layer.x / state.canvas.width) * 100}%`,
              top: `${(layer.y / state.canvas.height) * 100}%`,
              transform: `translate(-50%, -50%) rotate(${layer.rotation}deg) scale(${layer.scale})`,
              zIndex: layer.zIndex,
            }}
          >
            <img src={clothingDisplayImage(item)} alt={item.type} />
          </div>
        );
      })}
    </div>
  );
}

// 저장된 추천 코디 목록입니다. 삭제, 가상착용 만들기 진입을 담당합니다.
function SavedOutfits({ saved, items, onDelete, onMakeDailyLook, onCreateDailyLook }: { saved: SavedOutfit[]; items: ScoredClothingItem[]; onDelete: (id: string) => void; onMakeDailyLook: (id: string) => void; onCreateDailyLook: () => void }) {
  return (
    <section className="page-stack">
      <div className="dailylook-list-title">
        <PageTitle title="데일리룩" description="추천 화면에서 저장한 조합을 모아보고, 데일리룩 만들기에서 하나의 룩 이미지로 편집합니다." icon={<Bookmark />} />
        <button className="blue-button" type="button" onClick={onCreateDailyLook}><Plus size={16} /> 데일리룩 만들기</button>
      </div>
      {saved.length === 0 ? <EmptyState title="저장된 데일리룩이 없습니다." description="추천에서 마음에 드는 조합을 저장하면 여기에 표시됩니다." /> : (
        <div className="outfit-grid saved-outfit-grid">
          {saved.map((outfit) => {
            const outfitItems = outfit.itemIds.map((id) => items.find((item) => item.id === id)).filter(Boolean) as ScoredClothingItem[];
            const isConfirmed = Boolean(outfit.dailyLookState?.isConfirmed);
            return (
              <article className="panel outfit-card saved-outfit-card" key={outfit.id}>
                <div className="saved-outfit-head">
                  <div>
                    <h3>{outfit.title}</h3>
                    <p>{outfit.mode} · {outfit.weatherBand} · {outfit.score}점 · {isConfirmed ? '완성됨' : '시안 대기'}</p>
                  </div>
                  <div className="saved-outfit-tools">
                    <div className="mini-palette">{outfit.colorHexes.map((hex, index) => <Chip key={`${hex}-${index}`} hex={hex} />)}</div>
                    <button className="text-danger" type="button" onClick={() => onDelete(outfit.id)}>삭제</button>
                  </div>
                </div>
                {outfit.dailyLookState?.confirmedImage ? <img className="dailylook-confirmed-thumb" src={outfit.dailyLookState.confirmedImage} alt={`${outfit.title} 완성 이미지`} /> : <DailyLookBoardPreview outfit={outfit} items={items} />}
                <details className="saved-outfit-detail">
                  <summary>자세히 보기</summary>
                  <div className="saved-item-preview-grid">
                    {outfitItems.map((item) => (
                      <figure key={item.id}>
                        <img src={clothingDisplayImage(item)} alt={item.type} />
                      <figcaption><strong>{item.type}</strong><small>{displayClothingColor(item)} · {MATERIAL_LABELS[item.material ?? 'unknown']} · {PATTERN_LABELS[normalizePatternType(item.patternType)]}</small></figcaption>
                      </figure>
                    ))}
                  </div>
                </details>
                <button className="black-button" type="button" onClick={() => onMakeDailyLook(outfit.id)}><Shirt size={15} /> 데일리룩 만들기</button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

// 저장 코디를 레이어 캔버스 형태로 배치하는 가상착용 화면입니다.
// 누끼가 없는 아이템은 onEnsureCutouts로 배경 제거를 시도한 뒤 레이어로 표시합니다.
function TryOn({ saved, items, wardrobes, activeOutfitId, onSaveDailyLook, onEnsureCutouts, onBack }: { saved: SavedOutfit[]; items: ScoredClothingItem[]; wardrobes: Wardrobe[]; activeOutfitId: string | null; onSaveDailyLook: (id: string, state: DailyLookState, itemIds?: string[]) => void; onEnsureCutouts: (itemIds: string[]) => Promise<void>; onBack: () => void }) {
  const selectedOutfit = saved.find((outfit) => outfit.id === activeOutfitId) ?? saved[0];
  const itemLookup = useMemo(() => new Map<string, ScoredClothingItem>(items.map((item) => [item.id, item])), [items]);
  const [draftItemIds, setDraftItemIds] = useState<string[]>(() => selectedOutfit?.itemIds ?? []);
  const dailyLookItems = useMemo(() => draftItemIds.map((id) => itemLookup.get(id)).filter(Boolean) as ScoredClothingItem[], [draftItemIds, itemLookup]);
  const [state, setState] = useState<DailyLookState>(() => buildDailyLookState(dailyLookItems, selectedOutfit?.dailyLookState));
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const [pickerSource, setPickerSource] = useState<'wardrobe' | 'catalog'>('wardrobe');
  const [pickerWardrobeId, setPickerWardrobeId] = useState(wardrobes[0]?.id ?? '');
  const [pickerCategory, setPickerCategory] = useState<'전체' | ClothingCategory>('전체');
  const [cutoutStatus, setCutoutStatus] = useState<'idle' | 'processing' | 'done' | 'error'>('idle');
  const [cutoutError, setCutoutError] = useState('');
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ itemId: string; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const textDragRef = useRef<{ textId: string; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const textResizeRef = useRef<{ textId: string; startX: number; originFontSize: number } | null>(null);
  const cutoutRequestKeyRef = useRef('');

  useEffect(() => {
    if (!selectedOutfit) return;
    setDraftItemIds(selectedOutfit.itemIds);
    const nextItems = selectedOutfit.itemIds.map((id) => itemLookup.get(id)).filter(Boolean) as ScoredClothingItem[];
    const nextState = buildDailyLookState(nextItems, selectedOutfit.dailyLookState);
    setState(nextState);
    setSelectedLayerId(nextState.layers[0]?.itemId ?? null);
    setSelectedTextId(nextState.textLayers?.[0]?.id ?? null);
  }, [itemLookup, selectedOutfit?.id, selectedOutfit?.dailyLookState]);

  useEffect(() => {
    const missingItems = dailyLookItems.filter((item) => !item.cutoutImageUrl || item.segmentation?.version !== CUTOUT_VERSION);
    if (!selectedOutfit || missingItems.length === 0) {
      if (cutoutStatus === 'processing') setCutoutStatus('done');
      return;
    }
    const requestKey = `${selectedOutfit.id}:${missingItems.map((item) => item.id).join(',')}`;
    if (cutoutRequestKeyRef.current === requestKey) return;
    cutoutRequestKeyRef.current = requestKey;
    setCutoutStatus('processing');
    setCutoutError('');
    onEnsureCutouts(missingItems.map((item) => item.id))
      .then(() => setCutoutStatus('done'))
      .catch((error) => {
        setCutoutStatus('error');
        setCutoutError(error instanceof Error ? error.message : '데일리룩 누끼 처리에 실패했습니다.');
      });
  }, [cutoutStatus, dailyLookItems, onEnsureCutouts, selectedOutfit]);

  if (!selectedOutfit) {
    return <section className="page-stack"><PageTitle title="데일리룩 만들기" description="저장한 데일리룩을 이미지 조합으로 편집합니다." icon={<Bookmark />} /><EmptyState title="미리볼 데일리룩이 없습니다." description="추천에서 조합을 데일리룩으로 저장하면 이 화면에서 확인할 수 있습니다." /></section>;
  }

  const itemById = new Map<string, ScoredClothingItem>(dailyLookItems.map((item) => [item.id, item]));
  const selectedLayer = selectedLayerId ? state.layers.find((layer) => layer.itemId === selectedLayerId) : undefined;
  const selectedTextLayer = selectedTextId ? state.textLayers?.find((layer) => layer.id === selectedTextId) : undefined;
  const hasCanvasContent = dailyLookItems.length > 0 || Boolean(state.textLayers?.length);
  const selectedItemIds = new Set(draftItemIds);
  const catalogItems = items.filter((item) => item.wardrobeId === 'catalog-dailylook');
  const wardrobeItems = items.filter((item) => item.wardrobeId !== 'catalog-dailylook' && (!pickerWardrobeId || item.wardrobeId === pickerWardrobeId));
  const pickerBaseItems = pickerSource === 'catalog' ? catalogItems : wardrobeItems;
  const pickerItems = pickerBaseItems
    .filter((item) => !selectedItemIds.has(item.id))
    .filter((item) => pickerCategory === '전체' || item.category === pickerCategory);
  const pickerWardrobeName = wardrobes.find((wardrobe) => wardrobe.id === pickerWardrobeId)?.name ?? '옷장';

  const updateLayer = (itemId: string, patch: Partial<DailyLookLayer>) => {
    setState((prev) => ({
      ...prev,
      isConfirmed: false,
      confirmedImage: undefined,
      confirmedAt: undefined,
      layers: prev.layers.map((layer) => (layer.itemId === itemId ? { ...layer, ...patch } : layer)),
    }));
  };

  const updateTextLayer = (textId: string, patch: Partial<DailyLookTextLayer>) => {
    setState((prev) => ({
      ...prev,
      isConfirmed: false,
      confirmedImage: undefined,
      confirmedAt: undefined,
      textLayers: (prev.textLayers ?? []).map((layer) => (layer.id === textId ? { ...layer, ...patch } : layer)),
    }));
  };

  const addTextLayer = () => {
    const textLayer: DailyLookTextLayer = {
      id: `text-${Date.now()}`,
      text: '오늘의 룩',
      x: 540,
      y: 170,
      fontSize: 64,
      color: '#111827',
      rotation: 0,
      zIndex: Math.max(10, ...state.layers.map((layer) => layer.zIndex), ...((state.textLayers ?? []).map((layer) => layer.zIndex))) + 1,
      visible: true,
    };
    setState((prev) => ({
      ...prev,
      isConfirmed: false,
      confirmedImage: undefined,
      confirmedAt: undefined,
      textLayers: [...(prev.textLayers ?? []), textLayer],
    }));
    setSelectedTextId(textLayer.id);
    setSelectedLayerId(null);
  };

  const addDailyLookItem = (itemId: string) => {
    const nextItemIds = Array.from(new Set([...draftItemIds, itemId]));
    const nextItems = nextItemIds.map((id) => itemLookup.get(id)).filter(Boolean) as ScoredClothingItem[];
    setDraftItemIds(nextItemIds);
    setState((prev) => buildDailyLookState(nextItems, prev));
    setItemPickerOpen(false);
  };

  const resetLayout = () => {
    const nextState = buildDailyLookState(dailyLookItems);
    setState(nextState);
    setSelectedLayerId(nextState.layers[0]?.itemId ?? null);
    setSelectedTextId(nextState.textLayers?.[0]?.id ?? null);
  };

  const moveLayerOrder = (direction: 'front' | 'back') => {
    if (!selectedLayer) return;
    const zIndexes = state.layers.map((layer) => layer.zIndex);
    updateLayer(selectedLayer.itemId, { zIndex: direction === 'front' ? Math.max(...zIndexes) + 1 : Math.min(...zIndexes) - 1 });
  };

  const pointerToCanvas = (event: React.PointerEvent<HTMLElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const scale = rect ? state.canvas.width / rect.width : 1;
    return {
      x: (event.clientX - (rect?.left ?? 0)) * scale,
      y: (event.clientY - (rect?.top ?? 0)) * scale,
    };
  };

  const startDrag = (event: React.PointerEvent<HTMLButtonElement>, layer: DailyLookLayer) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointerToCanvas(event);
    dragRef.current = { itemId: layer.itemId, startX: point.x, startY: point.y, originX: layer.x, originY: layer.y };
    setSelectedLayerId(layer.itemId);
    setSelectedTextId(null);
  };

  const dragLayer = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const point = pointerToCanvas(event);
    updateLayer(drag.itemId, { x: drag.originX + point.x - drag.startX, y: drag.originY + point.y - drag.startY });
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const startTextDrag = (event: React.PointerEvent<HTMLElement>, layer: DailyLookTextLayer) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointerToCanvas(event);
    textDragRef.current = { textId: layer.id, startX: point.x, startY: point.y, originX: layer.x, originY: layer.y };
    setSelectedTextId(layer.id);
    setSelectedLayerId(null);
  };

  const dragTextLayer = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = textDragRef.current;
    if (!drag) return;
    const point = pointerToCanvas(event);
    updateTextLayer(drag.textId, { x: drag.originX + point.x - drag.startX, y: drag.originY + point.y - drag.startY });
  };

  const endTextDrag = () => {
    textDragRef.current = null;
  };

  const startTextResize = (event: React.PointerEvent<HTMLButtonElement>, layer: DailyLookTextLayer) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointerToCanvas(event);
    textResizeRef.current = { textId: layer.id, startX: point.x, originFontSize: layer.fontSize };
    setSelectedTextId(layer.id);
    setSelectedLayerId(null);
  };

  const resizeTextLayer = (event: React.PointerEvent<HTMLButtonElement>) => {
    const resize = textResizeRef.current;
    if (!resize) return;
    event.stopPropagation();
    const point = pointerToCanvas(event);
    const nextFontSize = Math.max(18, Math.min(180, resize.originFontSize + (point.x - resize.startX) * 0.35));
    updateTextLayer(resize.textId, { fontSize: Math.round(nextFontSize) });
  };

  const endTextResize = () => {
    textResizeRef.current = null;
  };

  const removeTextLayer = (textId: string) => {
    setState((prev) => ({
      ...prev,
      isConfirmed: false,
      confirmedImage: undefined,
      confirmedAt: undefined,
      textLayers: (prev.textLayers ?? []).filter((layer) => layer.id !== textId),
    }));
    setSelectedTextId(null);
  };

  const renderConfirmedImage = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = state.canvas.width;
    canvas.height = state.canvas.height;
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    context.fillStyle = '#f8f9fb';
    context.fillRect(0, 0, canvas.width, canvas.height);

    const orderedLayers = [...state.layers].filter((layer) => layer.visible).sort((left, right) => left.zIndex - right.zIndex);
    for (const layer of orderedLayers) {
      const item = itemById.get(layer.itemId);
      if (!item) continue;
      const image = await loadCanvasImage(clothingDisplayImage(item));
      const width = 420 * layer.scale;
      const height = width * (image.naturalHeight / Math.max(image.naturalWidth, 1));
      context.save();
      context.translate(layer.x, layer.y);
      context.rotate((layer.rotation * Math.PI) / 180);
      context.drawImage(image, -width / 2, -height / 2, width, height);
      context.restore();
    }

    const orderedTextLayers = [...(state.textLayers ?? [])].filter((layer) => layer.visible).sort((left, right) => left.zIndex - right.zIndex);
    for (const layer of orderedTextLayers) {
      context.save();
      context.translate(layer.x, layer.y);
      context.rotate((layer.rotation * Math.PI) / 180);
      context.fillStyle = layer.color;
      context.font = `700 ${layer.fontSize}px Arial, sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(layer.text, 0, 0);
      context.restore();
    }

    return canvas.toDataURL('image/png');
  };

  const confirmDailyLook = async () => {
    let confirmedImage: string | undefined;
    try {
      confirmedImage = await renderConfirmedImage();
    } catch {
      // 외부 이미지 CORS 정책으로 렌더링 저장이 막히면 배치 상태만 저장합니다.
      confirmedImage = undefined;
    }
    const nextState = { ...state, isConfirmed: true, confirmedImage, confirmedAt: new Date().toISOString() };
    setState(nextState);
    onSaveDailyLook(selectedOutfit.id, nextState, draftItemIds);
  };

  return (
    <section className="page-stack">
      <div className="dailylook-maker-title">
        <button className="line-button back-button" type="button" onClick={onBack}><ArrowLeft size={16} /> 데일리룩</button>
        <div className="dailylook-maker-heading">
          <PageTitle title="데일리룩 만들기" description="저장한 데일리룩 조합을 자동 배치하고, 필요할 때만 가볍게 수정합니다." icon={<Bookmark />} />
          <div className="dailylook-save-actions">
            <button className="black-button" type="button" disabled={!hasCanvasContent} onClick={confirmDailyLook}><Check size={15} /> 저장</button>
          </div>
        </div>
      </div>
      <section className="dailylook-compact-summary">
        <strong>{selectedOutfit.title}</strong>
        <span>{selectedOutfit.mode}</span>
        <span>{selectedOutfit.weatherBand}</span>
        <span>{state.isConfirmed ? '저장됨' : '편집 중'}</span>
      </section>
      {!hasCanvasContent && <EmptyState title="아이템이나 텍스트를 추가해 주세요." description="데일리룩 만들기는 추천 저장 조합, 옷장 아이템, 카탈로그 아이템을 섞어서 구성할 수 있습니다." />}
      {cutoutStatus === 'processing' && <p className="dailylook-cutout-status">누끼가 없는 옷을 데일리룩용 PNG로 처리하는 중입니다. 첫 실행은 모델 로딩 때문에 시간이 걸릴 수 있습니다.</p>}
      {cutoutStatus === 'error' && <p className="dailylook-cutout-status error">{cutoutError}</p>}
      <section className="dailylook-maker">
        <div className="dailylook-canvas-panel panel">
          <div className="dailylook-stage" ref={canvasRef}>
            {[...state.layers].filter((layer) => layer.visible).sort((left, right) => left.zIndex - right.zIndex).map((layer) => {
              const item = itemById.get(layer.itemId);
              if (!item) return null;
              return (
                <button
                  key={layer.itemId}
                  className={selectedLayer?.itemId === layer.itemId ? 'dailylook-layer selected' : 'dailylook-layer'}
                  type="button"
                  style={{
                    left: `${(layer.x / state.canvas.width) * 100}%`,
                    top: `${(layer.y / state.canvas.height) * 100}%`,
                    transform: `translate(-50%, -50%) rotate(${layer.rotation}deg) scale(${layer.scale})`,
                    zIndex: layer.zIndex,
                  }}
                  onPointerDown={(event) => startDrag(event, layer)}
                  onPointerMove={dragLayer}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onClick={() => {
                    setSelectedLayerId(layer.itemId);
                    setSelectedTextId(null);
                  }}
                >
                  <img src={clothingDisplayImage(item)} alt={item.type} draggable={false} />
                  <span>{item.category}</span>
                </button>
              );
            })}
            {[...(state.textLayers ?? [])].filter((layer) => layer.visible).sort((left, right) => left.zIndex - right.zIndex).map((layer) => (
              <div
                key={layer.id}
                className={selectedTextLayer?.id === layer.id ? 'dailylook-text-layer selected' : 'dailylook-text-layer'}
                role="button"
                tabIndex={0}
                style={{
                  left: `${(layer.x / state.canvas.width) * 100}%`,
                  top: `${(layer.y / state.canvas.height) * 100}%`,
                  color: layer.color,
                  fontSize: `${layer.fontSize * 0.5}px`,
                  transform: `translate(-50%, -50%) rotate(${layer.rotation}deg)`,
                  zIndex: layer.zIndex,
                }}
                onPointerDown={(event) => startTextDrag(event, layer)}
                onPointerMove={dragTextLayer}
                onPointerUp={endTextDrag}
                onPointerCancel={endTextDrag}
                onClick={() => {
                  setSelectedTextId(layer.id);
                  setSelectedLayerId(null);
                }}
              >
                <span>{layer.text}</span>
                {selectedTextLayer?.id === layer.id && (
                  <button
                    className="dailylook-text-resize"
                    type="button"
                    aria-label="텍스트 크기 조절"
                    onPointerDown={(event) => startTextResize(event, layer)}
                    onPointerMove={resizeTextLayer}
                    onPointerUp={endTextResize}
                    onPointerCancel={endTextResize}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="dailylook-main-actions">
            <button className="line-button" type="button" onClick={resetLayout}><RotateCcw size={15} /> 자동 배치</button>
          </div>
        </div>
        <div className="dailylook-side-column">
          <section className="dailylook-confirm-panel panel">
            <button className="blue-button" type="button" onClick={addTextLayer}><Plus size={15} /> 텍스트</button>
            <button className="line-button" type="button" onClick={() => setItemPickerOpen(true)}><Plus size={15} /> 옷 추가</button>
          </section>
          <aside className="dailylook-editor-panel panel">
            <PanelTitle title="레이어 편집" />
            {selectedTextLayer ? (
              <section className="dailylook-text-controls">
                <div className="dailylook-selected-item">
                  <strong>텍스트</strong>
                  <small>드래그해서 위치를 조정합니다.</small>
                </div>
                <label>내용
                  <input type="text" value={selectedTextLayer.text} onChange={(event) => updateTextLayer(selectedTextLayer.id, { text: event.target.value })} />
                </label>
                <label>색상
                  <input type="color" value={selectedTextLayer.color} onChange={(event) => updateTextLayer(selectedTextLayer.id, { color: event.target.value })} />
                </label>
                <label>크기
                  <input type="range" min="24" max="120" step="2" value={selectedTextLayer.fontSize} onChange={(event) => updateTextLayer(selectedTextLayer.id, { fontSize: Number(event.target.value) })} />
                </label>
                <label>회전
                  <input type="range" min="-25" max="25" step="1" value={selectedTextLayer.rotation} onChange={(event) => updateTextLayer(selectedTextLayer.id, { rotation: Number(event.target.value) })} />
                </label>
                <div className="dailylook-tool-grid">
                  <button className="line-button" type="button" onClick={() => updateTextLayer(selectedTextLayer.id, { zIndex: Math.max(...state.layers.map((layer) => layer.zIndex), ...((state.textLayers ?? []).map((layer) => layer.zIndex))) + 1 })}>앞으로</button>
                  <button className="line-button" type="button" onClick={() => updateTextLayer(selectedTextLayer.id, { zIndex: Math.min(...state.layers.map((layer) => layer.zIndex), ...((state.textLayers ?? []).map((layer) => layer.zIndex))) - 1 })}>뒤로</button>
                  <button className="line-button" type="button" onClick={() => updateTextLayer(selectedTextLayer.id, { visible: !selectedTextLayer.visible })}>{selectedTextLayer.visible ? '숨김' : '표시'}</button>
                  <button className="line-button danger" type="button" onClick={() => removeTextLayer(selectedTextLayer.id)}>삭제</button>
                </div>
              </section>
            ) : !selectedLayer ? <p>편집할 아이템이나 텍스트를 선택해 주세요.</p> : (
              <>
                <div className="dailylook-selected-item">
                  <strong>{itemById.get(selectedLayer.itemId)?.type}</strong>
                  <small>{selectedLayer.category} · {selectedLayer.slot}</small>
                </div>
                <label>크기
                  <input type="range" min="0.35" max="1.55" step="0.05" value={selectedLayer.scale} onChange={(event) => updateLayer(selectedLayer.itemId, { scale: Number(event.target.value) })} />
                </label>
                <label>회전
                  <input type="range" min="-25" max="25" step="1" value={selectedLayer.rotation} onChange={(event) => updateLayer(selectedLayer.itemId, { rotation: Number(event.target.value) })} />
                </label>
                <div className="dailylook-tool-grid">
                  <button className="line-button" type="button" onClick={() => moveLayerOrder('front')}>앞으로</button>
                  <button className="line-button" type="button" onClick={() => moveLayerOrder('back')}>뒤로</button>
                  <button className="line-button" type="button" onClick={() => updateLayer(selectedLayer.itemId, { visible: !selectedLayer.visible })}>{selectedLayer.visible ? '숨김' : '표시'}</button>
                  <button className="line-button" type="button" onClick={resetLayout}>초기화</button>
                </div>
              </>
            )}
            <section className="dailylook-layer-list">
              {state.layers.map((layer) => {
                const item = itemById.get(layer.itemId);
                return item ? <button key={layer.itemId} className={selectedLayer?.itemId === layer.itemId ? 'active' : ''} type="button" onClick={() => { setSelectedLayerId(layer.itemId); setSelectedTextId(null); }}>{item.category} · {item.type}</button> : null;
              })}
              {(state.textLayers ?? []).map((layer) => <button key={layer.id} className={selectedTextLayer?.id === layer.id ? 'active' : ''} type="button" onClick={() => { setSelectedTextId(layer.id); setSelectedLayerId(null); }}>텍스트 · {layer.text || '빈 텍스트'}</button>)}
            </section>
            {state.confirmedAt && <p>마지막 확정: {new Date(state.confirmedAt).toLocaleString('ko-KR')}</p>}
          </aside>
        </div>
      </section>
      {itemPickerOpen && (
        <div className="dailylook-picker-backdrop" role="presentation" onMouseDown={() => setItemPickerOpen(false)}>
          <section className="dailylook-picker-modal panel" role="dialog" aria-modal="true" aria-label="데일리룩 옷 추가" onMouseDown={(event) => event.stopPropagation()}>
            <div className="dailylook-picker-head">
              <PanelTitle title="옷 추가" />
              <button className="line-button" type="button" onClick={() => setItemPickerOpen(false)}>닫기</button>
            </div>
            <div className="dailylook-picker-tabs">
              <button className={pickerSource === 'wardrobe' ? 'active' : ''} type="button" onClick={() => setPickerSource('wardrobe')}>내 옷장</button>
              <button className={pickerSource === 'catalog' ? 'active' : ''} type="button" onClick={() => setPickerSource('catalog')}>프로젝트 카탈로그</button>
            </div>
            <div className="dailylook-picker-controls">
              {pickerSource === 'wardrobe' && (
                <label>옷장
                  <select value={pickerWardrobeId} onChange={(event) => setPickerWardrobeId(event.target.value)}>
                    {wardrobes.map((wardrobe) => <option key={wardrobe.id} value={wardrobe.id}>{wardrobe.name}</option>)}
                  </select>
                </label>
              )}
              <label>카테고리
                <select value={pickerCategory} onChange={(event) => setPickerCategory(event.target.value as '전체' | ClothingCategory)}>
                  {(['전체', ...CATEGORY_OPTIONS] as Array<'전체' | ClothingCategory>).map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </label>
            </div>
            <p className="dailylook-picker-note">{pickerSource === 'wardrobe' ? pickerWardrobeName : '프로젝트 카탈로그'} · {pickerCategory} · {pickerItems.length}개</p>
            <div className="dailylook-picker-grid">
              {pickerItems.map((item) => (
                <button key={item.id} type="button" onClick={() => addDailyLookItem(item.id)}>
                  <img src={clothingDisplayImage(item)} alt={item.type} />
                  <span>
                    <strong>{item.type}</strong>
                    <small>{item.brand} · {item.category}</small>
                    <small>{item.representativeHex ?? item.color}</small>
                  </span>
                </button>
              ))}
              {pickerItems.length === 0 && <EmptyState title="추가할 옷이 없습니다." description="다른 옷장이나 카테고리를 선택해 주세요." />}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

// 이미지 URL을 HTMLImageElement로 로드합니다. 가상착용 확정 이미지 렌더링에서 사용됩니다.
function loadCanvasImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

// 데이터가 없을 때 보여주는 공통 빈 상태 UI입니다.
function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <section className="panel empty-state"><h2>{title}</h2><p>{description}</p>{action}</section>;
}

// HEX 색상을 작은 원형 칩으로 보여주는 컴포넌트입니다.
function Chip({ hex, label, large }: { key?: React.Key; hex: string; label?: string; large?: boolean }) {
  return <span className={large ? 'color-chip large' : 'color-chip'} title={label} style={{ backgroundColor: hex }}>{label && <small>{label}</small>}</span>;
}

export default App;
