import { EaseFunction } from "./ease";
import { Position, elemParentRelativeRect, posEquals } from "./geom";

interface ControllerHandle {
  readonly clear: () => void;
  readonly measure: () => void;
  readonly animate: (time: DOMHighResTimeStamp) => void;
}

const controllers: Array<ControllerHandle> = [];

function loop(time: DOMHighResTimeStamp) {
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
    requestAnimationFrame(loop);
  }
}

export interface SortableAnimationController {
  readonly enable: (start?: Position) => void;
  readonly disable: () => void;
  readonly cleanup: () => void;
}

export function createSortableAnimationController(
  element: HTMLElement,
  easeFunc: () => EaseFunction,
  easeTime: () => number,
): SortableAnimationController {
  let enabled = true;

  let layoutPos: Position = elemParentRelativeRect(element);
  let newLayoutPos: Position | undefined;

  let startTime: DOMHighResTimeStamp | undefined;
  let startPos: Position | undefined;
  let currentPos: Position | undefined;

  const startAnimating = () => newLayoutPos != null;
  const animating = () => startTime != null;

  const handle: ControllerHandle = {
    clear: () => {
      element.style.transform = "";
    },
    measure: () => {
      const currentLayoutRect = elemParentRelativeRect(element);
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
      if (elapsed > easeTime()) {
        element.style.transform = "";
        startTime = undefined;
        startPos = undefined;
        currentPos = undefined;
      } else {
        const frac = easeFunc()(elapsed / easeTime());
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
    requestAnimationFrame(loop);
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
    cleanup: () => {
      controllers.splice(idx, 1);
    },
  };
}
