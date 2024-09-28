import { TimingFunction, linear } from "./ease";
import { Position, clientToRelative, posEquals } from "./geom";

interface ControllerHandle {
  readonly clear: () => void;
  readonly measure: () => void;
  readonly animate: (time: DOMHighResTimeStamp) => void;
}

const controllers: Array<ControllerHandle> = [];

function frame(time: DOMHighResTimeStamp) {
  // Breaking the controller into steps ensures that this never causes more than one
  // forced reflow, which significantly improves performance.

  for (const controller of controllers) {
    controller.clear();
  }

  for (const controller of controllers) {
    controller.measure();
  }

  for (const controller of controllers) {
    controller.animate(time);
  }

  if (controllers.length > 0) {
    requestAnimationFrame(frame);
  }
}

export interface SortableAnimationController {
  readonly enable: (start?: Position) => void;
  readonly disable: () => void;
  readonly enabled: () => boolean;
  readonly layoutClientBoundingRect: () => DOMRect;
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

  let layoutClientBoundingRect = element.getBoundingClientRect();
  let layoutRelativePos: Position = clientToRelative(
    layoutClientBoundingRect,
    element.parentElement!,
  );
  let newLayoutRelativePos: Position | undefined;

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

      layoutClientBoundingRect = element.getBoundingClientRect();
      const currentLayoutRelativePos = clientToRelative(
        layoutClientBoundingRect,
        element.parentElement!,
      );
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
    enable: (start) => {
      enabled = true;
      if (start != null) {
        layoutRelativePos = start;
      }
    },
    disable: () => {
      enabled = false;
      startTime = undefined;
      startPos = undefined;
      currentPos = undefined;
    },
    enabled: () => enabled,
    layoutClientBoundingRect: () => layoutClientBoundingRect,
    cleanup: () => {
      controllers.splice(idx, 1);
    },
  };
}
