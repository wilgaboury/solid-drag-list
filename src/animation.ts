import { EaseFunction } from "./ease";
import { Position, elemParentRelativeRect, posEquals } from "./geom";

export interface SortableAnimationController {
  // readonly setEaseFunc: (func: EaseFunction) => void;
  // readonly setEaseTime: (time: number) => void;
  readonly update: () => void;
  readonly create: (element: HTMLElement) => SortedAnimationController;
}

export interface SortedAnimationController {
  readonly update: () => void;
  readonly enable: (start?: Position) => void;
  readonly disable: () => void;
  readonly cleanup: () => void;
}

interface ChildController {
  readonly controller: SortedAnimationController;
  readonly frame: (time: DOMHighResTimeStamp) => void;
}

export function createdSortableAnimationController(init: {
  element: HTMLElement;
  easeFunc: EaseFunction;
  easeTime: number;
}): SortableAnimationController {
  const children = new Set<ChildController>();
  const easeFunc = init.easeFunc;
  const easeTime = init.easeTime;

  const request = createAnimationFrameDedup((time) => {
    for (const child of children) {
      child.frame(time);
    }
  });

  const update = () => {
    for (const child of children) {
      child.controller.update();
    }
  };

  const mutationObserver = new MutationObserver(update);
  const resizeObserver = new ResizeObserver(update);

  mutationObserver.observe(init.element, {
    attributes: true,
    attributeFilter: ["style"],
  });
  resizeObserver.observe(init.element);

  return {
    update,
    create: (element) => {
      const child = createChildController({
        request,
        element,
        update,
        remove: () => children.delete(child),
        easeFunc,
        easeTime,
      });
      children.add(child);
      return child.controller;
    },
  };
}

function createChildController(args: {
  request: () => void;
  element: HTMLElement;
  update: () => void;
  remove: () => void;
  easeFunc: EaseFunction;
  easeTime: number;
}): ChildController {
  let enabled = true;

  let layoutPos: Position = elemParentRelativeRect(args.element);
  let newLayoutPos: Position | undefined;

  let startTime: DOMHighResTimeStamp | undefined;
  let startPos: Position | undefined;
  let currentPos: Position | undefined;

  const startAnimating = () => newLayoutPos != null;
  const animating = () => startTime != null;

  const mutationObserver = new MutationObserver(args.update);
  const resizeObserver = new ResizeObserver(args.update);

  mutationObserver.observe(args.element, {
    attributes: true,
    attributeFilter: ["style"],
  });
  resizeObserver.observe(args.element);

  const bypassMutationObserver = (callback: () => any) => {
    if (mutationObserver.takeRecords().length > 0) {
      queueMicrotask(args.update);
    }
    mutationObserver.disconnect();
    callback();
    mutationObserver.observe(args.element, {
      attributes: true,
      attributeFilter: ["style"],
    });
  };

  return {
    controller: {
      update: () => {
        if (!enabled) {
          return;
        }

        bypassMutationObserver(() => (args.element.style.transform = ""));

        const currentLayoutRect = elemParentRelativeRect(args.element);
        if (!posEquals(layoutPos, currentLayoutRect)) {
          console.log("new position");
          newLayoutPos = currentLayoutRect;
          args.request();
        }
      },
      enable: (start) => {
        enabled = true;

        if (start != null && !posEquals(layoutPos, start)) {
          newLayoutPos = start;
          args.request();
        }
      },
      disable: () => {
        enabled = false;
        startTime = undefined;
        startPos = undefined;
        currentPos = undefined;
      },
      cleanup: () => {
        args.remove();
        mutationObserver.disconnect();
        resizeObserver.disconnect();
      },
    },
    frame: (time) => {
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
      if (elapsed > args.easeTime) {
        bypassMutationObserver(() => (args.element.style.transform = ""));
        startTime = undefined;
        startPos = undefined;
        currentPos = undefined;
        return;
      }

      const frac = args.easeFunc(elapsed / args.easeTime);
      currentPos = {
        x: startPos!.x + frac * (layoutPos.x - startPos!.x),
        y: startPos!.y + frac * (layoutPos.y - startPos!.y),
      };
      const deltaX = currentPos.x - layoutPos.x;
      const deltaY = currentPos.y - layoutPos.y;
      bypassMutationObserver(
        () =>
          (args.element.style.transform = `translate(${deltaX}px, ${deltaY}px)`),
      );
      args.request();
    },
  };
}

function createAnimationFrameDedup(callback: FrameRequestCallback): () => void {
  let hasRequested = false;

  const frame = (time: DOMHighResTimeStamp) => {
    hasRequested = false;
    callback(time);
  };

  return () => {
    if (!hasRequested) {
      hasRequested = true;
      requestAnimationFrame(frame);
    }
  };
}
