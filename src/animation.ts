import {
  Position,
  Rect,
  elemParentRelativeRect,
  posEquals,
  toPosition,
} from "./geom";
import { TimingFunction, linear } from "./timing";

interface ControllerHandle {
  readonly clear: () => void;
  readonly measure: () => void;
  readonly animate: (time: DOMHighResTimeStamp) => void;
}

const controllers: Array<ControllerHandle> = [];

function frame(time: DOMHighResTimeStamp) {
  if (controllers.length == 0) {
    return;
  }

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

export interface SortableAnimationController {
  readonly enable: (start?: Position, onFinish?: () => any) => void;
  readonly disable: () => void;
  readonly enabled: () => boolean;
  readonly layoutParentRelativeRect: () => Rect;
  readonly cleanup: () => void;
}

const defaultTimingFunc = linear;
const defaultAnimDurMs = 200;

export function createSortableAnimationController(
  element: HTMLElement,
  timingFuncArg?: () => TimingFunction | undefined,
  animDurMsArg?: () => number | undefined,
): SortableAnimationController {
  const timingFunc = () => timingFuncArg?.() ?? defaultTimingFunc;
  const animDurMs = () => animDurMsArg?.() ?? defaultAnimDurMs;

  let enabled = true;

  let layoutParentRelativeRect = elemParentRelativeRect(element);
  let layoutRelativePos: Position = toPosition(layoutParentRelativeRect);
  let newLayoutRelativePos: Position | undefined;
  let onFinish: (() => any) | undefined;

  let startTime: DOMHighResTimeStamp | undefined;
  let startPos: Position | undefined;
  let currentPos: Position | undefined;

  const startAnimating = () => newLayoutRelativePos != null;
  const animating = () => startTime != null;

  const handle: ControllerHandle = {
    clear: () => {
      if (!enabled) {
        return;
      }

      element.style.transform = "";
    },
    measure: () => {
      if (!enabled) {
        return;
      }

      layoutParentRelativeRect = elemParentRelativeRect(element);
      const currentLayoutRelativePos = toPosition(layoutParentRelativeRect);
      if (!posEquals(layoutRelativePos, currentLayoutRelativePos)) {
        newLayoutRelativePos = currentLayoutRelativePos;
      }
    },
    animate: (time: DOMHighResTimeStamp) => {
      if (!enabled || (!animating() && !startAnimating())) {
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
        onFinish?.();
        onFinish = undefined;
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

  const idx = controllers.length;
  controllers.push(handle);
  if (idx == 0) {
    requestAnimationFrame(frame);
  }

  return {
    enable: (start, inputOnFinish) => {
      enabled = true;
      if (start != null) {
        layoutRelativePos = start;
      }
      onFinish = inputOnFinish;
    },
    disable: () => {
      enabled = false;
      startTime = undefined;
      startPos = undefined;
      currentPos = undefined;
    },
    enabled: () => enabled,
    layoutParentRelativeRect: () => layoutParentRelativeRect,
    cleanup: () => {
      controllers.splice(idx, 1);
    },
  };
}
