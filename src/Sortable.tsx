import {
  Accessor,
  Context,
  For,
  JSX,
  Show,
  children,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  untrack,
  useContext,
} from "solid-js";

import {
  Position,
  Rect,
  Size,
  clientToPage,
  clientToRelative,
  dist,
  elemClientRect,
  elemPageRect,
  intersection,
  intersects,
  toSize,
} from "./geom";
import { Layouter } from "./layout";
import { mapZeroOneToZeroInf, normalize } from "./util";

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

function createSortableHooksDispatcher<T>(
  source: SortableHooks<T>,
): SortableHooks<T> {
  return {
    onClick: (item, idx, e) => source.onClick?.(item, idx, e),
    onDragStart: (item, idx) => source.onDragStart?.(item, idx),
    onDragEnd: (item, startIdx, endIdx) =>
      source.onDragEnd?.(item, startIdx, endIdx),
    onMove: (item, fromIdx, toIdx) => source.onMove?.(item, fromIdx, toIdx),
    onRemove: (item, idx) => source.onRemove?.(item, idx),
    onInsert: (item, idx) => source.onInsert?.(item, idx),
  };
}

interface ClickProps {
  readonly clickDurMs?: number;
  readonly clickDistPx?: number;
}

interface SortableRef<T> {
  readonly ref: HTMLDivElement;
  readonly checkIndex?: (rect: Rect) => number | undefined;
  readonly hooks: SortableHooks<T>;
  readonly len: Accessor<number>;
  readonly insertFilter: Accessor<(item: T) => boolean>;
}

interface DragHandler<T> {
  readonly mouseDown: Accessor<T | undefined>;
  readonly startDrag: (
    item: T,
    idx: Accessor<number>,
    itemElem: HTMLElement,
    source: SortableRef<T>,
    sourceElem: HTMLDivElement,
    e: MouseEvent,
    clickProps: Accessor<ClickProps>,
    autoscroll: Accessor<HTMLElement | undefined>,
  ) => void;
  readonly continueDrag: (
    item: T,
    idx: Accessor<number>,
    itemElem: HTMLElement,
    source: SortableRef<T>,
    sourceElem: HTMLDivElement,
    clickProps: Accessor<ClickProps>,
    autoscroll: Accessor<HTMLElement | undefined>,
  ) => void;
  readonly endDrag: () => void;
}

interface DragState<T> {
  item: T;
  itemElem: HTMLElement;
  startItemElem: HTMLElement;
  startSize: Size;
  source: SortableRef<T>;
  sourceElem: HTMLDivElement;
  startSource: SortableRef<T>;
  startSourceElem: HTMLDivElement;

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
    const clickDurMs = tmpClickProps.clickDurMs ?? 100;
    const clickDistPx = tmpClickProps.clickDistPx ?? 8;
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
    const pos = clientToRelative(state.mouseMove, state.sourceElem);
    const x = pos.x - state.mouseDownPos.x;
    const y = pos.y - state.mouseDownPos.y;
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
      const indexCheck = state.source.checkIndex?.(rect);
      if (
        indexCheck != null &&
        state.idx() !== Math.min(state.source.len(), indexCheck)
      ) {
        state.source.hooks.onMove?.(state.item, state.idx(), indexCheck);
      }
      return;
    }

    // check and trigger move to another sortable
    if (sortables != null) {
      for (const sortable of sortables) {
        if (
          sortable === state.source ||
          !intersects(rect, elemPageRect(sortable.ref)) ||
          !sortable.insertFilter()(state.item)
        ) {
          continue;
        }

        const indexCheck = sortable.checkIndex?.(rect);
        if (indexCheck != null) {
          state.source.hooks.onRemove?.(state.item, state.idx());
          sortable.hooks.onInsert?.(state.item, indexCheck);
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
        state.source.hooks.onClick?.(state.item, state.idx(), e);
      } else if (state.startSource == state.source) {
        state.source.hooks.onDragEnd?.(state.item, state.startIdx, state.idx());
      } else {
        state.startSource.hooks.onDragEnd?.(
          state.item,
          state.startIdx,
          undefined,
        );
        state.source.hooks.onDragEnd?.(state.item, undefined, state.idx());
      }
    } finally {
      setMouseDown(undefined);
    }
  };

  const onMouseMove = (e: MouseEvent) => {
    const state = curState!;

    updateMouseData(e);
    updateItemElemPosition();
    updateAutoscroll();
    maybeTriggerMove();

    if (!isClick() && !state.dragStarted) {
      state.dragStarted = true;
      state.startSource.hooks.onDragStart?.(state.item, state.startIdx);
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
      setMouseDown(item as any); // solid setters don't work well with generics
    },
    continueDrag: (
      item,
      idx,
      itemElem,
      source,
      sourceElem,
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

type SortableContext<T> = Context<SortableContextValue<T>>;

export function createSortableContext<T>(): SortableContext<T> {
  return createContext<SortableContextValue<T>>({} as SortableContextValue<T>);
}

export function createSortableContextValue<T>(): SortableContextValue<T> {
  const sortables = new Set<SortableRef<T>>();
  return {
    addSortable: (ref: SortableRef<T>) => {
      sortables.add(ref);
    },
    removeSortable: (ref: SortableRef<T>) => {
      sortables.delete(ref);
    },
    dragHandler: createDragHandler(sortables),
  };
}

interface SortableItemProps<T> {
  readonly item: T;
  readonly idx: Accessor<number>;
  readonly isMouseDown: Accessor<boolean>;
}

type SortableItemContext<T> = Context<SortableItemProps<T>>;

export function createSortableItemContext<T>(): SortableItemContext<T> {
  return createContext<SortableItemProps<T>>({} as SortableItemProps<T>);
}

interface SortableDirectiveContextValue {
  readonly setHandle?: (el: HTMLElement) => void;
}

const SortableDirectiveContext = createContext<SortableDirectiveContextValue>(
  {},
);

function sizesEqual(
  sizes1: ReadonlyArray<Size>,
  sizes2: ReadonlyArray<Size>,
): boolean {
  if (sizes1.length != sizes2.length) return false;

  for (let i = 0; i < sizes1.length; i++) {
    const size1 = sizes1[i]!;
    const size2 = sizes2[i]!;
    if (size1.width != size2.width || size1.height != size2.height)
      return false;
  }

  return true;
}

export function sortableHandle(el: Element, _accessor: () => any) {
  const directives = useContext(SortableDirectiveContext);
  if (el instanceof HTMLElement && directives.setHandle) {
    directives.setHandle(el);
  }
}

interface SortableProps<T, U extends JSX.Element>
  extends SortableHooks<T>,
    ClickProps {
  readonly context?: SortableContext<T>; // cannot be changed dynamically

  readonly each: ReadonlyArray<T>;
  readonly layout: Layouter | (() => Layouter);
  readonly children: (props: SortableItemProps<T>) => U;

  readonly fallback?: JSX.Element;

  readonly insertFilter?: (item: T) => boolean;

  readonly autoscroll?: boolean | HTMLElement;
  readonly autoscrollBorderWidth?: number;

  readonly animDurationMs?: number;
  readonly animEasing?: string;
}

export function Sortable<T, U extends JSX.Element>(props: SortableProps<T, U>) {
  const sortableContext = props.context && useContext(props.context);

  let containerRef: HTMLDivElement | undefined;
  let sortableRef: SortableRef<T> | undefined;

  const layouter = createMemo(() =>
    typeof props.layout === "function" ? props.layout() : props.layout,
  );

  createEffect(() => {
    const tmp = layouter();
    tmp.mount?.(containerRef!);
    onCleanup(() => tmp.unmount?.());
  });

  const itemToElem = new Map<T, HTMLElement>();

  const [sizesDepend, sizesTrigger] = createSignal(undefined, {
    equals: false,
  });

  const sizes = createMemo(
    () => {
      sizesDepend();
      return (
        props.each
          .map((item) => itemToElem.get(item))
          .filter((i) => i != null) as HTMLElement[]
      )
        .map(elemClientRect)
        .map(toSize);
    },
    [],
    {
      equals: sizesEqual,
    },
  );
  const layout = createMemo(() => {
    return layouter().layout(sizes());
  });

  const dragHandler: DragHandler<T> =
    sortableContext != null ? sortableContext.dragHandler : createDragHandler();

  onMount(() => {
    sortableRef = {
      ref: containerRef!,
      checkIndex: (rect) => layout().checkIndex?.(rect),
      hooks: createSortableHooksDispatcher(props),
      len: () => props.each.length,
      insertFilter: () => props.insertFilter ?? (() => true),
    };
    if (sortableContext != null) {
      sortableContext.addSortable(sortableRef);
    }
    onCleanup(() => {
      if (sortableContext != null) {
        sortableContext.removeSortable(sortableRef!);
      }
    });
  });

  const resizeObserver = new ResizeObserver(sizesTrigger);

  return (
    <div class="sortable" ref={containerRef} style={{ position: "relative" }}>
      <For each={props.each}>
        {(item, idx) => {
          let itemRef: HTMLElement | undefined;
          const handleRefs: HTMLElement[] = [];

          const isMouseDown = createMemo(
            on(
              dragHandler.mouseDown,
              (dragging) => dragging != null && item === dragging,
            ),
          );

          const resolved = children(() => (
            <SortableDirectiveContext.Provider
              value={{ setHandle: (el) => handleRefs.push(el) }}
            >
              {props.children({
                item,
                idx,
                isMouseDown,
              })}
            </SortableDirectiveContext.Provider>
          ));

          const itemElemRx = createMemo(
            on(
              () => resolved.toArray(),
              (arr) => {
                if (itemRef != null) {
                  return itemRef;
                } else {
                  if (arr.length > 1) {
                    console.warn(
                      "sortable child has more than one top-level html element, this may cause issues",
                    );
                  }
                  if (arr[0] instanceof HTMLElement) {
                    return arr[0];
                  }
                }
              },
            ),
          );

          const handleElemsRx = createMemo(on(resolved, () => handleRefs));

          onMount(() => {
            const sortable = sortableRef!;
            const containerElem = containerRef!;

            const itemElemTest = itemElemRx();
            if (itemElemTest == null) {
              console.error(
                "sortable cannot resolve refence to child html element",
              );
              return;
            }

            const itemElem = itemElemTest;
            const handleElemsTest = handleElemsRx();
            const handleElems =
              handleElemsTest.length > 0 ? handleElemsTest : [itemElem];

            resizeObserver.observe(itemElem);
            onCleanup(() => resizeObserver.unobserve(itemElem));

            function setHandleCursor(cursor: string) {
              for (const handleElem of handleElems) {
                handleElem.style.cursor = cursor;
              }
            }

            const autoscroll = createMemo(() =>
              props.autoscroll === true
                ? containerElem
                : props.autoscroll === false
                  ? undefined
                  : props.autoscroll,
            );

            itemElem.style.visibility = "hidden";
            itemElem.style.position = "absolute";

            function setDefaultCursor() {
              if (props.onClick) {
                setHandleCursor("pointer");
              } else {
                setHandleCursor("grab");
              }
            }

            createEffect(() => {
              if (isMouseDown()) {
                itemElem.classList.add("sortable-mousedown");

                document.body.style.cursor = "grabbing";
                setHandleCursor("grabbing");
              }
              onCleanup(() => {
                itemElem.classList.remove("sortable-mousedown");

                document.body.style.cursor = "unset";
                untrack(setDefaultCursor);
              });
            });

            createEffect(setDefaultCursor);

            // manage html element map used for layouting
            itemToElem.set(item, itemElem);
            sizesTrigger();
            onCleanup(() => {
              itemToElem.delete(item);
              sizesTrigger();
            });

            // reactivley calc position and apply animation effect
            let anim: Animation | undefined;
            const pos = createMemo(() => layout().pos(idx()));
            let shouldInitPosition = true;
            createEffect(() => {
              if (!isMouseDown() && !isNaN(pos().x) && !isNaN(pos().y)) {
                const transform = `translate(${pos().x}px, ${pos().y}px)`;
                if (shouldInitPosition) {
                  // don't use animation when setting initial position
                  itemElem.style.transform = transform;
                  itemElem.style.visibility = "visible";
                  shouldInitPosition = false;
                } else {
                  itemElem.classList.add("sortable-animating");
                  anim = itemElem.animate(
                    {
                      transform: transform,
                    },
                    {
                      duration: props.animDurationMs ?? 250,
                      easing: props.animEasing ?? "ease",
                      fill: "forwards",
                    },
                  );
                  anim.onfinish = () => {
                    itemElem.classList.remove("sortable-animating");
                  };
                }
              }
            });

            const clickProps = () => ({
              clickDurMs: props.clickDurMs,
              clickDistPx: props.clickDistPx,
            });

            if (item === dragHandler.mouseDown()) {
              dragHandler.continueDrag(
                item,
                idx,
                itemElem,
                sortable,
                containerElem,
                clickProps,
                autoscroll,
              );
              shouldInitPosition = false;
              itemElem.style.visibility = "visible";
            }
            const mouseDownListener = (e: MouseEvent) => {
              if (e.button != 0) return;
              dragHandler.startDrag(
                item,
                idx,
                itemElem,
                sortable,
                containerElem,
                e,
                clickProps,
                autoscroll,
              );
              anim?.cancel();
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
      <Show when={props.each.length === 0}>{props.fallback}</Show>
    </div>
  );
}
