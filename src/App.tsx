import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Camera, ClipboardList, Palette, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import PhotoAnalyzer from './components/PhotoAnalyzer';
import Questionnaire from './components/Questionnaire';
import ResultDisplay from './components/ResultDisplay';
import { FinalResult, PhotoAnalysisResult, QuestionnaireScores } from './types';
import { fuseResults } from './services/geminiService';

type AppStep = 'intro' | 'photo' | 'questionnaire' | 'fusing' | 'result';

export default function App() {
  const [step, setStep] = useState<AppStep>('intro');
  const [photoData, setPhotoData] = useState<PhotoAnalysisResult | null>(null);
  const [finalResult, setFinalResult] = useState<FinalResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePhotoComplete = (result: PhotoAnalysisResult) => {
    setPhotoData(result);
    setError(null);
    setStep('questionnaire');
  };

  const handleQuestionnaireComplete = async (scores: QuestionnaireScores, responses: Record<string, string>) => {
    if (!photoData) {
      setError('사진 분석 데이터가 없습니다. 먼저 사진을 촬영한 뒤 다시 진행해주세요.');
      setStep('photo');
      return;
    }

    setError(null);
    setStep('fusing');

    try {
      const result = await Promise.resolve(fuseResults(photoData, scores, responses));
      setFinalResult(result);
      setStep('result');
    } catch (caughtError) {
      console.error(caughtError);
      setError('분석 결과를 정리하는 중 문제가 발생했습니다. 설문 단계부터 다시 시도해주세요.');
      setStep('questionnaire');
    }
  };

  const reset = () => {
    setStep('intro');
    setPhotoData(null);
    setFinalResult(null);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-zinc-100 selection:text-zinc-950">
      <div className="fixed inset-0 bg-[linear-gradient(to_right,#18181b_1px,transparent_1px),linear-gradient(to_bottom,#18181b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none" />

      <header className="relative z-10 p-6 flex justify-between items-center max-w-7xl mx-auto">
        <div className="flex items-center gap-2 group cursor-pointer" onClick={reset}>
          <div className="w-8 h-8 bg-zinc-100 rounded-lg flex items-center justify-center group-hover:rotate-12 transition-transform">
            <Palette className="w-5 h-5 text-zinc-950" />
          </div>
          <span className="font-light tracking-tighter text-xl">Palette Workbook Analyzer</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-1 text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
            <span className={step === 'photo' ? 'text-zinc-100' : ''}>Photo</span>
            <span className="mx-1 opacity-20">/</span>
            <span className={step === 'questionnaire' ? 'text-zinc-100' : ''}>Questionnaire</span>
            <span className="mx-1 opacity-20">/</span>
            <span className={step === 'result' ? 'text-zinc-100' : ''}>Workbook</span>
          </div>
          {step !== 'intro' && (
            <Button variant="ghost" size="sm" onClick={reset} className="text-zinc-500 hover:text-zinc-300">
              <RefreshCw className="w-4 h-4 mr-2" />
              초기화
            </Button>
          )}
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-6 pt-10 md:pt-20 pb-16">
        {error && (
          <div className="max-w-3xl mx-auto mb-8">
            <Alert className="border-red-500/20 bg-red-500/10 text-red-100">
              <TriangleAlert className="h-4 w-4" />
              <AlertTitle>분석 흐름 오류</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        )}

        <AnimatePresence mode="wait">
          {step === 'intro' && (
            <motion.div
              key="intro"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-4xl mx-auto text-center space-y-12"
            >
              <div className="space-y-6">
                <h1 className="text-5xl md:text-7xl font-light tracking-tighter leading-[0.95]">
                  엑셀 팔레트 기준의 <span className="italic font-serif">퍼스널 컬러 분석</span>
                </h1>
                <p className="text-zinc-500 text-lg md:text-xl font-light max-w-2xl mx-auto">
                  실시간 얼굴 랜드마크 추적, ROI 샘플링, 12시즌 24색 엑셀 팔레트 비교, 설문 정규화를 한 번에 묶어 결과를 계산합니다.
                </p>
              </div>

              <div className="flex justify-center">
                <Button
                  onClick={() => {
                    setError(null);
                    setStep('photo');
                  }}
                  className="bg-zinc-100 text-zinc-950 hover:bg-zinc-300 px-10 py-8 rounded-full text-lg font-medium group transition-all active:scale-95"
                >
                  분석 시작
                  <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-8">
                {[
                  { icon: Camera, title: '실시간 얼굴 추적', desc: 'MediaPipe Face Landmarker로 랜드마크와 샘플링 ROI를 영상 위에 표시합니다.' },
                  { icon: ClipboardList, title: '설문 정규화', desc: '온도, 명도, 채도, 대비 축을 정규화해서 사진 결과와 함께 반영합니다.' },
                  { icon: Sparkles, title: '엑셀 팔레트 매칭', desc: '12시즌 24색 팔레트와의 거리 비교로 최종 시즌을 계산합니다.' },
                ].map((item) => (
                  <Card key={item.title} className="bg-zinc-900/20 border-zinc-800/50 backdrop-blur-sm">
                    <CardContent className="p-6 text-left space-y-4">
                      <item.icon className="w-6 h-6 text-zinc-600" />
                      <div className="space-y-2">
                        <h3 className="text-zinc-200 font-medium">{item.title}</h3>
                        <p className="text-zinc-500 text-sm font-light leading-relaxed">{item.desc}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </motion.div>
          )}

          {step === 'photo' && (
            <motion.div key="photo" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.04 }} className="max-w-4xl mx-auto">
              <PhotoAnalyzer onAnalysisComplete={handlePhotoComplete} />
            </motion.div>
          )}

          {step === 'questionnaire' && (
            <motion.div key="questionnaire" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="max-w-4xl mx-auto">
              <Questionnaire onComplete={handleQuestionnaireComplete} />
            </motion.div>
          )}

          {step === 'fusing' && (
            <motion.div key="fusing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-24 space-y-8">
              <div className="relative">
                <div className="w-24 h-24 border-2 border-zinc-800 rounded-full animate-ping opacity-20" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <RefreshCw className="w-10 h-10 text-zinc-400 animate-spin" />
                </div>
              </div>
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-light tracking-tight text-zinc-200">엑셀 기준 시즌 점수를 정리하는 중</h2>
                <p className="text-zinc-500 font-mono text-xs uppercase tracking-widest">Workbook Fusion Engine</p>
              </div>
            </motion.div>
          )}

          {step === 'result' && finalResult && photoData && (
            <motion.div key="result" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-6xl mx-auto">
              <ResultDisplay result={finalResult} photoData={photoData} />
              <div className="flex justify-center mt-12">
                <Button variant="outline" onClick={reset} className="border-zinc-800 text-zinc-400 hover:bg-zinc-900 px-8 py-6 rounded-full">
                  새 분석 시작
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
