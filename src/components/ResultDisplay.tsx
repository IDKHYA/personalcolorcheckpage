import React, { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { AlertTriangle, CheckCircle2, Info, Palette, Ruler, Shirt, Sparkles, User } from 'lucide-react';
import { motion } from 'motion/react';
import { FinalResult, PhotoAnalysisResult, RoiMeasurement } from '@/src/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';

interface ResultDisplayProps {
  result: FinalResult;
  photoData: PhotoAnalysisResult;
}

const confidencePercent = (value: number) => `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
const featureValue = (value: number) => value.toFixed(4);

function MeasurementCard({ item }: { item: RoiMeasurement }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-zinc-200 font-medium">{item.label}</p>
        <div className="w-8 h-8 rounded-full border border-zinc-700" style={{ backgroundColor: item.color }} />
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs text-zinc-400">
        <div>
          <p className="text-zinc-500 font-mono mb-1">RGB</p>
          <p>{item.rgb.r}, {item.rgb.g}, {item.rgb.b}</p>
        </div>
        <div>
          <p className="text-zinc-500 font-mono mb-1">LAB</p>
          <p>{item.lab.l.toFixed(2)}, {item.lab.a.toFixed(2)}, {item.lab.b.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-zinc-500 font-mono mb-1">HSL</p>
          <p>{item.hsl.h.toFixed(1)}°, {item.hsl.s.toFixed(1)}%, {item.hsl.l.toFixed(1)}%</p>
        </div>
        <div>
          <p className="text-zinc-500 font-mono mb-1">ROI</p>
          <p>
            {item.region.x}, {item.region.y}, {item.region.width} x {item.region.height}
          </p>
        </div>
      </div>
      <p className="text-[10px] font-mono text-zinc-500">{item.color}</p>
    </div>
  );
}

export default function ResultDisplay({ result, photoData }: ResultDisplayProps) {
  useEffect(() => {
    if (result.confidence > 0.62) {
      confetti({
        particleCount: 130,
        spread: 72,
        origin: { y: 0.58 },
        colors: ['#ffffff', '#f4d7a1', '#9cc0ea', '#9e8f88'],
      });
    }
  }, [result]);

  const getSeasonColor = (season: string) => {
    if (season.includes('봄') || season.toLowerCase().includes('spring')) return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20';
    if (season.includes('여름') || season.toLowerCase().includes('summer')) return 'bg-sky-500/10 text-sky-300 border-sky-500/20';
    if (season.includes('가을') || season.toLowerCase().includes('autumn')) return 'bg-orange-500/10 text-orange-300 border-orange-500/20';
    if (season.includes('겨울') || season.toLowerCase().includes('winter')) return 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20';
    return 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20';
  };

  const consistencyLabel =
    result.evidence.consistency === 'high' ? '높음' : result.evidence.consistency === 'medium' ? '중간' : '낮음';

  return (
    <div className="w-full max-w-5xl mx-auto space-y-8 pb-20">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center space-y-4">
        <Badge variant="outline" className="px-4 py-1 rounded-full border-zinc-800 text-zinc-500 font-mono uppercase tracking-widest text-[10px]">
          Workbook Based Diagnosis
        </Badge>
        <h1 className="text-5xl md:text-7xl font-light tracking-tighter text-zinc-100">
          최종 결과는 <span className="italic font-serif">{result.seasonTop1}</span>
        </h1>
        <p className="text-zinc-500 max-w-2xl mx-auto text-lg font-light">
          사진 샘플 색상, 실시간 랜드마크 기반 ROI, 설문 응답, 엑셀 12시즌 팔레트를 함께 반영한 결과입니다.
        </p>
      </motion.div>

      <div className="grid md:grid-cols-3 gap-6">
        <Card className="md:col-span-2 border-zinc-800 bg-zinc-950 overflow-hidden">
          <CardHeader className="bg-zinc-900/50 border-b border-zinc-800">
            <CardTitle className="flex items-center gap-2 text-zinc-200 font-light">
              <Sparkles className="w-4 h-4 text-zinc-400" />
              상세 판정
            </CardTitle>
          </CardHeader>
          <CardContent className="p-8 space-y-8">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-zinc-500 text-sm uppercase tracking-wider font-mono">Top Season</span>
                <Badge className={getSeasonColor(result.seasonTop1)}>{result.seasonTop1}</Badge>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-zinc-500 text-sm uppercase tracking-wider font-mono">Second Season</span>
                <Badge variant="outline" className="border-zinc-800 text-zinc-400">
                  {result.seasonTop2}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-zinc-500 text-sm uppercase tracking-wider font-mono">Confidence</span>
                <span className="text-zinc-200 font-mono">{confidencePercent(result.confidence)}</span>
              </div>
            </div>

            <Separator className="bg-zinc-900" />

            <div className="space-y-4">
              <h4 className="text-zinc-400 text-xs uppercase tracking-widest font-bold flex items-center gap-2">
                <Info className="w-3 h-3" />
                해석 메모
              </h4>
              <p className="text-zinc-300 leading-relaxed font-light text-lg">{result.explanation}</p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Dialog>
                <DialogTrigger
                  render={
                    <Button variant="outline" className="border-zinc-800 text-zinc-300 hover:bg-zinc-900">
                      <Ruler className="w-4 h-4 mr-2" />
                      측정값 자세히 보기
                    </Button>
                  }
                />
                <DialogContent className="max-w-5xl bg-zinc-950 text-zinc-100 border border-zinc-800 p-0 overflow-hidden" showCloseButton>
                  <DialogHeader className="p-6 border-b border-zinc-800 bg-zinc-900/60">
                    <DialogTitle>실제 측정값 상세</DialogTitle>
                    <DialogDescription className="text-zinc-400">
                      얼굴 바운딩 박스, ROI 좌표, RGB/LAB/HSL 값, 품질 점수, 상위 시즌 점수를 확인할 수 있습니다.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
                    <div className="grid md:grid-cols-2 gap-6">
                      <Card className="border-zinc-800 bg-zinc-900/30">
                        <CardHeader>
                          <CardTitle className="text-sm font-medium text-zinc-200">얼굴 바운딩 박스</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-zinc-300 space-y-2">
                          <p>X: {photoData.measurementDetails.faceBounds.x}px</p>
                          <p>Y: {photoData.measurementDetails.faceBounds.y}px</p>
                          <p>Width: {photoData.measurementDetails.faceBounds.width}px</p>
                          <p>Height: {photoData.measurementDetails.faceBounds.height}px</p>
                        </CardContent>
                      </Card>
                      <Card className="border-zinc-800 bg-zinc-900/30">
                        <CardHeader>
                          <CardTitle className="text-sm font-medium text-zinc-200">정규화 특징 벡터</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-zinc-300 space-y-2 font-mono">
                          <p>temperature: {featureValue(photoData.measurementDetails.normalizedFeatures.temperature)}</p>
                          <p>lightness: {featureValue(photoData.measurementDetails.normalizedFeatures.lightness)}</p>
                          <p>clarity: {featureValue(photoData.measurementDetails.normalizedFeatures.clarity)}</p>
                          <p>contrast: {featureValue(photoData.measurementDetails.normalizedFeatures.contrast)}</p>
                          <p>mutedScore: {featureValue(photoData.measurementDetails.normalizedFeatures.mutedScore)}</p>
                        </CardContent>
                      </Card>
                    </div>

                    <Card className="border-zinc-800 bg-zinc-900/30">
                      <CardHeader>
                        <CardTitle className="text-sm font-medium text-zinc-200">사진 품질 세부 점수</CardTitle>
                      </CardHeader>
                      <CardContent className="grid md:grid-cols-5 gap-4 text-sm text-zinc-300 font-mono">
                        <p>overall: {featureValue(photoData.measurementDetails.qualityBreakdown.overall)}</p>
                        <p>exposure: {featureValue(photoData.measurementDetails.qualityBreakdown.exposure)}</p>
                        <p>symmetry: {featureValue(photoData.measurementDetails.qualityBreakdown.symmetry)}</p>
                        <p>distinctness: {featureValue(photoData.measurementDetails.qualityBreakdown.distinctness)}</p>
                        <p>faceSize: {featureValue(photoData.measurementDetails.qualityBreakdown.faceSize)}</p>
                      </CardContent>
                    </Card>

                    <div className="space-y-3">
                      <h4 className="text-zinc-200 font-medium">ROI별 색상 측정값</h4>
                      <div className="grid md:grid-cols-2 gap-4">
                        {photoData.measurementDetails.roiMeasurements.map((item) => (
                          <div key={item.label}>
                            <MeasurementCard item={item} />
                          </div>
                        ))}
                      </div>
                    </div>

                    <Card className="border-zinc-800 bg-zinc-900/30">
                      <CardHeader>
                        <CardTitle className="text-sm font-medium text-zinc-200">상위 시즌 점수</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {photoData.measurementDetails.topSeasonScores.map((item) => (
                          <div key={item.seasonId} className="space-y-1">
                            <div className="flex items-center justify-between text-sm text-zinc-300">
                              <span>{item.seasonName}</span>
                              <span className="font-mono">{item.score.toFixed(2)}%</span>
                            </div>
                            <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
                              <div className="h-full bg-zinc-300 rounded-full" style={{ width: `${Math.min(100, item.score)}%` }} />
                            </div>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            <div className="space-y-3">
              <h4 className="text-zinc-400 text-xs uppercase tracking-widest font-bold">추천 팔레트 일부</h4>
              <div className="grid grid-cols-6 md:grid-cols-8 gap-2">
                {result.palette.slice(0, 16).map((hex) => (
                  <div key={hex} className="space-y-1">
                    <div className="h-10 rounded-lg border border-zinc-800" style={{ backgroundColor: hex }} />
                    <p className="text-[10px] text-zinc-600 font-mono text-center">{hex}</p>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-950">
          <CardHeader className="bg-zinc-900/50 border-b border-zinc-800">
            <CardTitle className="flex items-center gap-2 text-zinc-200 font-light">
              <Palette className="w-4 h-4 text-zinc-400" />
              근거 신호
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-500 uppercase font-mono">Photo Signal</span>
                  <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                </div>
                <p className="text-zinc-200 text-sm font-medium">
                  {result.evidence.photoSignal.temperature} / {result.evidence.photoSignal.dominantSeason}
                </p>
                <p className="text-[10px] text-zinc-600 font-mono">Conf: {confidencePercent(result.evidence.photoSignal.confidence)}</p>
              </div>

              <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-500 uppercase font-mono">Questionnaire Signal</span>
                  <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                </div>
                <p className="text-zinc-200 text-sm font-medium">
                  {result.evidence.questionSignal.temperature} / {result.evidence.questionSignal.clarity}
                </p>
                <p className="text-[10px] text-zinc-600 font-mono">Conf: {confidencePercent(result.evidence.questionSignal.confidence)}</p>
              </div>

              <div className="flex items-center gap-2 p-3 rounded-lg bg-zinc-900/20 border border-zinc-800/50">
                {result.evidence.consistency === 'high' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                )}
                <span className="text-xs text-zinc-500 font-mono uppercase tracking-tighter">Signal Consistency: {consistencyLabel}</span>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
                <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest mb-2">Workbook Basis</p>
                <p className="text-sm text-zinc-300 leading-relaxed">{result.evidence.workbookBasis}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        {[
          { icon: Palette, label: 'Temperature', value: result.recommendationFeatures.preferredTemperature },
          { icon: Shirt, label: 'Clarity', value: result.recommendationFeatures.preferredClarity },
          { icon: User, label: 'Lightness', value: result.recommendationFeatures.preferredLightness },
          { icon: Sparkles, label: 'Contrast', value: result.recommendationFeatures.contrastLevel },
        ].map((item) => (
          <Card key={item.label} className="border-zinc-800 bg-zinc-950/50 hover:bg-zinc-900 transition-colors">
            <CardContent className="p-6 flex flex-col items-center text-center space-y-3">
              <item.icon className="w-5 h-5 text-zinc-600" />
              <div className="space-y-1">
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-mono">{item.label}</p>
                <p className="text-zinc-200 font-medium">{item.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-zinc-800 bg-zinc-950/50">
        <CardHeader className="bg-zinc-900/40 border-b border-zinc-800">
          <CardTitle className="text-zinc-200 font-light">추출된 샘플 색상</CardTitle>
        </CardHeader>
        <CardContent className="p-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          {Object.entries(result.extractedColors).map(([label, value]) => (
            <div key={label} className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
              <div className="h-16 rounded-lg border border-zinc-800" style={{ backgroundColor: value }} />
              <div>
                <p className="text-sm text-zinc-200 capitalize">{label}</p>
                <p className="text-[10px] font-mono text-zinc-500">{value}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
