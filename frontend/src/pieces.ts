export function badge(cls: string, value: string | number) {
  const span = document.createElement('span');
  span.className = cls;
  span.textContent = String(value);
  return span;
}

export const byId = (id: string) => document.getElementById(id)!;
/** CSS scale that fits the 1440 × 810 board into the viewport. */
export const boardScale = () => Math.min(innerWidth / 1440, innerHeight / 810);
export function localPoint(x: number, y: number) {
  const bounds = byId('table').getBoundingClientRect();
  return { x: (x - bounds.left) * 1440 / bounds.width, y: (y - bounds.top) * 810 / bounds.height };
}
