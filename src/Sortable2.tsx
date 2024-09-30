import {
  Accessor,
  For,
  JSX,
  Setter,
  children,
  createContext,
  createEffect,
  createMemo,
  createSelector,
  createSignal,
  getOwner,
  on,
  onCleanup,
  onMount,
  runWithOwner,
  untrack,
  useContext,
} from "solid-js";

import {
  SortableAnimationController,
  createSortableAnimationController,
} from "./animation";
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
  elemParentRelativeRect,
  intersection,
  intersects,
  toSize,
} from "./geom";
import { TimingFunction } from "./timing";
import {
  SetSignal,
  createSetSignal,
  mapZeroOneToZeroInf,
  normalize,
} from "./util";

function calculateRelativePercentPos(e: MouseEvent): Position {
  const target = e.currentTarget as HTMLElement;
  const clientRect = elemClientRect(target);
  const relativeMousePos = clientToRelative({ x: e.x, y: e.y }, target);
  return {
    x: relativeMousePos.x / clientRect.width,
    y: relativeMousePos.y / clientRect.height,
  };
}

function handleDrag<T>(
  initialMouseEvent: MouseEvent,
  sortable: SortableRef<T>,
  group: Set<SortableRef<T>> | undefined,
  dragState: DragState<T>,
  item: T,
) {
  const relativeMouseDownPercentPos =
    calculateRelativePercentPos(initialMouseEvent);
  console.log(relativeMouseDownPercentPos);

  createEffect(() => {
    const itemDraggingState = dragState.draggingItemState();
    if (itemDraggingState == null) {
      return;
    }

    const itemRef = itemDraggingState.ref();
    if (itemRef == null) {
      return;
    }

    let relativePosition: Position | undefined;

    if (itemDraggingState.animationController != null) {
      const controller = itemDraggingState.animationController;
      controller.disable();
      onCleanup(() => {
        controller.enable(relativePosition);
      });
    }

    const mouseMoveListener = (e: MouseEvent) => {
      const mousePosition = clientToRelative(
        { x: e.clientX, y: e.clientY },
        sortable.parent,
      );

      itemRef.style.transform = "";

      const layoutRect = elemParentRelativeRect(itemRef);

      relativePosition = {
        x: mousePosition.x - relativeMouseDownPercentPos.x * layoutRect.width,
        y: mousePosition.y - relativeMouseDownPercentPos.y * layoutRect.height,
      };

      const layoutRelativePosition = {
        x: relativePosition.x - layoutRect.x,
        y: relativePosition.y - layoutRect.y,
      };

      itemRef.style.transform = `translate(${layoutRelativePosition.x}px, ${layoutRelativePosition.y}px)`;
    };

    const dragEndListener = () => {
      dragState.setDragging(undefined);
      dragState.setDraggingItemState(undefined);
    };

    document.addEventListener("mousemove", mouseMoveListener);
    document.addEventListener("mouseup", dragEndListener);
    onCleanup(() => {
      document.removeEventListener("mousemove", mouseMoveListener);
      document.removeEventListener("mouseup", dragEndListener);
    });
  });
}

function addGlobalCursorGrabbingStyle(): () => void {
  const cursorStyle = document.createElement("style");
  cursorStyle.innerHTML = "*{cursor: grabbing!important;}";
  document.head.appendChild(cursorStyle);
  return () => document.head.removeChild(cursorStyle);
}

interface SortableRef<T> {
  readonly parent: HTMLElement;
  readonly props: SortableProps<T>;
  readonly itemStates: Map<T, ItemState>;
}

interface DragHandler<T> {
  readonly mouseDown: Accessor<T | undefined>;
  readonly startDrag: (
    item: T,
    idx: Accessor<number>,
    itemElem: HTMLElement,
    source: SortableRef<T>,
    sourceElem: HTMLElement,
    e: MouseEvent,
    anim: Accessor<SortableAnimationController | undefined>,
    clickProps: Accessor<ClickProps>,
    autoscroll: Accessor<HTMLElement | undefined>,
  ) => void;
  readonly continueDrag: (
    item: T,
    idx: Accessor<number>,
    itemElem: HTMLElement,
    source: SortableRef<T>,
    sourceElem: HTMLElement,
    anim: Accessor<SortableAnimationController | undefined>,
    clickProps: Accessor<ClickProps>,
    autoscroll: Accessor<HTMLElement | undefined>,
  ) => void;
}

interface OldDragState<T> {
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

  let curState: OldDragState<T> | undefined;

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
      const indexCheck = 0; // TODO
      // const indexCheck = state.source.props.checkIndex?.(
      //   pageToRelative(rect, state.sourceElem),
      //   state.idx(),
      // );
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
          !intersects(rect, elemPageRect(sortable.parent)) ||
          !(sortable.props.shouldInsert?.(state.item) ?? true)
        ) {
          continue;
        }

        const indexCheck = 0; // TODO
        // const indexCheck = sortable.props.checkIndex?.(rect, state.idx());
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
      // setMouseDown(item); // solid setters don't work well with generics
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

const SortableDirectiveContext = createContext<SetSignal<HTMLElement>>();

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
    handleRefs.mutate((set) => set.add(el));
    onCleanup(() => handleRefs.mutate((set) => set.delete(el)));
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

interface DragState<T> {
  readonly dragging: Accessor<T | undefined>;
  readonly setDragging: (value: T | undefined) => void;
  readonly draggingItemState: Accessor<ItemState | undefined>;
  readonly setDraggingItemState: Setter<ItemState | undefined>;
}

function createDragState<T>(): DragState<T> {
  const [dragging, setDragging] = createSignal<T>();
  const [draggingItemState, setDraggingItemState] = createSignal<ItemState>();
  return {
    dragging,
    setDragging,
    draggingItemState,
    setDraggingItemState,
  };
}

export interface SortableGroup<T> {
  readonly sortables: Set<SortableRef<T>>;
  readonly dragState: DragState<T>;
}

export function createSortableGroup<T>(): SortableGroup<T> {
  return {
    sortables: new Set(),
    dragState: createDragState<T>(),
  };
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
  readonly each: ReadonlyArray<T>;

  readonly group?: SortableGroup<T>;

  readonly shouldInsert?: (item: T) => boolean;

  readonly autoscroll?: boolean | HTMLElement;
  readonly autoscrollBorderWidth?: number;

  readonly animated?: boolean;
  readonly timingFunction?: TimingFunction;
  readonly animationDurationMs?: number;

  readonly checkIndex?: CheckIndex;

  readonly mouseDownClass?: string;
}

interface ItemState {
  readonly idx: Accessor<number>;
  readonly ref: Accessor<HTMLElement>;
  animationController?: SortableAnimationController;
}

export function Sortable2<T, U extends JSX.Element>(
  props: SortableProps<T> & {
    readonly children: (props: SortableItemProps<T>) => U;
  },
) {
  let childRef!: HTMLDivElement;
  let parentRef!: HTMLElement;
  let sortableRef!: SortableRef<T>;

  const itemStates = new Map<T, ItemState>();

  const dragState = createMemo(
    () => props.group?.dragState ?? createDragState<T>(),
  );

  const isMouseDownSelector = createSelector(
    () => dragState().dragging(),
    (item, dragging) => item === dragging,
  );

  onMount(() => {
    if (childRef.parentElement == null) {
      console.error("sortable must have parent element");
      return;
    } else {
      parentRef = childRef.parentElement;
    }

    sortableRef = {
      parent: parentRef,
      props,
      itemStates,
    };

    createEffect(() => {
      const group = props.group;
      group?.sortables.add(sortableRef);
      onCleanup(() => group?.sortables.delete(sortableRef));
    });
  });

  const owner = getOwner();

  return (
    <>
      <div ref={childRef} style={{ display: "none" }} />
      <For each={props.each}>
        {(item, idx) => {
          const isMouseDown = createMemo(() => isMouseDownSelector(item));

          const handleRefs = createSetSignal<HTMLElement>();

          const resolved = children(() => (
            <SortableDirectiveContext.Provider value={handleRefs}>
              {props.children({
                item,
                idx,
                isMouseDown,
              })}
            </SortableDirectiveContext.Provider>
          ));

          const ref = createMemo(
            on(
              () => resolved.toArray(),
              (arr) => {
                if (arr[0] instanceof HTMLElement) {
                  return arr[0];
                } else {
                  throw Error(
                    `sortable child at index ${untrack(
                      idx,
                    )} did not resolve to a DOM node`,
                  );
                }
              },
            ),
          );

          const state: ItemState = {
            idx,
            ref,
          };
          itemStates.set(item, state);
          onCleanup(() => itemStates.delete(item));

          createEffect(() => {
            if (isMouseDown()) {
              dragState().setDraggingItemState(state);
            }
          });

          onMount(() => {
            createEffect(() => {
              if (props.animated ?? false) {
                const controller = createSortableAnimationController(
                  ref(),
                  () => props.timingFunction,
                  () => props.animationDurationMs,
                );
                state.animationController = controller;
                onCleanup(() => {
                  state.animationController = undefined;
                  controller.cleanup();
                });
              }
            });

            createEffect(() => {
              const cls = props.mouseDownClass;
              if (cls != null && isMouseDown()) {
                ref().classList.add(cls);
                onCleanup(() => ref().classList.remove(cls));
              }
            });
          });

          const mouseDownListener = (e: MouseEvent) => {
            dragState().setDraggingItemState(state);
            runWithOwner(owner, () =>
              handleDrag(
                e,
                sortableRef,
                props.group?.sortables,
                dragState(),
                item,
              ),
            );
          };

          createEffect(() => {
            const hs = handleRefs.get();
            const listenables = hs.size > 0 ? [...hs] : [ref()];
            for (const listenable of listenables) {
              listenable.addEventListener("mousedown", mouseDownListener);
            }
            onCleanup(() => {
              for (const listenable of listenables) {
                listenable.removeEventListener("mousedown", mouseDownListener);
              }
            });
          });

          return <>{resolved()}</>;
        }}
      </For>
    </>
  );
}
