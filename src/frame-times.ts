/** Endpoint-exclusive frame times, like a video: N frames span N/fps seconds. */
export function frameTimes(
  duration: number,
  options: { start?: number; duration?: number; fps?: number } = {},
): number[] {
  const start = options.start ?? 0, fps = options.fps ?? 24;
  const span = options.duration ?? duration - start;
  if (
    !Number.isFinite(duration) || duration <= 0 || !Number.isFinite(start) ||
    start < 0 || start >= duration
  ) throw new Error("Frame start must be inside the animation duration.");
  if (!Number.isFinite(fps) || fps <= 0 || fps > 240) {
    throw new Error("Frame fps must be in (0, 240].");
  }
  if (!Number.isFinite(span) || span <= 0 || start + span > duration + 1e-9) {
    throw new Error(
      "Frame duration must be positive and stay inside the animation.",
    );
  }
  const count = Math.ceil(span * fps - 1e-9);
  if (count < 1 || count > 3600) {
    throw new Error(
      "Capture must contain 1–3600 frames; reduce duration or fps.",
    );
  }
  return Array.from({ length: count }, (_, i) => start + i / fps);
}
