export const TEXT_SIZES = [75, 100, 125];
export const DEFAULT_TEXT_SIZE = 100;
const BASE_PX = 16; // font size of <html> at 100 %: every text size of the stylesheet is in rem, so they all follow

/** Sets the font size of <html>: 75 % → 12 px, 100 % → 16 px, 125 % → 20 px; all the texts of the UI grow or shrink with it. */
export function applyTextSize(percent, root = document.documentElement) {
  const value = TEXT_SIZES.includes(percent) ? percent : DEFAULT_TEXT_SIZE;
  root.style.fontSize = `${(BASE_PX * value) / 100}px`;
  return value;
}
