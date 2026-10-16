export function shouldDismissSheet(
  translation: number,
  velocity: number,
  height: number,
): boolean {
  "worklet";
  if (
    !Number.isFinite(translation) ||
    !Number.isFinite(velocity) ||
    !Number.isFinite(height)
  )
    return false;
  const threshold = Math.max(72, Math.min(150, height * 0.25));
  return translation > threshold || (translation > 24 && velocity > 950);
}
