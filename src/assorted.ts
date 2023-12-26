/**
 * mod but the result is always positive
 */
export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

export function clamp(number: number, min = 0, max = 1): number {
  return number > max ? max : number < min ? min : number;
}

export function escapeRegExp(text: string) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

export function convertUrlToAbsolute(origin: string, path: string): string {
  if (path.indexOf("://") > 0) {
    return path;
  } else if (path.indexOf("//") === 0) {
    return "https:" + path;
  } else {
    let url = new URL(origin);
    if (path.slice(0, 1) === "/") {
      return url.origin + path;
    } else {
      if (url.pathname.slice(-1) !== "/") {
        url.pathname = url.pathname + "/";
      }
      return url.origin + url.pathname + path;
    }
  }
}

export async function encodeBlob(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onloadend = () => resolve(reader.result as string);
  });
}

export async function decodeBlob(str: string): Promise<Blob> {
  return (await fetch(str)).blob();
}

export function toUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    console.error(`not a valid url: ${url}`);
    return undefined;
  }
}

export function urlToDomain(url: string): string | undefined {
  return toUrl(url)?.hostname;
}

export function isValidUrl(url: string) {
  try {
    new URL(url);
  } catch (_) {
    return false;
  }
  return true;
}

export interface CancelablePromise<T> {
  readonly promise: Promise<T>;
  readonly cancel: () => void;
}

export function makeRejectCancelable<T>(
  promise: Promise<T>,
): CancelablePromise<T> {
  let canceled = false;

  const wrappedPromise = new Promise<T>((resolve, reject) => {
    promise.then((value) =>
      canceled ? reject({ isCanceled: true }) : resolve(value),
    );
    promise.catch((error) =>
      canceled ? reject({ isCanceled: true }) : reject(error),
    );
  });

  return {
    promise: wrappedPromise,
    cancel() {
      canceled = true;
    },
  };
}

export function makeSilentCancelable<T>(
  promise: Promise<T>,
): CancelablePromise<T | null> {
  let canceled = false;

  const wrappedPromise = new Promise<T | null>((resolve, reject) => {
    promise.then((value) => (canceled ? resolve(null) : resolve(value)));
    promise.catch((error) => reject(error));
  });

  return {
    promise: wrappedPromise,
    cancel() {
      canceled = true;
    },
  };
}

export function visitMutate(obj: any, mutate: (key: string, obj: any) => void) {
  for (const k in obj) {
    mutate(k, obj);
    const value = obj[k];
    if (typeof value === "object") {
      visitMutate(value, mutate);
    }
  }
}

export async function asyncVisitMutate(
  obj: any,
  mutate: (key: string, obj: any) => Promise<void>,
): Promise<void> {
  for (const k in obj) {
    await mutate(k, obj);
    const value = obj[k];
    if (typeof value === "object") {
      visitMutate(value, mutate);
    }
  }
}

export function errorSwitch<T>(value: T): (reason: any) => T {
  return (reason) => {
    console.error(reason);
    return value;
  };
}

export function applyChanges<T, K extends keyof T>(
  obj: T,
  changes: Pick<T, K>,
): T {
  return Object.assign({}, obj, changes);
}

export function normalize(n: number, min: number, max: number): number {
  return (clamp(n, min, max) - min) / (max - min);
}

/**
 * @param n value between 0 and 1
 * @param t value > 0 that controls the curvature of the function
 * @returns value from zero to infinity
 */
export function mapZeroOneToZeroInf(n: number, t = 1): number {
  return t / (1 - Math.max(0, Math.min(1, n))) - t;
}

export function assertExhaustive(
  value: never,
  message: string = "Reached unexpected case in exhaustive switch",
): never {
  throw new Error(message);
}

export function run<T>(func: () => T): T {
  return func();
}

export function union<T>(set1: Set<T>, set2: Set<T>): Set<T> {
  return new Set([...set1, ...set2]);
}

export function intersect<T>(set1: Set<T>, set2: Set<T>): Set<T> {
  return new Set([...set1].filter(set2.has));
}

export function difference<T>(set1: Set<T>, set2: Set<T>): Set<T> {
  return new Set([...set1].filter((item) => !set2.has(item)));
}

export function move<T>(
  arr: Array<T>,
  fromIdx: number,
  toIdx: number,
): Array<T> {
  const elem = arr[fromIdx];
  if (elem == null) {
    console.error("index out of bounds");
    return arr;
  }
  arr.splice(fromIdx, 1);
  arr.splice(toIdx, 0, elem);
  return arr;
}

export function zip<A, B>(
  a: ReadonlyArray<A>,
  b: ReadonlyArray<B>,
): ReadonlyArray<[A, B]> {
  const len = Math.min(a.length, b.length);
  const ret: Array<[A, B]> = new Array();
  for (let i = 0; i < len; i++) {
    ret.push([a[i]!, b[i]!]);
  }
  return ret;
}
