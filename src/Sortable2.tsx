import {
  Accessor,
  For,
  JSX,
  children,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  useContext,
} from "solid-js";

import {
  SortableAnimationController,
  createSortableAnimationController,
} from "./animation";
import { TimingFunction } from "./ease";
import {
  Position,
  Rect,
  Size,
  area,
  clientToPage,
  clientToRelative,
  dist,
  elemClientRect,
  elemPageRect,
  intersection,
  intersects,
  pageToRelative,
  toSize,
} from "./geom";
import { mapZeroOneToZeroInf, normalize } from "./util";

function addGlobalCursorGrabbingStyle(): () => void {
  const cursorStyle = document.createElement("style");
  cursorStyle.innerHTML = "*{cursor: grabbing!important;}";
  document.head.appendChild(cursorStyle);
  return () => document.head.removeChild(cursorStyle);
}

interface SortableRef<T> {
  readonly ref: HTMLElement;
  readonly props: SortableProps<T>;
  readonly dragHandler: DragHandler<T>;
}

interface DragHandler<T> {
  readonly move: (state: any) => void;
}

// interface DragHandler<T> {
//   readonly mouseDown: Accessor<T | undefined>;
//   readonly startDrag: (
//     item: T,
//     idx: Accessor<number>,
//     itemElem: HTMLElement,
//     source: SortableRef<T>,
//     sourceElem: HTMLElement,
//     e: MouseEvent,
//     anim: Accessor<SortableAnimationController | undefined>,
//     clickProps: Accessor<ClickProps>,
//     autoscroll: Accessor<HTMLElement | undefined>,
//   ) => void;
//   readonly continueDrag: (
//     item: T,
//     idx: Accessor<number>,
//     itemElem: HTMLElement,
//     source: SortableRef<T>,
//     sourceElem: HTMLElement,
//     anim: Accessor<SortableAnimationController | undefined>,
//     clickProps: Accessor<ClickProps>,
//     autoscroll: Accessor<HTMLElement | undefined>,
//   ) => void;
//   readonly endDrag: () => void;
// }

interface DragState<T> {
  item: T;
  itemElem: HTMLElement;
  startItemElem: HTMLElement;
  startSize: Size;
  source: SortableRef<T>;
  sourceElem: HTMLElement;
  startSource: SortableRef<T>;
  startSourceElem: HTMLElement;

  anim: Accessor<SortableAnimationController | undefined>;
  x: number | undefined;
  y: number | undefined;

  mouseDownTime: number;
  mouseMoveDist: number;
  mouseMove: Position; // client coords
  mouseMovePrev: Position; // page coords
  mouseDownPos: Position; // relative coords

  idx: Accessor<number>;
  startIdx: number;

  clickProps: Accessor<ClickProps>;

  autoscroll: Accessor<HTMLElement | undefined>;

  dragStarted: boolean;
  scrollIntervalId?: ReturnType<typeof setInterval>;
}

function createDragHandler<T>(sortables?: Set<SortableRef<T>>): DragHandler<T> {
  const [mouseDown, setMouseDown] = createSignal<T>();

  let curState: DragState<T> | undefined;

  function updateMouseData(e: MouseEvent) {
    const state = curState!;
    state.mouseMove = { x: e.x, y: e.y };
    updateMouseMoveDist();
    state.mouseMovePrev = clientToPage(state.mouseMove);
  }

  function isClick() {
    const state = curState!;
    const elapsed = Date.now() - state.mouseDownTime;
    const tmpClickProps = state.clickProps();
    const clickDurMs = tmpClickProps.clickDurationMs ?? 100;
    const clickDistPx = tmpClickProps.clickDistancePx ?? 8;
    // TODO: also check and make sure index has not changed
    return elapsed < clickDurMs || state.mouseMoveDist < clickDistPx;
  }

  function updateMouseMoveDist() {
    const state = curState!;
    state.mouseMoveDist += dist(
      clientToPage(state.mouseMove),
      state.mouseMovePrev,
    );
  }

  function updateItemElemPosition() {
    const state = curState!;
    state.itemElem.style.transform = "";
    const pos = clientToRelative(state.mouseMove, state.itemElem);
    const x = pos.x - state.mouseDownPos.x;
    const y = pos.y - state.mouseDownPos.y;
    const pos2 = clientToRelative(state.mouseMove, state.sourceElem);
    state.x = pos2.x - state.mouseDownPos.x;
    state.y = pos2.y - state.mouseDownPos.y;
    state.itemElem.style.transform = `translate(${x}px, ${y}px)`;
  }

  function clearAutoscroll() {
    const state = curState!;
    if (state.scrollIntervalId != null) {
      clearInterval(state.scrollIntervalId);
      state.scrollIntervalId = undefined;
    }
  }

  function updateAutoscroll() {
    clearAutoscroll();

    const state = curState!;
    const elem = state.autoscroll();

    if (elem == null) return;

    const rect = intersection(elemClientRect(elem), {
      x: 0,
      y: 0,
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    });

    if (rect == null) return;

    const scrollBy = { x: 0, y: 0 };
    const pos = state.mouseMove;
    const xStripWidth = Math.round((rect.width / 2) * 0.5);
    const yStripWidth = Math.round((rect.height / 2) * 0.5);

    const mult = 2.5;

    if (pos.x <= rect.x + xStripWidth) {
      const min = rect.x;
      const max = rect.x + xStripWidth;
      scrollBy.x = -Math.min(
        rect.width,
        1 + mult * mapZeroOneToZeroInf(1 - normalize(pos.x, min, max)),
      );
    } else if (pos.x >= rect.x + rect.width - xStripWidth) {
      const min = rect.x + rect.width - xStripWidth;
      const max = rect.x + rect.width;
      scrollBy.x = Math.min(
        rect.width,
        1 + mult * mapZeroOneToZeroInf(normalize(pos.x, min, max)),
      );
    }

    if (pos.y <= rect.y + yStripWidth) {
      const min = rect.y;
      const max = rect.y + yStripWidth;
      scrollBy.y = -Math.min(
        rect.height,
        1 + mult * mapZeroOneToZeroInf(1 - normalize(pos.y, min, max)),
      );
    } else if (pos.y >= rect.y + rect.height - yStripWidth) {
      const min = rect.y + rect.height - yStripWidth;
      const max = rect.y + rect.height;
      scrollBy.y = Math.min(
        rect.height,
        1 + mult * mapZeroOneToZeroInf(normalize(pos.y, min, max)),
      );
    }

    if (scrollBy.x != 0 || scrollBy.y != 0) {
      state.scrollIntervalId = setInterval(
        () => elem.scrollBy(scrollBy.x, scrollBy.y),
        1,
      );
    }
  }

  function maybeTriggerMove() {
    const state = curState!;
    const rect = elemPageRect(state.itemElem);

    if (intersects(rect, elemPageRect(state.sourceElem))) {
      const indexCheck = state.source.props.checkIndex?.(
        pageToRelative(rect, state.sourceElem),
        state.idx(),
      );
      if (
        indexCheck != null &&
        state.idx() !== Math.min(state.source.props.each.length, indexCheck)
      ) {
        state.source.props.onMove?.(state.item, state.idx(), indexCheck);
      }
      return;
    }

    // check and trigger move to another sortable
    if (sortables != null) {
      for (const sortable of sortables) {
        if (
          sortable === state.source ||
          !intersects(rect, elemPageRect(sortable.ref)) ||
          !(sortable.props.insertFilter?.(state.item) ?? true)
        ) {
          continue;
        }

        const indexCheck = sortable.checkIndex?.(rect, state.idx());
        if (indexCheck != null) {
          state.source.props.onRemove?.(state.item, state.idx());
          sortable.props.onInsert?.(state.item, indexCheck);
          return;
        }
      }
    }
  }

  const onMouseUp = (e: MouseEvent) => {
    clearAutoscroll();
    removeListeners();

    const state = curState!;

    try {
      if (e.button == 0 && isClick()) {
        state.source.props.onClick?.(state.item, state.idx(), e);
      } else if (state.startSource == state.source) {
        state.source.props.onDragEnd?.(state.item, state.startIdx, state.idx());
      } else {
        state.startSource.props.onDragEnd?.(
          state.item,
          state.startIdx,
          undefined,
        );
        state.source.props.onDragEnd?.(state.item, undefined, state.idx());
      }
    } finally {
      const anim = state.anim();
      if (anim != null) {
        state.anim()?.enable({ x: state.x!, y: state.y! });
      } else {
        state.itemElem.style.transform = "";
      }
      setMouseDown(undefined);
    }
  };

  const onMouseMove = (e: MouseEvent) => {
    const state = curState!;

    updateMouseData(e);
    updateItemElemPosition();
    updateAutoscroll();
    maybeTriggerMove();
    updateItemElemPosition();

    if (!isClick() && !state.dragStarted) {
      state.dragStarted = true;
      state.startSource.props.onDragStart?.(state.item, state.startIdx);
    }
  };

  const onScroll = () => {
    updateMouseMoveDist();
    updateItemElemPosition();
    maybeTriggerMove();
  };

  function addListeners() {
    window.addEventListener("mouseup", onMouseUp, true);
    window.addEventListener("mousemove", onMouseMove, true);
    window.addEventListener("scroll", onScroll, true);
  }

  function removeListeners() {
    window.removeEventListener("mouseup", onMouseUp, true);
    window.removeEventListener("mousemove", onMouseMove, true);
    window.removeEventListener("scroll", onScroll, true);
  }

  return {
    mouseDown,
    startDrag: (
      item,
      idx,
      itemElem,
      source,
      sourceElem,
      e,
      anim,
      clickProps,
      autoscroll,
    ) => {
      const mouseMove = { x: e.x, y: e.y };

      curState = {
        mouseDownTime: Date.now(),
        mouseMoveDist: 0,
        mouseMove,
        mouseMovePrev: mouseMove,
        mouseDownPos: clientToRelative(mouseMove, itemElem),

        anim,
        x: undefined,
        y: undefined,

        item,
        itemElem,
        startItemElem: itemElem,
        startSize: toSize(elemClientRect(itemElem)),
        source,
        sourceElem,
        startSource: source,
        startSourceElem: sourceElem,

        idx,
        startIdx: idx(),

        clickProps,
        autoscroll,

        dragStarted: false,
      };

      updateItemElemPosition();
      addListeners();
      setMouseDown(item); // solid setters don't work well with generics
    },
    continueDrag: (
      item,
      idx,
      itemElem,
      source,
      sourceElem,
      anim,
      clickProps,
      autoscroll,
    ) => {
      const state = curState!;
      state.item = item;
      state.idx = idx;
      state.itemElem = itemElem;
      state.source = source;
      state.sourceElem = sourceElem;
      state.clickProps = clickProps;
      state.autoscroll = autoscroll;
      state.anim = anim;

      const newSize = toSize(elemClientRect(itemElem));
      state.mouseDownPos = {
        x: state.mouseDownPos.x * (newSize.width / state.startSize.width),
        y: state.mouseDownPos.y * (newSize.height / state.startSize.height),
      };

      state.startSize = newSize;

      updateItemElemPosition();
    },
    endDrag: () => {},
  };
}

interface SortableContextValue<T> {
  readonly addSortable: (sortable: SortableRef<T>) => void;
  readonly removeSortable: (sortable: SortableRef<T>) => void;
  readonly dragHandler: DragHandler<T>;
}

export type SortableSet<T> = Set<SortableRef<T>>;

interface SortableItemProps<T> {
  readonly item: T;
  readonly idx: Accessor<number>;
  readonly isMouseDown: Accessor<boolean>;
}

export function createSortableItemContext<T>() {
  return createContext<SortableItemProps<T> | undefined>();
}

const SortableDirectiveContext = createContext<Set<HTMLElement>>();

/**
 * directive that can be used by adding attribute use:sortableHandle to JSX element
 */
export function sortableHandle(el: Element, _accessor: () => any) {
  const handleRefs = useContext(SortableDirectiveContext);
  if (handleRefs == null) {
    console.error("sortable handle context could not be found");
  } else if (!(el instanceof HTMLElement)) {
    console.error("sortableHandle directive used on invalid element type");
  } else {
    el.style.cursor = "grab";
    handleRefs.add(el);
    onCleanup(() => handleRefs.delete(el));
  }
}

export type CheckIndex = (
  layout: ReadonlyArray<Rect | undefined>,
  test: Rect,
  index: number,
) => number | undefined;

export function defaultIndexCheck(threshold: number): CheckIndex {
  return (layout, test, index) => {
    const testArea = area(test);
    let max = 0;
    let maxIdx = undefined;

    for (const [idx, rect] of layout.entries()) {
      if (index == idx || rect == null) {
        continue;
      }

      const i = intersection(rect, test);

      if (i == null) {
        continue;
      }
      const cover = area(i) / Math.min(area(rect), testArea);

      if (cover > threshold && cover > max) {
        max = cover;
        maxIdx = idx;
      }
    }

    return maxIdx;
  };
}

export type SortableGroup<T> = Set<SortableRef<T>>;

export function createSortableGroup<T>(): SortableGroup<T> {
  return new Set();
}

interface SortableHooks<T> {
  readonly onClick?: (item: T, idx: number, e: MouseEvent) => void;
  readonly onDragStart?: (item: T, idx: number) => void;
  readonly onDragEnd?: (
    item: T,
    startIdx: number | undefined,
    endIdx: number | undefined,
  ) => void;
  readonly onMove?: (item: T, fromIdx: number, toIdx: number) => void;
  readonly onRemove?: (item: T, idx: number) => void;
  readonly onInsert?: (item: T, idx: number) => void;
}

interface ClickProps {
  readonly clickDurationMs?: number;
  readonly clickDistancePx?: number;
}

interface SortableProps<T> extends SortableHooks<T>, ClickProps {
  readonly group?: SortableGroup<T>;

  readonly each: ReadonlyArray<T>;

  readonly insertFilter?: (item: T) => boolean;

  readonly autoscroll?: boolean | HTMLElement;
  readonly autoscrollBorderWidth?: number;

  readonly animated?: boolean;
  readonly timingFunction?: TimingFunction;
  readonly animationDurationMs?: number;

  readonly checkIndex?: CheckIndex;

  readonly mouseDownClass?: string;
}

export function Sortable2<T, U extends JSX.Element>(
  props: SortableProps<T> & {
    readonly children: (props: SortableItemProps<T>) => U;
  },
) {
  let containerChildRef!: HTMLDivElement;
  let sortableRef!: SortableRef<T>;

  const dragHandler = createDragHandler();

  const animationControllers: SortableAnimationController[] = [];
  const itemRefs: HTMLElement[] = [];

  onMount(() => {
    if (containerChildRef.parentElement == null) {
      console.error("sortable must have parent element");
      return;
    }

    sortableRef = {
      ref: containerChildRef.parentElement,
      props: props,
    };

    createEffect(() => {
      const group = props.group;
      group?.add(sortableRef);
      onCleanup(() => group?.delete(sortableRef));
    });
  });

  return (
    <>
      <div ref={containerChildRef} style={{ display: "none" }} />
      <For each={props.each}>
        {(item, idx) => {
          const handleRefs = new Set<HTMLElement>();

          const isMouseDown = createMemo(
            on(
              dragHandler.mouseDown,
              (dragging) => dragging != null && item === dragging,
            ),
          );

          const resolved = children(() => (
            <SortableDirectiveContext.Provider value={handleRefs}>
              {props.children({
                item,
                idx,
                isMouseDown,
              })}
            </SortableDirectiveContext.Provider>
          ));

          const itemRef = createMemo(
            on(
              () => resolved.toArray(),
              (arr) => {
                if (arr[0] instanceof HTMLElement) {
                  return arr[0];
                } else {
                  throw Error(
                    `sortable child at index ${idx()} did not resolve to a DOM node`,
                  );
                }
              },
            ),
          );
          createEffect(() => (itemRef().style.cursor = "pointer"));
          createEffect(() => (itemRefs[idx()] = itemRef()));

          onMount(() => {
            const sortable = sortableRef;
            const containerElem = containerChildRef.parentElement!;

            let animationController: SortableAnimationController | undefined;

            createEffect(() => {
              if (props.animated ?? false) {
                const controller = createSortableAnimationController(
                  itemRef(),
                  () => props.timingFunction,
                  () => props.animationDurationMs,
                );
                onCleanup(controller.cleanup);
                animationController = controller;

                createEffect(() => {
                  const i = idx();
                  animationControllers[i] = controller;
                });
              }
            });

            const autoscroll = createMemo(() =>
              props.autoscroll === true
                ? containerElem
                : props.autoscroll === false
                  ? undefined
                  : props.autoscroll,
            );

            createEffect(() => {
              const cls = props.mouseDownClass;
              if (cls != null && isMouseDown()) {
                itemRef().classList.add(cls);
                onCleanup(() => itemRef().classList.remove(cls));
              }
            });

            if (item === dragHandler.mouseDown()) {
              dragHandler.continueDrag(
                item,
                idx,
                itemElem,
                sortable,
                containerElem,
                () => animationController,
                clickProps,
                autoscroll,
              );
              animationController?.disable();
            }
            const mouseDownListener = (e: MouseEvent) => {
              if (e.button != 0) {
                return;
              }
              dragHandler.startDrag(
                item,
                idx,
                itemElem,
                sortable,
                containerElem,
                e,
                () => animationController,
                clickProps,
                autoscroll,
              );
              animationController?.disable();
            };

            for (const handleElem of handleElems) {
              handleElem.addEventListener("mousedown", mouseDownListener);
            }
            onCleanup(() => {
              for (const handleElem of handleElems) {
                handleElem.removeEventListener("mousedown", mouseDownListener);
              }
            });
          });

          return <>{resolved()}</>;
        }}
      </For>
    </>
  );
}
