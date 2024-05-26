export type EaseFunction = (value: number) => number;

// code copied from: https://gizma.com/easing/

export function easeInSine(x: number): number {
  return 1 - Math.cos((x * Math.PI) / 2);
}

export function easeOutSine(x: number): number {
  return Math.sin((x * Math.PI) / 2);
}

export function easeInOutSine(x: number): number {
  return -(Math.cos(Math.PI * x) - 1) / 2;
}
