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
  readonly clientBoundingRect: () => DOMRect;
  readonly cleanup: () => void;
}

const defaultTimingFunc = linear;
const defaultAnimDurMs = 200;

export function createSortableAnimationController(
  element: HTMLElement,
  timingFuncArg?: () => TimingFunction | undefined,
  animDurMsArg?: () => number | undefined,
): SortableAnimationController {
  element.style.willChange = "transform";
  const timingFunc = () => timingFuncArg?.() ?? defaultTimingFunc;
  const animDurMs = () => animDurMsArg?.() ?? defaultAnimDurMs;

  let enabled = true;

  let clientBoundingRect = element.getBoundingClientRect();
  let layoutPos: Position = clientToRelative(
    clientBoundingRect,
    element.parentElement!,
  );
  let newLayoutPos: Position | undefined;

  let startTime: DOMHighResTimeStamp | undefined;
  let startPos: Position | undefined;
  let currentPos: Position | undefined;

  const startAnimating = () => newLayoutPos != null;
  const animating = () => startTime != null;

  const handle: ControllerHandle = {
    clear: () => {
      if (!enabled) {
        return;
      }

      if (element.style.transform !== "") {
        element.style.transform = "";
      }
    },
    measure: () => {
      if (!enabled) {
        return;
      }

      clientBoundingRect = element.getBoundingClientRect();
      const currentLayoutRect = clientToRelative(
        clientBoundingRect,
        element.parentElement!,
      );
      if (!posEquals(layoutPos, currentLayoutRect)) {
        newLayoutPos = currentLayoutRect;
      }
    },
    animate: (time: DOMHighResTimeStamp) => {
      if (!enabled || (!animating() && !startAnimating())) {
        return;
      }

      if (newLayoutPos != null) {
        if (startTime == null) {
          startPos = layoutPos;
          currentPos = layoutPos;
        } else {
          startPos = currentPos;
        }
        startTime = time;
        layoutPos = newLayoutPos;
        newLayoutPos = undefined;
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
          x: startPos!.x + frac * (layoutPos.x - startPos!.x),
          y: startPos!.y + frac * (layoutPos.y - startPos!.y),
        };
        const deltaX = currentPos.x - layoutPos.x;
        const deltaY = currentPos.y - layoutPos.y;
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
        layoutPos = start;
      }
    },
    disable: () => {
      enabled = false;
      startTime = undefined;
      startPos = undefined;
      currentPos = undefined;
    },
    enabled: () => enabled,
    clientBoundingRect: () => clientBoundingRect,
    cleanup: () => {
      controllers.splice(idx, 1);
    },
  };
}
