import { Question, QuestionnaireScores } from './types';

export const QUESTIONS: Question[] = [
  {
    id: 'vein_color',
    text: '손목 혈관이 더 가깝게 보이는 색은 무엇인가요?',
    options: [
      { label: '올리브/그린 계열', value: 'green', weights: { temperature: 0.55 } },
      { label: '블루/퍼플 계열', value: 'blue', weights: { temperature: -0.55 } },
      { label: '둘 다 비슷하거나 잘 모르겠어요', value: 'mix', weights: { temperature: 0 } },
    ],
  },
  {
    id: 'jewelry_reaction',
    text: '얼굴이 더 살아 보이는 금속 액세서리는 무엇인가요?',
    options: [
      { label: '골드', value: 'gold', weights: { temperature: 0.65, clarity: 0.05 } },
      { label: '실버/플래티넘', value: 'silver', weights: { temperature: -0.65, clarity: 0.05 } },
      { label: '둘 다 잘 어울려요', value: 'both', weights: { temperature: 0, clarity: 0 } },
    ],
  },
  {
    id: 'white_clothing',
    text: '흰색 옷 중 얼굴이 더 정돈되어 보이는 쪽은 무엇인가요?',
    options: [
      { label: '크림/아이보리', value: 'ivory', weights: { temperature: 0.4, lightness: 0.1, clarity: -0.1 } },
      { label: '퓨어 화이트', value: 'pure', weights: { temperature: -0.4, lightness: 0.3, clarity: 0.1 } },
      { label: '오프화이트/그레이시 화이트', value: 'soft_white', weights: { temperature: 0, lightness: 0.15, clarity: -0.15 } },
    ],
  },
  {
    id: 'sun_reaction',
    text: '햇빛에 노출되면 피부 반응이 어떤 편인가요?',
    options: [
      { label: '잘 태우고 붉어짐은 적어요', value: 'tan', weights: { temperature: 0.25, contrast: 0.1 } },
      { label: '붉어지고 잘 타지 않아요', value: 'burn', weights: { temperature: -0.25, contrast: -0.1 } },
      { label: '둘 다 비슷해요', value: 'neutral', weights: { temperature: 0, contrast: 0 } },
    ],
  },
  {
    id: 'vibrant_colors',
    text: '선명하고 채도 높은 컬러를 입었을 때 인상은 어떤가요?',
    options: [
      { label: '얼굴이 또렷하고 생기 있어 보여요', value: 'glow', weights: { clarity: 0.7, contrast: 0.3 } },
      { label: '색이 너무 강해서 얼굴이 묻혀 보여요', value: 'overwhelmed', weights: { clarity: -0.7, contrast: -0.2 } },
      { label: '적당히 괜찮아요', value: 'neutral', weights: { clarity: 0, contrast: 0 } },
    ],
  },
  {
    id: 'muted_colors',
    text: '그레이 한 방울 섞인 뮤트 컬러를 입었을 때는 어떤가요?',
    options: [
      { label: '차분하고 자연스럽게 잘 어울려요', value: 'natural', weights: { clarity: -0.7 } },
      { label: '얼굴이 탁하고 피곤해 보여요', value: 'tired', weights: { clarity: 0.7 } },
      { label: '큰 차이는 없어요', value: 'neutral', weights: { clarity: 0 } },
    ],
  },
  {
    id: 'contrast_preference',
    text: '얼굴 대비감과 더 잘 맞는 스타일은 무엇인가요?',
    options: [
      { label: '흑백처럼 대비가 큰 스타일', value: 'high', weights: { contrast: 0.7, clarity: 0.15 } },
      { label: '부드럽고 비슷한 명도의 스타일', value: 'low', weights: { contrast: -0.7, clarity: -0.1 } },
      { label: '중간 정도가 가장 편해요', value: 'mid', weights: { contrast: 0 } },
    ],
  },
  {
    id: 'depth_preference',
    text: '얼굴이 더 안정적으로 보이는 색 깊이는 무엇인가요?',
    options: [
      { label: '밝고 맑은 컬러', value: 'light', weights: { lightness: 0.7 } },
      { label: '중간 톤 컬러', value: 'medium', weights: { lightness: 0.1 } },
      { label: '깊고 짙은 컬러', value: 'deep', weights: { lightness: -0.7 } },
    ],
  },
];

export const QUESTIONNAIRE_AXES: (keyof QuestionnaireScores)[] = ['temperature', 'lightness', 'clarity', 'contrast'];
