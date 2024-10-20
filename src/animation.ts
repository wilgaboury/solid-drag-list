import {
  Position,
  Rect,
  elemParentRelativeRect,
  posEquals,
  toPosition,
} from "./geom";
import { TimingFunction, linear } from "./timing";

let running: number | undefined;

function start() {
  if (controllers.size > 0 && running == null) {
    running = requestAnimationFrame(frame);
  }
}

function stop() {
  if (running != null) {
    cancelAnimationFrame(running);
    running = undefined;
    for (const controller of controllers) {
      controller.cancel();
    }
  }
}

interface ControllerHandle {
  readonly cancel: () => void;
  readonly clear: () => void;
  readonly measure: () => void;
  readonly animate: (time: DOMHighResTimeStamp) => void;
}

const controllers: Set<ControllerHandle> = new Set();

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stop();
  } else {
    start();
  }
});

function frame(time: DOMHighResTimeStamp) {
  // breaking controllers into steps ensures there isn't more than one forced reflow, which significantly improves animation performance

  for (const controller of controllers) {
    controller.clear();
  }

  for (const controller of controllers) {
    controller.measure();
  }

  for (const controller of controllers) {
    controller.animate(time);
  }

  requestAnimationFrame(frame);
}

export interface AnimationController {
  readonly start: (position?: Position) => Promise<void>;
  readonly stop: () => void;
  readonly running: () => boolean;
  readonly layoutParentRelativeRect: () => Rect;
}

const defaultTimingFunc = linear;
const defaultAnimDurMs = 200;

export function createAnimationController(
  element: HTMLElement,
  timingFuncArg?: () => TimingFunction | undefined,
  animDurMsArg?: () => number | undefined,
): AnimationController {
  const timingFunc = () => timingFuncArg?.() ?? defaultTimingFunc;
  const animDurMs = () => animDurMsArg?.() ?? defaultAnimDurMs;

  let layoutParentRelativeRect = elemParentRelativeRect(element);
  let layoutRelativePos: Position = toPosition(layoutParentRelativeRect);
  let newLayoutRelativePos: Position | undefined;
  let resolveAnimationFinish: (() => any) | undefined;

  let startTime: DOMHighResTimeStamp | undefined;
  let startPos: Position | undefined;
  let currentPos: Position | undefined;

  const startAnimating = () => newLayoutRelativePos != null;
  const animating = () => startTime != null;

  const handle: ControllerHandle = {
    cancel: () => {
      element.style.transform = "";
      startTime = undefined;
      startPos = undefined;
      currentPos = undefined;
    },
    clear: () => {
      element.style.transform = "";
    },
    measure: () => {
      layoutParentRelativeRect = elemParentRelativeRect(element);
      const currentLayoutRelativePos = toPosition(layoutParentRelativeRect);
      if (!posEquals(layoutRelativePos, currentLayoutRelativePos)) {
        newLayoutRelativePos = currentLayoutRelativePos;
      }
    },
    animate: (time: DOMHighResTimeStamp) => {
      if (!animating() && !startAnimating()) {
        resolveAnimationFinish?.();
        resolveAnimationFinish = undefined;
        return;
      }

      if (newLayoutRelativePos != null) {
        if (startTime == null) {
          startPos = layoutRelativePos;
          currentPos = layoutRelativePos;
        } else {
          startPos = currentPos;
        }
        startTime = time;
        layoutRelativePos = newLayoutRelativePos;
        newLayoutRelativePos = undefined;
      }

      const elapsed = time - startTime!;
      if (elapsed > animDurMs()) {
        element.style.transform = "";
        startTime = undefined;
        startPos = undefined;
        currentPos = undefined;
        resolveAnimationFinish?.();
        resolveAnimationFinish = undefined;
      } else {
        const frac = timingFunc()(elapsed / animDurMs());
        currentPos = {
          x: startPos!.x + frac * (layoutRelativePos.x - startPos!.x),
          y: startPos!.y + frac * (layoutRelativePos.y - startPos!.y),
        };
        const deltaX = currentPos.x - layoutRelativePos.x;
        const deltaY = currentPos.y - layoutRelativePos.y;
        element.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
      }
    },
  };

  return {
    start: (position) => {
      if (!controllers.has(handle)) {
        controllers.add(handle);
        start();

        if (position != null) {
          layoutRelativePos = position;
        }

        const { promise, resolve } = Promise.withResolvers<void>();
        resolveAnimationFinish = resolve;
        return promise;
      } else {
        return Promise.resolve();
      }
    },
    stop: () => {
      if (controllers.has(handle)) {
        controllers.delete(handle);
        if (controllers.size == 0) {
          stop();
        }

        startTime = undefined;
        startPos = undefined;
        currentPos = undefined;
      }
    },
    running: () => controllers.has(handle),
    layoutParentRelativeRect: () => layoutParentRelativeRect,
  };
}
