import type { FaceLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision';

const TASKS_VISION_VERSION = '0.10.34';
const WASM_BASE_PATH = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
const MODEL_ASSET_PATH =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

let faceLandmarkerPromise: Promise<FaceLandmarker> | null = null;

export interface FaceDetectionSnapshot {
  landmarks: NormalizedLandmark[];
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
  };
}

async function createFaceLandmarker() {
  const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE_PATH);

  const createWithDelegate = (delegate: 'GPU' | 'CPU') =>
    FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_ASSET_PATH,
        delegate,
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      minFaceDetectionConfidence: 0.35,
      minFacePresenceConfidence: 0.35,
      minTrackingConfidence: 0.35,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });

  try {
    return await createWithDelegate('GPU');
  } catch {
    return createWithDelegate('CPU');
  }
}

export async function getFaceLandmarker() {
  if (!faceLandmarkerPromise) {
    faceLandmarkerPromise = createFaceLandmarker();
  }

  return faceLandmarkerPromise;
}

export async function detectFaceSnapshot(
  image: HTMLCanvasElement | HTMLVideoElement | HTMLImageElement,
  timestamp = performance.now(),
): Promise<FaceDetectionSnapshot | null> {
  const faceLandmarker = await getFaceLandmarker();
  const result = faceLandmarker.detectForVideo(image, timestamp);
  const landmarks = result.faceLandmarks[0];

  if (!landmarks || landmarks.length === 0) {
    return null;
  }

  const xs = landmarks.map((landmark) => landmark.x);
  const ys = landmarks.map((landmark) => landmark.y);
  const minX = Math.max(0, Math.min(...xs));
  const minY = Math.max(0, Math.min(...ys));
  const maxX = Math.min(1, Math.max(...xs));
  const maxY = Math.min(1, Math.max(...ys));

  return {
    landmarks,
    bounds: {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
    },
  };
}
