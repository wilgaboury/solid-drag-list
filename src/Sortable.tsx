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
  createSelector,
  createSignal,
  getOwner,
  mergeProps,
  on,
  onCleanup,
  onMount,
  runWithOwner,
  splitProps,
  useContext,
} from "solid-js";

import {
  SortableAnimationController,
  createSortableAnimationController,
} from "./animation";
import {
  Position,
  Rect,
  area,
  clientToPage,
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

function calculateRelativePercentPosition(e: MouseEvent): Position {
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
  group: SortableGroup<T> | undefined,
  dragState: DragState<T>,
  item: T,
) {
  const cleanupGlobalCursorGrabbingStyle = addGlobalCursorGrabbingStyle();
  const getItemRef = () => sortable.itemEntries.get(item)?.state.ref();

  // todo: this should be an effect in case item ref changes
  {
    const itemRef = getItemRef();
    if (itemRef != null) {
      itemRef.style.zIndex = "1";
    }
  }

  const relativeMouseDownPercentPosition =
    calculateRelativePercentPosition(initialMouseEvent);

  const startSortable = sortable;
  const startIdx = sortable.itemEntries.get(item)!.idx();

  let mouseClientPosition: Position = {
    x: initialMouseEvent.x,
    y: initialMouseEvent.y,
  };
  let mouseRelativePosition: Position = clientToRelative(
    mouseClientPosition,
    sortable.parent,
  );
  let mouseMoveDistance: number = 0;
  let initialMouseDownTime = Date.now();
  let cancelClick = false;

  let itemRelativeDragPosition: Position | undefined;

  const updateMouseRelativePosition = () => {
    const newMouseRelativePosition: Position = clientToRelative(
      mouseClientPosition,
      sortable.parent,
    );
    mouseMoveDistance += dist(mouseRelativePosition, newMouseRelativePosition);
    mouseRelativePosition = newMouseRelativePosition;

    if (
      !cancelClick &&
      (mouseMoveDistance > sortable.props.clickThreshholdDistancePx ||
        Date.now() - initialMouseDownTime >
          sortable.props.clickThresholdDurationMs)
    ) {
      sortable.props.onDragStart?.(startIdx);
    }
  };

  const updateTransform = () => {
    const itemRef = getItemRef();

    if (itemRef == null || mouseClientPosition == null) {
      return;
    }

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

  const updateTransformAndDoMove = () => {
    const itemRef = getItemRef();

    if (itemRef == null) {
      return;
    }

    updateTransform();

    const rect = elemParentRelativeRect(itemRef);

    const check = (idx: number) => {
      const entry = sortable.itemEntries.get(sortable.props.each[idx]!)!;
      const testRect =
        entry.animationController?.layoutParentRelativeRect() ??
        elemParentRelativeRect(entry.state.ref());
      const intersect = intersection(rect, testRect);

      if (intersect != null) {
        const a = area(intersect);
        const percent = Math.max(a / area(rect), a / area(testRect));
        if (percent > 0.5) {
          cancelClick = true;
          sortable.props.onMove?.(sortable.itemEntries.get(item)!.idx(), idx);
          updateTransform();
          return true;
        }
      }
      return false;
    };

    // search outward from current position, should result in less comparisons than a typical linear search when there is a match
    const currentIdx = sortable.itemEntries.get(item)!.idx();
    let backward = currentIdx - 1;
    let forward = currentIdx + 1;

    while (backward >= 0 || forward < sortable.props.each.length) {
      if (backward >= 0 && check(backward)) {
        break;
      }
      if (forward < sortable.props.each.length && check(forward)) {
        break;
      }

      backward--;
      forward++;
    }
  };

  const mouseMoveListener = (e: MouseEvent) => {
    mouseClientPosition = { x: e.clientX, y: e.clientY };
    updateMouseRelativePosition();
    updateTransformAndDoMove();
  };

  const scrollListener = () => {
    updateMouseRelativePosition();
    updateTransformAndDoMove();
  };

  const mouseUpListener = () => {
    if (sortable.props.onClick != null && !cancelClick) {
      sortable.props.onClick(startIdx);
    } else {
      sortable.props.onDragEnd?.(
        startIdx,
        sortable.itemEntries.get(item)!.idx(),
      );
    }

    dragEnd();
  };

  const dragEnd = () => {
    const controller = sortable.itemEntries.get(item)?.animationController;
    const itemRef = getItemRef();
    if (controller != null) {
      controller.start(itemRelativeDragPosition).then(() => {
        if (itemRef != null) {
          itemRef.style.zIndex = "0";
        }
      });
    } else {
      if (itemRef != null) {
        itemRef.style.transform = "";
      }
    }

    dragState.setDragging(undefined);
    document.removeEventListener("mousemove", mouseMoveListener);
    document.removeEventListener("scroll", scrollListener);
    document.removeEventListener("mouseup", mouseUpListener);
    cleanupGlobalCursorGrabbingStyle();
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
      let entry = itemEntries.get(item);
      if (entry == null) {
        const [entryIdx, setEntryIdx] = createSignal(idx);
        const [entryIsMouseDown, setEntryIsMouseDown] =
          createSignal(isMouseDown);

        entry = {
          // TODO: actually use render function and set dispose correctly
          state: {
            ref: () => document.createElement("div"),
            resolved: children(() => <></>),
            handleRefs: createSetSignal(),
          },
          dispose: () => {},
          idx: () => entryIdx()(),
          setIdx: setEntryIdx,
          isMouseDown: () => entryIsMouseDown()(),
          setIsMouseDown: setEntryIsMouseDown,
        };
        itemEntries.set(item, entry);
      } else {
        batch(() => {
          entry!.setIdx(idx);
          entry!.setIsMouseDown(isMouseDown);
        });
      }

      return entry;
    },
  };
}

export function createSortableGroupContext<T>() {
  return createContext<SortableGroup<T>>();
}

export function SortableGroupContext<T>(
  props: {
    readonly context: Context<SortableGroup<T>>;
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

interface SortableHooks<T> {
  readonly onClick?: (idx: number) => void;
  readonly onDragStart?: (idx: number) => void;
  readonly onDragEnd?: (
    startIdx: number | undefined,
    endIdx: number | undefined,
  ) => void;
  readonly onMove?: (fromIdx: number, toIdx: number) => void;
  readonly onRemove?: (idx: number) => void;
  readonly onInsert?: (idx: number) => void;
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

interface SortableProps<T> extends InheritableSortableProps, SortableHooks<T> {
  readonly each: ReadonlyArray<T>;

  readonly group?: Context<SortableGroup<T>>; // non-reactive

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

          const createState = () => {
            const handleRefs = createSetSignal<HTMLElement>();

            const resolved = children(() => (
              <SortableDirectiveContext.Provider value={handleRefs}>
                {resolvedProps.children?.({
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
                    arr[0].style.position = "relative";
                    arr[0].style.zIndex = "0";
                    return arr[0];
                  } else {
                    throw Error("sortable child did not resolve to a DOM node");
                  }
                },
              ),
            );

            return {
              ref,
              resolved,
              handleRefs,
            };
          };

          const state =
            resolvedProps.children != null || group == null
              ? createState()
              : group.render({ item, idx, isMouseDown }).state;

          const entry: ItemEntry = {
            idx,
            state,
          };

          itemEntries.set(item, entry);
          onCleanup(() => itemEntries.delete(item));

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
