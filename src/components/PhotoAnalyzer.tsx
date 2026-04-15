import React, { useEffect, useRef, useState } from 'react';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { AlertCircle, Camera, RefreshCw, ScanFace } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { PhotoAnalysisResult } from '@/src/types';
import { detectFaceSnapshot, getFaceLandmarker } from '@/src/services/faceLandmarker';
import { analyzePhotoColors } from '@/src/services/geminiService';
import { clamp, deltaE, rgbToCss, rgbToHsl, rgbToLab } from '@/src/services/colorUtils';

interface PhotoAnalyzerProps {
  onAnalysisComplete: (result: PhotoAnalysisResult) => void;
}

interface SampleRegion {
  key: 'skinLeft' | 'skinRight' | 'eyesLeft' | 'eyesRight' | 'lips' | 'hair';
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LiveDetectionState {
  landmarks: NormalizedLandmark[];
  faceBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  sampleRegions: SampleRegion[];
}

const ANALYSIS_STEPS = [
  '카메라 프레임을 고정하는 중',
  '얼굴 랜드마크를 검출하는 중',
  '볼, 눈, 입술, 헤어라인 주변을 샘플링하는 중',
  '엑셀 팔레트와 거리 비교를 계산하는 중',
];

const LEFT_IRIS_INDICES = [468, 469, 470, 471, 472];
const RIGHT_IRIS_INDICES = [473, 474, 475, 476, 477];

export default function PhotoAnalyzer({ onAnalysisComplete }: PhotoAnalyzerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const detectInFlightRef = useRef(false);
  const lastDetectTimeRef = useRef(0);

  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState(ANALYSIS_STEPS[0]);
  const [isModelReady, setIsModelReady] = useState(false);
  const [liveDetection, setLiveDetection] = useState<LiveDetectionState | null>(null);

  useEffect(() => {
    void startCamera();
    void getFaceLandmarker()
      .then(() => setIsModelReady(true))
      .catch(() => {
        setError('얼굴 랜드마크 모델을 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.');
      });

    return () => {
      stopCamera();
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isCameraReady || capturedImage || isAnalyzing || !isModelReady) {
      clearOverlay();
      return;
    }

    const loop = (time: number) => {
      rafRef.current = requestAnimationFrame(loop);
      if (!videoRef.current || detectInFlightRef.current) return;
      if (videoRef.current.readyState < 2 || videoRef.current.videoWidth === 0 || videoRef.current.videoHeight === 0) return;
      if (time - lastDetectTimeRef.current < 120) return;

      lastDetectTimeRef.current = time;
      detectInFlightRef.current = true;

      void detectFaceSnapshot(videoRef.current, time)
        .then((snapshot) => {
          if (!videoRef.current || !overlayCanvasRef.current) return;

          if (!snapshot) {
            setLiveDetection(null);
            clearOverlay();
            return;
          }

          const width = videoRef.current.videoWidth || videoRef.current.clientWidth;
          const height = videoRef.current.videoHeight || videoRef.current.clientHeight;
          const sampleRegions = buildSampleRegions(snapshot.landmarks, width, height, snapshot.bounds.width * width, snapshot.bounds.height * height);

          const detectionState: LiveDetectionState = {
            landmarks: snapshot.landmarks,
            faceBounds: {
              x: snapshot.bounds.minX * width,
              y: snapshot.bounds.minY * height,
              width: snapshot.bounds.width * width,
              height: snapshot.bounds.height * height,
            },
            sampleRegions,
          };

          setLiveDetection(detectionState);
          drawOverlay(detectionState, width, height);
        })
        .catch(() => {
          setLiveDetection(null);
          clearOverlay();
        })
        .finally(() => {
          detectInFlightRef.current = false;
        });
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      clearOverlay();
    };
  }, [capturedImage, isAnalyzing, isCameraReady, isModelReady]);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsCameraReady(false);
    setLiveDetection(null);
  };

  const startCamera = async () => {
    stopCamera();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await new Promise<void>((resolve) => {
          const video = videoRef.current;
          if (!video) {
            resolve();
            return;
          }

          if (video.readyState >= 1) {
            resolve();
            return;
          }

          const handleLoadedMetadata = () => {
            video.removeEventListener('loadedmetadata', handleLoadedMetadata);
            resolve();
          };

          video.addEventListener('loadedmetadata', handleLoadedMetadata);
        });
        await videoRef.current.play().catch(() => undefined);
      }
      setCapturedImage(null);
      setError(null);
      setIsCameraReady(true);
    } catch {
      setError('카메라에 접근할 수 없습니다. 브라우저 권한을 허용한 뒤 다시 시도해주세요.');
    }
  };

  const clearOverlay = () => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;
    const context = overlay.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, overlay.width, overlay.height);
  };

  const syncOverlaySize = (width: number, height: number) => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;
    if (overlay.width !== width || overlay.height !== height) {
      overlay.width = width;
      overlay.height = height;
    }
  };

  const landmarkPoint = (landmarks: NormalizedLandmark[], index: number, width: number, height: number) => ({
    x: landmarks[index].x * width,
    y: landmarks[index].y * height,
  });

  const averagePoint = (landmarks: NormalizedLandmark[], indices: number[], width: number, height: number) => {
    const points = indices.map((index) => landmarkPoint(landmarks, index, width, height));
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    };
  };

  const buildSampleRegions = (
    landmarks: NormalizedLandmark[],
    width: number,
    height: number,
    faceWidth: number,
    faceHeight: number,
  ): SampleRegion[] => {
    const leftCheek = landmarkPoint(landmarks, 205, width, height);
    const rightCheek = landmarkPoint(landmarks, 425, width, height);
    const leftIris = averagePoint(landmarks, LEFT_IRIS_INDICES, width, height);
    const rightIris = averagePoint(landmarks, RIGHT_IRIS_INDICES, width, height);
    const lipsCenter = averagePoint(landmarks, [13, 14, 78, 308], width, height);
    const forehead = landmarkPoint(landmarks, 10, width, height);

    const region = (key: SampleRegion['key'], label: string, centerX: number, centerY: number, regionWidth: number, regionHeight: number): SampleRegion => ({
      key,
      label,
      x: clamp(centerX - regionWidth / 2, 0, width - 1),
      y: clamp(centerY - regionHeight / 2, 0, height - 1),
      width: Math.max(1, Math.min(regionWidth, width)),
      height: Math.max(1, Math.min(regionHeight, height)),
    });

    return [
      region('skinLeft', '왼쪽 볼', leftCheek.x, leftCheek.y, faceWidth * 0.14, faceHeight * 0.1),
      region('skinRight', '오른쪽 볼', rightCheek.x, rightCheek.y, faceWidth * 0.14, faceHeight * 0.1),
      region('eyesLeft', '왼쪽 눈동자', leftIris.x, leftIris.y, faceWidth * 0.06, faceHeight * 0.05),
      region('eyesRight', '오른쪽 눈동자', rightIris.x, rightIris.y, faceWidth * 0.06, faceHeight * 0.05),
      region('lips', '입술 중심', lipsCenter.x, lipsCenter.y, faceWidth * 0.14, faceHeight * 0.06),
      region('hair', '헤어라인', forehead.x, clamp(forehead.y - faceHeight * 0.12, faceHeight * 0.04, height - 1), faceWidth * 0.18, faceHeight * 0.08),
    ];
  };

  const drawOverlay = (detectionState: LiveDetectionState, width: number, height: number) => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;

    syncOverlaySize(width, height);
    const context = overlay.getContext('2d');
    if (!context) return;

    context.clearRect(0, 0, width, height);

    context.strokeStyle = 'rgba(96, 165, 250, 0.9)';
    context.lineWidth = 2;
    context.strokeRect(detectionState.faceBounds.x, detectionState.faceBounds.y, detectionState.faceBounds.width, detectionState.faceBounds.height);

    context.fillStyle = 'rgba(96, 165, 250, 0.8)';
    for (const landmark of detectionState.landmarks) {
      context.beginPath();
      context.arc(landmark.x * width, landmark.y * height, 1.4, 0, Math.PI * 2);
      context.fill();
    }

    for (const region of detectionState.sampleRegions) {
      context.strokeStyle = 'rgba(244, 244, 245, 0.9)';
      context.lineWidth = 1.2;
      context.strokeRect(region.x, region.y, region.width, region.height);
      context.fillStyle = 'rgba(9, 9, 11, 0.75)';
      context.fillRect(region.x, Math.max(0, region.y - 18), 64, 16);
      context.fillStyle = 'rgba(244, 244, 245, 0.95)';
      context.font = '10px ui-monospace, monospace';
      context.fillText(region.label, region.x + 4, Math.max(10, region.y - 6));
    }
  };

  const sampleRegion = (context: CanvasRenderingContext2D, region: SampleRegion) => {
    const x = Math.round(region.x);
    const y = Math.round(region.y);
    const w = Math.max(1, Math.round(region.width));
    const h = Math.max(1, Math.round(region.height));
    const data = context.getImageData(x, y, w, h).data;

    let red = 0;
    let green = 0;
    let blue = 0;
    let count = 0;

    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] < 180) continue;
      red += data[index];
      green += data[index + 1];
      blue += data[index + 2];
      count += 1;
    }

    if (count === 0) {
      return { r: 0, g: 0, b: 0 };
    }

    return { r: red / count, g: green / count, b: blue / count };
  };

  const calculatePhotoQuality = (
    leftSkin: { r: number; g: number; b: number },
    rightSkin: { r: number; g: number; b: number },
    hair: { r: number; g: number; b: number },
    eyes: { r: number; g: number; b: number },
    lips: { r: number; g: number; b: number },
    faceWidth: number,
    frameWidth: number,
  ) => {
    const skinAverage = {
      r: (leftSkin.r + rightSkin.r) / 2,
      g: (leftSkin.g + rightSkin.g) / 2,
      b: (leftSkin.b + rightSkin.b) / 2,
    };

    const brightness = (skinAverage.r * 0.2126 + skinAverage.g * 0.7152 + skinAverage.b * 0.0722) / 255;
    const exposureScore = clamp(1 - Math.abs(brightness - 0.62) / 0.42, 0, 1);
    const symmetryScore = clamp(1 - deltaE(rgbToLab(leftSkin), rgbToLab(rightSkin)) / 28, 0, 1);
    const distinctness =
      (deltaE(rgbToLab(skinAverage), rgbToLab(hair)) +
        deltaE(rgbToLab(skinAverage), rgbToLab(eyes)) +
        deltaE(rgbToLab(skinAverage), rgbToLab(lips))) /
      3;
    const distinctnessScore = clamp(distinctness / 32, 0, 1);
    const sizeScore = clamp(faceWidth / (frameWidth * 0.42), 0, 1);

    return {
      overall: clamp(0.18 + exposureScore * 0.28 + symmetryScore * 0.22 + distinctnessScore * 0.2 + sizeScore * 0.12, 0.35, 0.98),
      exposure: exposureScore,
      symmetry: symmetryScore,
      distinctness: distinctnessScore,
      faceSize: sizeScore,
    };
  };

  const captureAndAnalyze = async () => {
    if (!videoRef.current || !captureCanvasRef.current) return;

    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    const context = canvas.getContext('2d');

    if (!context || !video.videoWidth || !video.videoHeight) {
      setError('카메라 프레임을 아직 읽지 못했습니다. 잠시 후 다시 시도해주세요.');
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    setCapturedImage(canvas.toDataURL('image/png'));
    stopCamera();
    setIsAnalyzing(true);
    setProgress(0);

    for (let index = 0; index < ANALYSIS_STEPS.length; index += 1) {
      setStatusMessage(ANALYSIS_STEPS[index]);
      await new Promise((resolve) => setTimeout(resolve, 180));
      setProgress(((index + 1) / ANALYSIS_STEPS.length) * 100);
    }

    const faceSnapshot = await detectFaceSnapshot(canvas, performance.now());
    if (!faceSnapshot) {
      setIsAnalyzing(false);
      setError('얼굴을 찾지 못했습니다. 얼굴을 정면으로 두고 밝은 환경에서 다시 촬영해주세요.');
      return;
    }

    const faceWidth = faceSnapshot.bounds.width * canvas.width;
    const faceHeight = faceSnapshot.bounds.height * canvas.height;

    if (faceWidth < canvas.width * 0.18 || faceHeight < canvas.height * 0.22) {
      setIsAnalyzing(false);
      setError('얼굴이 너무 작게 인식되었습니다. 카메라에 조금 더 가까이 와서 다시 촬영해주세요.');
      return;
    }

    const sampleRegions = buildSampleRegions(faceSnapshot.landmarks, canvas.width, canvas.height, faceWidth, faceHeight);
    const leftSkinRegion = sampleRegions.find((region) => region.key === 'skinLeft')!;
    const rightSkinRegion = sampleRegions.find((region) => region.key === 'skinRight')!;
    const leftEyeRegion = sampleRegions.find((region) => region.key === 'eyesLeft')!;
    const rightEyeRegion = sampleRegions.find((region) => region.key === 'eyesRight')!;
    const lipsRegion = sampleRegions.find((region) => region.key === 'lips')!;
    const hairRegion = sampleRegions.find((region) => region.key === 'hair')!;

    const leftSkin = sampleRegion(context, leftSkinRegion);
    const rightSkin = sampleRegion(context, rightSkinRegion);
    const leftEye = sampleRegion(context, leftEyeRegion);
    const rightEye = sampleRegion(context, rightEyeRegion);
    const lips = sampleRegion(context, lipsRegion);
    const hair = sampleRegion(context, hairRegion);

    const skin = {
      r: (leftSkin.r + rightSkin.r) / 2,
      g: (leftSkin.g + rightSkin.g) / 2,
      b: (leftSkin.b + rightSkin.b) / 2,
    };
    const eyes = {
      r: (leftEye.r + rightEye.r) / 2,
      g: (leftEye.g + rightEye.g) / 2,
      b: (leftEye.b + rightEye.b) / 2,
    };

    const quality = calculatePhotoQuality(leftSkin, rightSkin, hair, eyes, lips, faceWidth, canvas.width);

    const result = analyzePhotoColors({
      extractedColors: {
        skin: rgbToCss(skin),
        hair: rgbToCss(hair),
        eyes: rgbToCss(eyes),
        lips: rgbToCss(lips),
      },
      photoQuality: quality.overall,
      measurementDetails: {
        faceBounds: {
          x: Math.round(faceSnapshot.bounds.minX * canvas.width),
          y: Math.round(faceSnapshot.bounds.minY * canvas.height),
          width: Math.round(faceWidth),
          height: Math.round(faceHeight),
        },
        normalizedFeatures: {
          temperature: 0,
          lightness: 0,
          clarity: 0,
          contrast: 0,
          mutedScore: 0,
        },
        qualityBreakdown: {
          overall: Number(quality.overall.toFixed(4)),
          exposure: Number(quality.exposure.toFixed(4)),
          symmetry: Number(quality.symmetry.toFixed(4)),
          distinctness: Number(quality.distinctness.toFixed(4)),
          faceSize: Number(quality.faceSize.toFixed(4)),
        },
        roiMeasurements: [
          {
            label: '피부',
            color: rgbToCss(skin),
            rgb: { r: Math.round(skin.r), g: Math.round(skin.g), b: Math.round(skin.b) },
            lab: { ...rgbToLab(skin) },
            hsl: (() => {
              const hsl = rgbToHsl(skin);
              return { h: hsl.h * 360, s: hsl.s * 100, l: hsl.l * 100 };
            })(),
            region: {
              x: Math.round((leftSkinRegion.x + rightSkinRegion.x) / 2),
              y: Math.round((leftSkinRegion.y + rightSkinRegion.y) / 2),
              width: Math.round((leftSkinRegion.width + rightSkinRegion.width) / 2),
              height: Math.round((leftSkinRegion.height + rightSkinRegion.height) / 2),
            },
          },
          {
            label: '머리',
            color: rgbToCss(hair),
            rgb: { r: Math.round(hair.r), g: Math.round(hair.g), b: Math.round(hair.b) },
            lab: { ...rgbToLab(hair) },
            hsl: (() => {
              const hsl = rgbToHsl(hair);
              return { h: hsl.h * 360, s: hsl.s * 100, l: hsl.l * 100 };
            })(),
            region: { x: Math.round(hairRegion.x), y: Math.round(hairRegion.y), width: Math.round(hairRegion.width), height: Math.round(hairRegion.height) },
          },
          {
            label: '눈동자',
            color: rgbToCss(eyes),
            rgb: { r: Math.round(eyes.r), g: Math.round(eyes.g), b: Math.round(eyes.b) },
            lab: { ...rgbToLab(eyes) },
            hsl: (() => {
              const hsl = rgbToHsl(eyes);
              return { h: hsl.h * 360, s: hsl.s * 100, l: hsl.l * 100 };
            })(),
            region: {
              x: Math.round((leftEyeRegion.x + rightEyeRegion.x) / 2),
              y: Math.round((leftEyeRegion.y + rightEyeRegion.y) / 2),
              width: Math.round((leftEyeRegion.width + rightEyeRegion.width) / 2),
              height: Math.round((leftEyeRegion.height + rightEyeRegion.height) / 2),
            },
          },
          {
            label: '입술',
            color: rgbToCss(lips),
            rgb: { r: Math.round(lips.r), g: Math.round(lips.g), b: Math.round(lips.b) },
            lab: { ...rgbToLab(lips) },
            hsl: (() => {
              const hsl = rgbToHsl(lips);
              return { h: hsl.h * 360, s: hsl.s * 100, l: hsl.l * 100 };
            })(),
            region: { x: Math.round(lipsRegion.x), y: Math.round(lipsRegion.y), width: Math.round(lipsRegion.width), height: Math.round(lipsRegion.height) },
          },
        ],
        topSeasonScores: [],
      },
    });

    setIsAnalyzing(false);
    onAnalysisComplete(result);
  };

  return (
    <Card className="w-full max-w-3xl mx-auto overflow-hidden border-zinc-800 bg-zinc-950 text-zinc-100">
      <CardHeader className="border-b border-zinc-800 bg-zinc-900/50">
        <CardTitle className="flex items-center gap-2 text-xl font-light tracking-tight">
          <Camera className="w-5 h-5 text-zinc-400" />
          사진 분석 모듈
        </CardTitle>
        <CardDescription className="text-zinc-500 font-mono text-xs uppercase tracking-widest">
          MediaPipe Face Landmarker + Workbook Matching
        </CardDescription>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        {error ? (
          <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
            <AlertCircle className="w-12 h-12 text-red-500/50" />
            <p className="text-zinc-400">{error}</p>
            <Button variant="outline" onClick={() => void startCamera()}>
              다시 시도
            </Button>
          </div>
        ) : (
          <div className="relative aspect-video bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden group">
            {!capturedImage ? (
              <>
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover grayscale-[0.08]" />
                <canvas ref={overlayCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
                <div className="absolute top-4 left-4 rounded-full border border-sky-400/30 bg-zinc-950/70 px-3 py-1 text-[11px] font-mono text-sky-200">
                  {liveDetection ? 'Face Tracking Active' : '얼굴을 프레임 중앙에 맞춰 주세요'}
                </div>
                <div className="absolute bottom-4 right-4 rounded-xl border border-zinc-800 bg-zinc-950/75 px-3 py-2 text-[11px] text-zinc-300">
                  <div className="flex items-center gap-2">
                    <ScanFace className="w-3.5 h-3.5 text-zinc-400" />
                    <span>랜드마크 {liveDetection ? `${liveDetection.landmarks.length}개` : '대기 중'}</span>
                  </div>
                </div>
              </>
            ) : (
              <img src={capturedImage} alt="captured face" className="w-full h-full object-cover" />
            )}

            {isAnalyzing && (
              <div className="absolute inset-0 bg-zinc-950/80 backdrop-blur-sm flex flex-col items-center justify-center p-8 space-y-4">
                <RefreshCw className="w-8 h-8 text-zinc-400 animate-spin" />
                <div className="w-full max-w-xs space-y-3">
                  <Progress value={progress} className="h-1 bg-zinc-800" />
                  <p className="text-center text-xs text-zinc-400">{statusMessage}</p>
                  <p className="text-center text-[10px] font-mono text-zinc-600 uppercase tracking-widest">{Math.round(progress)}%</p>
                </div>
              </div>
            )}
          </div>
        )}

        <canvas ref={captureCanvasRef} className="hidden" />

        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 text-sm text-zinc-400 leading-relaxed">
            얼굴을 중앙 가이드 안에 맞추고 정면을 바라봐 주세요. 실시간으로 얼굴 랜드마크와 실제 샘플링 ROI가 영상 위에 표시됩니다.
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 text-sm text-zinc-400 leading-relaxed">
            현재 샘플링 부위: 양쪽 볼, 양쪽 홍채 중심, 입술 중심, 헤어라인 상단. 촬영 후 결과 화면에서 측정값 상세를 볼 수 있습니다.
          </div>
        </div>

        <div className="flex justify-center gap-4">
          {!capturedImage ? (
            <Button
              onClick={() => void captureAndAnalyze()}
              disabled={!isCameraReady || !isModelReady || isAnalyzing || !liveDetection}
              className="bg-zinc-100 text-zinc-950 hover:bg-zinc-300 px-8 py-6 rounded-full font-medium transition-all active:scale-95"
            >
              사진 촬영 후 분석
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => void startCamera()}
              className="border-zinc-800 text-zinc-400 hover:bg-zinc-900 px-8 py-6 rounded-full"
            >
              다시 촬영
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
