import {
  Accessor,
  ChildrenReturn,
  Context,
  For,
  JSX,
  Owner,
  batch,
  children,
  createContext,
  createEffect,
  createMemo,
  createRoot,
  createSelector,
  createSignal,
  getOwner,
  mergeProps,
  on,
  onCleanup,
  onMount,
  runWithOwner,
  splitProps,
  untrack,
  useContext,
} from "solid-js";

import {
  SortableAnimationController,
  createSortableAnimationController,
} from "./animation";
import {
  Position,
  area,
  clientToRelative,
  dist,
  elemClientRect,
  elemParentRelativeRect,
  intersection,
} from "./geom";
import { TimingFunction, linear } from "./timing";
import { SetSignal, createSetSignal } from "./util";

interface SortableRef<T> {
  readonly parent: HTMLElement;
  readonly props: SortableProps<T> & typeof defaultInheritableSortableProps;
  readonly itemEntries: Map<T, ItemEntry>;
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

function calculateRelativePercentPosition(
  e: MouseEvent,
  target: HTMLElement,
): Position {
  const clientRect = elemClientRect(target);
  const relativeMousePos = clientToRelative({ x: e.x, y: e.y }, target);
  return {
    x: relativeMousePos.x / clientRect.width,
    y: relativeMousePos.y / clientRect.height,
  };
}

function handleDrag<T>(
  initialMouseEvent: MouseEvent,
  initialSortable: SortableRef<T>,
  group: SortableGroup<T> | undefined,
  dragState: DragState<T>,
  item: T,
) {
  const [sortable, setSortable] = createSignal<SortableRef<T>>(initialSortable);

  let cleanupGlobalCursorGrabbingStyle: (() => void) | undefined;
  const getItemRef = () => sortable().itemEntries.get(item)!.state.ref();

  const relativeMouseDownPercentPosition = calculateRelativePercentPosition(
    initialMouseEvent,
    getItemRef(),
  );

  const startSortable = sortable;
  const startIdx = sortable().itemEntries.get(item)!.idx();

  let mouseClientPosition: Position = {
    x: initialMouseEvent.x,
    y: initialMouseEvent.y,
  };
  let mouseRelativePosition: Position = clientToRelative(
    mouseClientPosition,
    sortable().parent,
  );
  let mouseMoveDistance: number = 0;
  const initialMouseDownTime = Date.now();
  let cancelClick = false;

  let itemRelativeDragPosition: Position = elemParentRelativeRect(
    sortable().itemEntries.get(item)!.state.ref(),
  );

  let insideSortable = true;

  createEffect(() => (getItemRef().style.zIndex = "1"));
  createEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.length > 0) {
          if (entries[0]?.isIntersecting) {
            insideSortable = true;
          } else {
            insideSortable = false;
          }
        }
      },
      {
        root: sortable().parent,
        threshold: sortable().props.moveThreshhold,
      },
    );
    createEffect(() => {
      const itemRef = getItemRef();
      observer.observe(itemRef);
      onCleanup(() => observer.unobserve(itemRef));
    });
    onCleanup(() => observer.disconnect());
  });

  const updateMouseRelativePosition = () => {
    const newMouseRelativePosition: Position = clientToRelative(
      mouseClientPosition,
      sortable().parent,
    );
    mouseMoveDistance += dist(mouseRelativePosition, newMouseRelativePosition);
    mouseRelativePosition = newMouseRelativePosition;

    if (
      !cancelClick &&
      (mouseMoveDistance > sortable().props.clickThreshholdDistancePx ||
        Date.now() - initialMouseDownTime >
          sortable().props.clickThresholdDurationMs)
    ) {
      cancelClick = true;
      sortable().props.onDragStart?.(startIdx);
      cleanupGlobalCursorGrabbingStyle = addGlobalCursorGrabbingStyle();
    }
  };

  const updateTransform = () => {
    const itemRef = getItemRef();

    itemRef.style.transform = "";

    const layoutRect = elemParentRelativeRect(itemRef);

    itemRelativeDragPosition = {
      x:
        mouseRelativePosition.x -
        relativeMouseDownPercentPosition.x * layoutRect.width,
      y:
        mouseRelativePosition.y -
        relativeMouseDownPercentPosition.y * layoutRect.height,
    };

    const layoutRelativePosition = {
      x: itemRelativeDragPosition.x - layoutRect.x,
      y: itemRelativeDragPosition.y - layoutRect.y,
    };

    itemRef.style.transform = `translate(${layoutRelativePosition.x}px, ${layoutRelativePosition.y}px)`;
  };

  const checkMove = (sortable: SortableRef<T>) => {
    const itemRef = getItemRef();

    const rect = clientToRelative(elemClientRect(itemRef), sortable.parent);

    for (let i = 0; i < sortable.props.each.length; i++) {
      const entryItem = sortable.props.each[i]!;
      if (entryItem == item) {
        continue;
      }

      const entry = sortable.itemEntries.get(entryItem)!;
      const testRect =
        entry.animationController?.layoutParentRelativeRect() ??
        elemParentRelativeRect(entry.state.ref());
      const intersect = intersection(rect, testRect);

      if (intersect != null) {
        const a = area(intersect);
        const percent = Math.max(a / area(rect), a / area(testRect));
        if (percent > sortable.props.moveThreshhold) {
          return i;
        }
      }
    }

    return -1;
  };

  const checkAndRunRemoveInsertHooks = () => {
    if (group == null || group.sortables.size <= 1) {
      return;
    }

    const itemRef = getItemRef();

    const rect = elemClientRect(itemRef);
    let greatestSortable: SortableRef<T> | undefined = undefined;
    let greatestSortableIntersectionArea = 0;

    for (const otherSortable of group.sortables) {
      if (sortable() == otherSortable) {
        continue;
      }

      const currentIntersection = intersection(
        elemClientRect(otherSortable.parent),
        rect,
      );
      const currentIntersectionArea =
        currentIntersection != null ? area(currentIntersection) : 0;

      if (currentIntersectionArea > greatestSortableIntersectionArea) {
        greatestSortable = otherSortable;
        greatestSortableIntersectionArea = currentIntersectionArea;
      }
    }

    if (greatestSortable != null) {
      let idx = checkMove(greatestSortable);
      if (
        idx < 0 &&
        greatestSortableIntersectionArea / area(rect) >
          greatestSortable.props.moveThreshhold
      ) {
        idx = greatestSortable.props.each.length;
      }

      if (idx >= 0) {
        sortable().props.onRemove?.(sortable().itemEntries.get(item)!.idx());
        if (sortable().itemEntries.has(item)) {
          return;
        }

        batch(() => {
          greatestSortable.props.onInsert?.(item, idx);
          if (greatestSortable.props.each.includes(item)) {
            setSortable(greatestSortable);
          } else {
            dragEnd();
            group.itemEntries.get(item)?.dispose();
            group.itemEntries.delete(item);
          }
        });
      }
    }
  };

  const updateTransformAndRunHooks = () => {
    updateTransform();

    if (insideSortable) {
      const idx = checkMove(sortable());
      if (idx >= 0) {
        cancelClick = true;
        sortable().props.onMove?.(sortable().itemEntries.get(item)!.idx(), idx);
        updateTransform();
      }
    } else {
      checkAndRunRemoveInsertHooks();
    }
  };

  const mouseMoveListener = (e: MouseEvent) => {
    mouseClientPosition = { x: e.clientX, y: e.clientY };
    updateMouseRelativePosition();
    updateTransformAndRunHooks();
  };

  const scrollListener = () => {
    updateMouseRelativePosition();
    updateTransformAndRunHooks();
  };

  const mouseUpListener = () => {
    if (sortable().props.onClick != null && !cancelClick) {
      sortable().props.onClick!(startIdx);
    } else if (startSortable == sortable) {
      sortable().props.onDragEnd?.(
        startIdx,
        sortable().itemEntries.get(item)!.idx(),
      );
    } else {
      initialSortable.props.onDragEnd?.(startIdx, undefined);
      sortable().props.onDragEnd?.(
        undefined,
        sortable().itemEntries.get(item)!.idx(),
      );
    }

    dragEnd();
  };

  const dragEnd = () => {
    const controller = sortable().itemEntries.get(item)?.animationController;
    const itemRef = getItemRef();
    if (controller != null) {
      controller
        .start(itemRelativeDragPosition)
        .then(() => (itemRef.style.zIndex = "0"));
    } else {
      itemRef.style.transform = "";
    }

    dragState.setDragging(undefined);
    document.removeEventListener("mousemove", mouseMoveListener);
    document.removeEventListener("scroll", scrollListener);
    document.removeEventListener("mouseup", mouseUpListener);
    cleanupGlobalCursorGrabbingStyle?.();
  };

  document.addEventListener("mousemove", mouseMoveListener);
  document.addEventListener("scroll", scrollListener);
  document.addEventListener("mouseup", mouseUpListener);
}

function addGlobalCursorGrabbingStyle(): () => void {
  const cursorStyle = document.createElement("style");
  cursorStyle.innerHTML = "*{cursor: grabbing!important;}";
  document.head.appendChild(cursorStyle);
  return () => document.head.removeChild(cursorStyle);
}

interface DragState<T> {
  readonly dragging: Accessor<T | undefined>;
  readonly setDragging: (value: T | undefined) => void;
}

function createDragState<T>(): DragState<T> {
  const [dragging, setDragging] = createSignal<T>();
  return {
    dragging,
    setDragging,
  };
}

export interface GroupItemEntry {
  readonly state: ItemState;
  readonly dispose: () => void;
  readonly idx: Accessor<number>;
  readonly setIdx: (value: Accessor<number>) => void;
  readonly isMouseDown: Accessor<boolean>;
  readonly setIsMouseDown: (value: Accessor<boolean>) => void;
}

export interface SortableGroup<T> {
  readonly sortables: Set<SortableRef<T>>;
  readonly dragState: DragState<T>;
  readonly props: InheritableSortableProps;
  readonly owner: Owner | null;
  readonly itemEntries: Map<T, GroupItemEntry>;
  readonly render: (props: SortableItemProps<T>) => GroupItemEntry;
}

function createSortableGroup<T>(
  props: InheritableSortableProps,
  render?: (props: SortableItemProps<T>) => JSX.Element,
): SortableGroup<T> {
  const itemEntries = new Map<T, GroupItemEntry>();

  return {
    sortables: new Set(),
    dragState: createDragState<T>(),
    props,
    owner: getOwner(),
    itemEntries,
    render: ({ item, idx, isMouseDown }) => {
      if (render == null) {
        throw new Error("render function missing");
      }

      const entry = itemEntries.get(item);
      if (entry == null) {
        const createEntry: GroupItemEntry = createRoot((dispose) => {
          const [entryIdx, setEntryIdx] = createSignal<Accessor<number>>(idx);
          const [entryIsMouseDown, setEntryIsMouseDown] =
            createSignal<Accessor<boolean>>(isMouseDown);

          return {
            state: createState(
              () =>
                render({
                  item,
                  idx: () => entryIdx()(),
                  isMouseDown: () => entryIsMouseDown()(),
                }),
              untrack(isMouseDown),
            ),
            dispose,
            idx: () => entryIdx()(),
            setIdx: (signal) => setEntryIdx(() => signal),
            isMouseDown: () => entryIsMouseDown()(),
            setIsMouseDown: (signal) => setEntryIsMouseDown(() => signal),
          };
        });
        itemEntries.set(item, createEntry);
        return createEntry;
      } else {
        entry.state.ref().style.opacity = "0";
        batch(() => {
          entry.setIdx(idx);
          entry.setIsMouseDown(isMouseDown);
        });
        return entry;
      }
    },
  };
}

export function createSortableGroupContext<T>() {
  return createContext<SortableGroup<T>>();
}

export function SortableGroupContext<T>(
  props: {
    readonly context: Context<SortableGroup<T> | undefined>;
    readonly render?: (props: SortableItemProps<T>) => JSX.Element;
    readonly children: JSX.Element;
  } & InheritableSortableProps,
) {
  const [local, others] = splitProps(props, ["context", "children", "render"]);
  const group = createSortableGroup<T>(others, local.render);
  return (
    <local.context.Provider value={group}>
      {local.children}
    </local.context.Provider>
  );
}

export interface SortableCallbacks<T> {
  readonly onClick?: (idx: number) => void;
  readonly onDragStart?: (idx: number) => void;
  readonly onDragEnd?: (
    startIdx: number | undefined,
    endIdx: number | undefined,
  ) => void;
  readonly onMove?: (fromIdx: number, toIdx: number) => void;
  readonly onRemove?: (idx: number) => void;
  readonly onInsert?: (item: T, idx: number) => void;
  readonly onHoldOver?: (fromIdx: number, toIdx: number) => void;
}

interface InheritableSortableProps {
  readonly animated?: boolean;
  readonly timingFunction?: TimingFunction;
  readonly animationDurationMs?: number;

  readonly moveThreshhold?: number;

  readonly mouseDownClass?: string;

  readonly clickThresholdDurationMs?: number;
  readonly clickThreshholdDistancePx?: number;
}

const defaultInheritableSortableProps = {
  timingFunction: linear,
  animationDurationMs: 250,
  moveThreshhold: 0.5,
  clickThresholdDurationMs: 100,
  clickThreshholdDistancePx: 8,
};

interface SortableProps<T>
  extends InheritableSortableProps,
    SortableCallbacks<T> {
  readonly each: ReadonlyArray<T>;

  readonly group?: Context<SortableGroup<T> | undefined>; // non-reactive

  readonly shouldInsert?: (item: T) => boolean;
}

interface ItemEntry {
  readonly idx: Accessor<number>;
  readonly state: ItemState;
  animationController?: SortableAnimationController;
}

interface ItemState {
  readonly ref: Accessor<HTMLElement>;
  readonly resolved: ChildrenReturn;
  readonly handleRefs: SetSignal<HTMLElement>;
}

export function Sortable<T, U extends JSX.Element>(
  props: SortableProps<T> & {
    readonly children?: (props: SortableItemProps<T>) => U; // non-reactive
  },
) {
  let childRef!: HTMLDivElement;
  let parentRef!: HTMLElement;
  let sortableRef!: SortableRef<T>;

  const itemEntries = new Map<T, ItemEntry>();

  const group = props.group != null ? useContext(props.group) : undefined;
  const dragState = group?.dragState ?? createDragState<T>();
  const owner = group?.owner ?? getOwner();

  const resolvedProps =
    group != null
      ? mergeProps(defaultInheritableSortableProps, group.props, props)
      : mergeProps(defaultInheritableSortableProps, props);

  const isMouseDownSelector = createSelector(
    () => dragState.dragging(),
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
      props: resolvedProps,
      itemEntries,
    };

    group?.sortables.add(sortableRef);
    onCleanup(() => group?.sortables.delete(sortableRef));
  });

  return (
    <>
      <div ref={childRef} style={{ display: "none" }} />
      <For each={resolvedProps.each}>
        {(item, idx) => {
          const isMouseDown = createMemo(() => isMouseDownSelector(item));

          // this is janky because it can cause a frame of transparency
          onMount(() => {
            setTimeout(() => (state.ref().style.opacity = "1"));
          });

          const state =
            resolvedProps.children != null || group == null
              ? createState(
                  () => resolvedProps.children!({ item, idx, isMouseDown }),
                  untrack(isMouseDown),
                )
              : group.render({ item, idx, isMouseDown }).state;

          const entry: ItemEntry = {
            idx,
            state,
          };

          itemEntries.set(item, entry);
          onCleanup(() => {
            itemEntries.delete(item);
            if (
              !isMouseDown() &&
              group != null &&
              group.itemEntries.has(item)
            ) {
              console.log("disposing");
              group.itemEntries.get(item)?.dispose();
              group.itemEntries.delete(item);
            }
          });

          const animatedMemo = createMemo(() => resolvedProps.animated);
          createEffect(() => {
            if (animatedMemo() ?? false) {
              const controller = createSortableAnimationController(
                state.ref(),
                () => resolvedProps.timingFunction,
                () => resolvedProps.animationDurationMs,
              );
              entry.animationController = controller;
              controller.start();

              createEffect(() => {
                if (isMouseDown()) {
                  controller.stop();
                }
              });

              onCleanup(() => {
                entry.animationController = undefined;
                controller.stop();
              });
            }
          });

          createEffect(() => {
            const cls = resolvedProps.mouseDownClass;
            if (cls != null && isMouseDown()) {
              const ref = state.ref();
              ref.classList.add(cls);
              onCleanup(() => {
                ref.classList.remove(cls);
              });
            }
          });

          const mouseDownListener = (e: MouseEvent) => {
            dragState.setDragging(item);
            runWithOwner(owner, () =>
              handleDrag(e, sortableRef, group, dragState, item),
            );
          };

          createEffect(() => {
            const hs = state.handleRefs.get();
            const listenables = hs.size > 0 ? [...hs] : [state.ref()];
            for (const listenable of listenables) {
              listenable.addEventListener("mousedown", mouseDownListener);
            }
            onCleanup(() => {
              for (const listenable of listenables) {
                listenable.removeEventListener("mousedown", mouseDownListener);
              }
            });
          });

          return <>{state.resolved()}</>;
        }}
      </For>
    </>
  );
}

function createState(
  render: () => JSX.Element,
  isMouseDown: boolean,
): ItemState {
  const handleRefs = createSetSignal<HTMLElement>();

  const resolved = children(() => (
    <SortableDirectiveContext.Provider value={handleRefs}>
      {render()}
    </SortableDirectiveContext.Provider>
  ));

  const ref = createMemo(
    on(
      () => resolved.toArray(),
      (arr) => {
        if (arr[0] instanceof HTMLElement) {
          arr[0].style.position = "relative";
          arr[0].style.zIndex = "0";
          return arr[0];
        } else {
          throw Error("sortable child did not resolve to a DOM node");
        }
      },
    ),
  );

  if (isMouseDown) {
    ref().style.opacity = "0";
  }

  return {
    ref,
    resolved,
    handleRefs,
  };
}
