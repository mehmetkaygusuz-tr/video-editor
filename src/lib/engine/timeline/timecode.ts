/**
 * SMPTE Timecode & Frame Quantization Engine
 * Follows SMPTE 12M-1 standards for accurate frame quantization,
 * eliminating subframe fractional discrepancies and video/audio micro-gaps.
 */

export const DEFAULT_PROJECT_FPS = 30;

/**
 * Quantizes an arbitrary time in seconds to the nearest discrete frame boundary.
 * Prevents floating-point subframe drift in non-linear editing.
 */
export function quantizeToFrame(seconds: number, fps: number = DEFAULT_PROJECT_FPS): number {
  if (seconds <= 0) return 0;
  const frameIndex = Math.round(seconds * fps);
  return Number((frameIndex / fps).toFixed(6));
}

/**
 * Floor quantize: rounds down to the preceding frame boundary.
 */
export function floorToFrame(seconds: number, fps: number = DEFAULT_PROJECT_FPS): number {
  if (seconds <= 0) return 0;
  const frameIndex = Math.floor(seconds * fps);
  return Number((frameIndex / fps).toFixed(6));
}

/**
 * Ceil quantize: rounds up to the next frame boundary.
 */
export function ceilToFrame(seconds: number, fps: number = DEFAULT_PROJECT_FPS): number {
  if (seconds <= 0) return 0;
  const frameIndex = Math.ceil(seconds * fps);
  return Number((frameIndex / fps).toFixed(6));
}

/**
 * Converts timeline seconds to frame integer count.
 */
export function secondsToFrames(seconds: number, fps: number = DEFAULT_PROJECT_FPS): number {
  return Math.max(0, Math.round(seconds * fps));
}

/**
 * Converts frame integer count to timeline seconds.
 */
export function framesToSeconds(frames: number, fps: number = DEFAULT_PROJECT_FPS): number {
  return Math.max(0, Number((frames / fps).toFixed(6)));
}

/**
 * Formats time in seconds to standard SMPTE timecode string: HH:MM:SS:FF
 */
export function formatSMPTETimecode(seconds: number, fps: number = DEFAULT_PROJECT_FPS): string {
  const totalFrames = Math.max(0, Math.round(seconds * fps));
  const frames = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);

  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(frames)}`;
}
