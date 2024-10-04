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
  clientToRelative,
  elemClientRect,
  elemParentRelativeRect,
  intersection,
} from "./geom";
import { TimingFunction, linear } from "./timing";
import { SetSignal, createSetSignal } from "./util";

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

  const relativeMouseDownPercentPos =
    calculateRelativePercentPos(initialMouseEvent);

  let relativePosition: Position | undefined;

  let mouseClientPosition: Position | undefined;
  const updateTransform = () => {
    const itemRef = getItemRef();

    if (itemRef == null || mouseClientPosition == null) {
      return;
    }

    const mousePosition = clientToRelative(
      mouseClientPosition,
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
          sortable.props.onMove?.(
            item,
            sortable.itemEntries.get(item)!.idx(),
            idx,
          );
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
    updateTransformAndDoMove();
  };

  const scrollListener = () => {
    updateTransformAndDoMove();
  };

  const dragEnd = () => {
    const controller = sortable.itemEntries.get(item)?.animationController;
    const itemRef = getItemRef();
    if (controller != null) {
      controller.enable(relativePosition, () => {
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
    document.removeEventListener("mouseup", dragEnd);
    cleanupGlobalCursorGrabbingStyle();
  };

  document.addEventListener("mousemove", mouseMoveListener);
  document.addEventListener("scroll", scrollListener);
  document.addEventListener("mouseup", dragEnd);
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

export type CheckIndex = (
  layout: ReadonlyArray<Rect | undefined>,
  test: Rect,
  index: number,
) => number | undefined;

export function overlapPercentIndexCheck(threshold: number): CheckIndex {
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

interface InheritableSortableProps {
  readonly animated?: boolean;
  readonly timingFunction?: TimingFunction;
  readonly animationDurationMs?: number;

  readonly checkIndex?: CheckIndex;

  readonly mouseDownClass?: string;

  readonly clickDurationMs?: number;
  readonly clickDistancePx?: number;
}

const defaultInheritableSortableProps: Partial<InheritableSortableProps> = {
  timingFunction: linear,
  animationDurationMs: 250,
  checkIndex: overlapPercentIndexCheck(0.5),
  clickDurationMs: 100,
  clickDistancePx: 8,
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

export function Sortable2<T, U extends JSX.Element>(
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

  props =
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
      props,
      itemEntries,
    };

    group?.sortables.add(sortableRef);
    onCleanup(() => group?.sortables.delete(sortableRef));
  });

  return (
    <>
      <div ref={childRef} style={{ display: "none" }} />
      <For each={props.each}>
        {(item, idx) => {
          const isMouseDown = createMemo(() => isMouseDownSelector(item));

          const createState = () => {
            const handleRefs = createSetSignal<HTMLElement>();

            const resolved = children(() => (
              <SortableDirectiveContext.Provider value={handleRefs}>
                {props.children?.({
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
            props.children != null || group == null
              ? createState()
              : group.render({ item, idx, isMouseDown }).state;

          const entry: ItemEntry = {
            idx,
            state,
          };

          itemEntries.set(item, entry);
          onCleanup(() => itemEntries.delete(item));

          createEffect(() => {
            if (props.animated ?? false) {
              const controller = createSortableAnimationController(
                state.ref(),
                () => props.timingFunction,
                () => props.animationDurationMs,
              );
              entry.animationController = controller;

              createEffect(() => {
                if (isMouseDown()) {
                  controller.disable();
                }
              });

              onCleanup(() => {
                entry.animationController = undefined;
                controller.cleanup();
              });
            }
          });

          createEffect(() => {
            const cls = props.mouseDownClass;
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
