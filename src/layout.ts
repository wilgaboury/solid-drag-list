import { createSignal } from "solid-js";

import { assertExhaustive, clamp, mod, zip } from "./util";
import {
  Position,
  Rect,
  Size,
  area,
  elemClientRect,
  intersection,
  intersects,
  pageToRelative,
} from "./geom";

export interface Layout {
  readonly pos: (idx: number) => Position;
  readonly checkIndex?: (rect: Rect) => number | undefined; // rect page space
}
export interface Layouter {
  readonly mount?: (elem: HTMLDivElement) => void;
  readonly unmount?: () => void;
  readonly layout: (sizes: ReadonlyArray<Size>) => Layout;
}

/**
 * Lays out an array of elements in a grid with elements going from left to right and wrapping
 * based on the width of the containing element. It will make each grid cell the size of the
 * largest item, so for proper functioning.
 *
 * @param trackRelayout hook for reactive variable changes to cause a relayout
 */
export function flowGridLayout(options?: {
  align?: "left" | "center" | "right";
  alignItems?: "left" | "center" | "right";
  flowDirection?: "right" | "left" | "down" | "up";
}): Layouter {
  function calcHeight(
    n: number,
    width: number,
    itemWidth: number,
    itemHeight: number,
  ) {
    return Math.ceil(n / Math.floor(width / itemWidth)) * itemHeight;
  }
  function calcMargin(boundingWidth: number, itemWidth: number) {
    const align = options?.align;
    switch (align) {
      case undefined:
      case "center":
        return Math.floor(mod(boundingWidth, itemWidth) / 2);
      case "left":
        return 0;
      case "right":
        return Math.floor(mod(boundingWidth, itemWidth));
      default:
        assertExhaustive(align);
    }
  }

  function calcPosition(
    index: number,
    margin: number,
    boundingWidth: number,
    itemWidth: number,
    itemHeight: number,
  ) {
    const perRow = Math.floor(boundingWidth / itemWidth);
    return {
      x: margin + itemWidth * mod(index, perRow),
      y: itemHeight * Math.floor(index / perRow),
    };
  }

  function calcIndex(
    x: number,
    y: number,
    margin: number,
    boundingWidth: number,
    boudningHeight: number,
    itemWidth: number,
    itemHeight: number,
  ) {
    const cols = Math.floor(boundingWidth / itemWidth);
    const rows = Math.floor(boudningHeight / itemHeight);
    const xidx =
      x + itemWidth < margin || x > boundingWidth - margin
        ? undefined
        : Math.max(
            0,
            Math.min(
              cols - 1,
              Math.floor(((x + x + itemWidth) / 2 - margin) / itemWidth),
            ),
          );
    const yidx =
      y + itemHeight < 0 || y > boudningHeight
        ? undefined
        : Math.max(
            0,
            Math.min(
              rows - 1,
              Math.floor((y + y + itemHeight) / 2 / itemHeight),
            ),
          );
    return xidx == null || yidx == null ? null : xidx + yidx * cols;
  }

  let container: HTMLElement | undefined;
  const [width, setWidth] = createSignal(0, {
    equals: (v1, v2) => v1 === v2,
  });
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (entry.target instanceof HTMLElement) {
        setWidth(elemClientRect(entry.target).width);
      }
    }
  });

  return {
    mount: (elem) => {
      container = elem;
      observer.observe(container);
      container.style.width = "100%";
      container.style.height = "100%";
    },
    unmount: () => {
      if (container != null) {
        observer.unobserve(container);
      }
      container = undefined;
    },
    layout: (sizes) => {
      const itemWidth = Math.max(0, ...sizes.map((s) => s.width));
      const itemHeight = Math.max(0, ...sizes.map((s) => s.height));

      const minHeight = calcHeight(
        sizes.length,
        width(),
        itemWidth,
        itemHeight,
      );
      const margin = calcMargin(width(), itemWidth);

      if (container != null) {
        if (sizes.length > 0) {
          container.style.minHeight = `${minHeight}px`;
        } else {
          container.style.minHeight = "";
        }
      }

      return {
        pos: (idx) => calcPosition(idx, margin, width(), itemWidth, itemHeight),
        checkIndex: (rect: Rect) => {
          if (sizes.length === 0) return 0;
          const relRect = pageToRelative(rect, container!);
          const height = Math.max(
            container != null ? elemClientRect(container).height : 0,
            minHeight,
          );
          const calc = calcIndex(
            relRect.x,
            relRect.y,
            margin,
            width(),
            height,
            itemWidth,
            itemHeight,
          );
          if (calc == null) return undefined;
          return clamp(calc, 0, sizes.length);
        },
      };
    },
  };
}

const HorizonalDirection = {
  primary: (size: Size) => size.width,
  secondary: (size: Size) => size.height,
  pos: (sum: number) => ({ x: sum, y: 0 }),
  apply: (container: HTMLElement, primary: number, secondary: number) => {
    container.style.width = primary === 0 ? "" : `${primary}px`;
    container.style.height = secondary === 0 ? "" : `${secondary}px`;
  },
};

const VerticalDirection = {
  primary: (size: Size) => size.height,
  secondary: (size: Size) => size.width,
  pos: (sum: number) => ({ x: 0, y: sum }),
  apply: (container: HTMLElement, primary: number, secondary: number) => {
    container.style.width = secondary === 0 ? "" : `${secondary}px`;
    container.style.height = primary === 0 ? "" : `${primary}px`;
  },
};

type LinearLayoutDirection =
  | typeof HorizonalDirection
  | typeof VerticalDirection;

function linearLayout(direction: LinearLayoutDirection): Layouter {
  let container: HTMLElement | undefined;

  return {
    mount: (elem) => {
      container = elem;
    },
    unmount: () => {
      container = undefined;
    },
    layout: (sizes) => {
      const positions: Array<Position> = [];
      let sum = 0;
      for (const size of sizes) {
        positions.push(direction.pos(sum));
        sum += direction.primary(size);
      }

      const primary = sizes
        .map(direction.primary)
        .reduce((sum, value) => sum + value, 0);
      const secondary = Math.max(0, ...sizes.map(direction.secondary));

      const rects = zip(sizes, positions).map(([size, pos]) => ({
        ...size,
        ...pos,
      }));

      if (container != null) {
        direction.apply(container, primary, secondary);
      }

      return {
        pos: (idx) => {
          const ret = positions[idx];
          if (ret == null) {
            console.error(`failed to load position at index ${idx}`);
            return { x: 0, y: 0 };
          }
          return ret;
        },
        checkIndex: (rect: Rect) => {
          if (sizes.length === 0) return 0;
          const relRect = pageToRelative(rect, container!);
          const rectArea = area(rect);
          for (const [idx, itemRect] of rects.entries()) {
            if (intersects(relRect, itemRect)) {
              const itemArea = area(itemRect);
              const intersectArea = area(intersection(relRect, itemRect)!);
              if (
                intersectArea >= itemArea / 2 ||
                intersectArea >= rectArea / 2
              ) {
                return idx;
              }
            }
          }
          return undefined;
        },
      };
    },
  };
}

export function horizontalLayout() {
  return linearLayout(HorizonalDirection);
}

export function verticalLayout() {
  return linearLayout(VerticalDirection);
}
