import {
  Accessor,
  ChildrenReturn,
  Context,
  For,
  JSX,
  Owner,
  Show,
  batch,
  children,
  createComputed,
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

import { AnimationController, createAnimationController } from "./animation";
import {
  Position,
  Rect,
  Size,
  area,
  clientToRelative,
  dist,
  elemClientRect,
  elemParentRelativeRect,
  intersection,
} from "./geom";
import { TimingFunction, linear } from "./timing";
import { SetSignal, createSetSignal } from "./util";

interface DragListRef<T> {
  readonly parent: HTMLElement;
  readonly props: DragListProps<T> & typeof defaultInheritableProps;
  readonly itemEntries: Map<T, ItemEntry>;
}

interface DragListRenderProps<T> {
  readonly item: T;
  readonly idx: Accessor<number>;
  readonly isMouseDown: Accessor<boolean>;
}

export function createDragListRenderContext<T>() {
  return createContext<DragListRenderProps<T> | undefined>();
}

const DragListHandleContext = createContext<SetSignal<HTMLElement>>();

/**
 * directive that can be used by adding attribute use:dragHandle to JSX element
 */
export function dragHandle(el: Element, _accessor: () => any) {
  const handleRefs = useContext(DragListHandleContext);
  if (handleRefs == null) {
    console.error("drag handle context could not be found");
  } else if (!(el instanceof HTMLElement)) {
    console.error("dragHandle directive used on invalid element type");
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
  initialDragList: DragListRef<T>,
  group: DragListGroup<T> | undefined,
  dragState: DragState<T>,
  item: T,
  dispose: () => any,
) {
  const [currentDragList, setCurrentDragList] =
    createSignal<DragListRef<T>>(initialDragList);

  let cleanupGlobalCursorGrabbingStyle: (() => void) | undefined;
  const getItemRef = () => currentDragList().itemEntries.get(item)!.state.ref();

  const relativeMouseDownPercentPosition = calculateRelativePercentPosition(
    initialMouseEvent,
    getItemRef(),
  );

  const startIdx = currentDragList().itemEntries.get(item)!.idx();

  let mouseClientPosition: Position = {
    x: initialMouseEvent.x,
    y: initialMouseEvent.y,
  };
  let mouseRelativePosition: Position = clientToRelative(
    mouseClientPosition,
    currentDragList().parent,
  );
  let mouseMoveDistance: number = 0;
  const initialMouseDownTime = Date.now();
  let cancelClick = false;

  let itemRelativeDragPosition: Position = elemParentRelativeRect(
    currentDragList().itemEntries.get(item)!.state.ref(),
  );
  dragState.setLayoutPosition(itemRelativeDragPosition);

  let insideDragList = true;

  createEffect(() => {
    const itemRef = getItemRef();
    itemRef.style.zIndex = "1";
    onCleanup(() => {
      const controller =
        currentDragList().itemEntries.get(item)?.animationController;
      if (controller != null) {
        controller
          .start(itemRelativeDragPosition)
          .then(() => (itemRef.style.zIndex = "0"));
      } else {
        itemRef.style.zIndex = "0";
        itemRef.style.transform = "";
      }
    });
  });

  createEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.length > 0) {
          if (entries[0]?.isIntersecting) {
            insideDragList = true;
          } else {
            insideDragList = false;
          }
        }
      },
      {
        root: currentDragList().parent,
        threshold: currentDragList().props.moveThreshhold,
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
      currentDragList().parent,
    );
    mouseMoveDistance += dist(mouseRelativePosition, newMouseRelativePosition);
    mouseRelativePosition = newMouseRelativePosition;

    if (
      !cancelClick &&
      (mouseMoveDistance > currentDragList().props.clickThreshholdDistancePx ||
        Date.now() - initialMouseDownTime >
          currentDragList().props.clickThresholdDurationMs)
    ) {
      cancelClick = true;
      currentDragList().props.onDragStart?.(item, startIdx);
      cleanupGlobalCursorGrabbingStyle = addGlobalCursorGrabbingStyle();
    }
  };

  const updateTransform = () => {
    const itemRef = getItemRef();

    itemRef.style.transform = "";

    const layoutRect = elemParentRelativeRect(itemRef);
    queueMicrotask(() => dragState.setLayoutPosition(layoutRect));

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

  const checkMove = (dragList: DragListRef<T>) => {
    const itemRef = getItemRef();

    const rect = clientToRelative(elemClientRect(itemRef), dragList.parent);

    for (let i = 0; i < dragList.props.each.length; i++) {
      const entryItem = dragList.props.each[i]!;
      if (entryItem == item) {
        continue;
      }

      const entry = dragList.itemEntries.get(entryItem)!;
      const testRect =
        entry.animationController?.layoutParentRelativeRect() ??
        elemParentRelativeRect(entry.state.ref());
      const intersect = intersection(rect, testRect);

      if (intersect != null) {
        const a = area(intersect);
        const percent = Math.max(a / area(rect), a / area(testRect));
        if (percent > dragList.props.moveThreshhold) {
          return i;
        }
      }
    }

    return -1;
  };

  const maybeFireRemoveInsertEvents = () => {
    if (group == null || group.members.size <= 1) {
      return;
    }

    const itemRef = getItemRef();

    const rect = elemClientRect(itemRef);
    let mostIntersecting: DragListRef<T> | undefined = undefined;
    let mostIntersectingArea = 0;

    for (const member of group.members) {
      if (
        currentDragList() == member ||
        !(member.props.shouldInsert?.(item) ?? true)
      ) {
        continue;
      }

      const currentIntersection = intersection(
        elemClientRect(member.parent),
        rect,
      );
      const currentIntersectionArea =
        currentIntersection != null ? area(currentIntersection) : 0;

      if (currentIntersectionArea > mostIntersectingArea) {
        mostIntersecting = member;
        mostIntersectingArea = currentIntersectionArea;
      }
    }

    if (mostIntersecting != null) {
      let idx = checkMove(mostIntersecting);
      if (
        idx < 0 &&
        mostIntersectingArea / area(rect) >
          mostIntersecting.props.moveThreshhold
      ) {
        idx = mostIntersecting.props.each.length;
      }

      if (idx >= 0) {
        currentDragList().props.onRemove?.(
          item,
          currentDragList().itemEntries.get(item)!.idx(),
        );
        if (currentDragList().itemEntries.has(item)) {
          return;
        }

        batch(() => {
          mostIntersecting.props.onInsert?.(item, idx);
          if (mostIntersecting.props.each.includes(item)) {
            setCurrentDragList(mostIntersecting);
          } else {
            dragEnd();
            group.itemEntries.get(item)?.dispose();
            group.itemEntries.delete(item);
          }
        });

        updateMouseRelativePosition(); // this call will cause a large jump in distance travelled, which shouldn't matter at this point in the drag but should get fixed at some point
        updateTransform();
      }
    }
  };

  let prevMove: T | undefined;

  const updateTransformAndFireEvents = () => {
    updateTransform();

    if (insideDragList) {
      const idx = checkMove(currentDragList());
      if (idx >= 0) {
        const toItem = currentDragList().props.each[idx];
        // this check ensures different sized items do not cause back and forth movement events
        if (toItem != prevMove) {
          prevMove = toItem;
          cancelClick = true;
          currentDragList().props.onMove?.(
            item,
            currentDragList().itemEntries.get(item)!.idx(),
            idx,
          );
          updateTransform();
        }
      } else {
        prevMove = undefined;
      }
    } else {
      maybeFireRemoveInsertEvents();
    }
  };

  const mouseMoveListener = (e: MouseEvent) => {
    mouseClientPosition = { x: e.clientX, y: e.clientY };
    updateMouseRelativePosition();
    updateTransformAndFireEvents();
  };

  const scrollListener = () => {
    updateMouseRelativePosition();
    updateTransformAndFireEvents();
  };

  const mouseUpListener = () => {
    if (currentDragList().props.onClick != null && !cancelClick) {
      currentDragList().props.onClick!(item, startIdx);
    } else if (initialDragList == currentDragList()) {
      currentDragList().props.onDragEnd?.(
        item,
        startIdx,
        currentDragList().itemEntries.get(item)!.idx(),
      );
    } else {
      initialDragList.props.onDragEnd?.(item, startIdx, undefined);
      currentDragList().props.onDragEnd?.(
        item,
        undefined,
        currentDragList().itemEntries.get(item)!.idx(),
      );
    }

    dragEnd();
  };

  const dragEnd = () => {
    dragState.setDragging(undefined);
    dragState.setLayoutPosition(undefined);
    document.removeEventListener("mousemove", mouseMoveListener);
    document.removeEventListener("scroll", scrollListener);
    document.removeEventListener("mouseup", mouseUpListener);
    cleanupGlobalCursorGrabbingStyle?.();
    dispose();
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
  readonly layoutPosition: Accessor<Position | undefined>;
  readonly setLayoutPosition: (value: Position | undefined) => void;
}

function createDragState<T>(): DragState<T> {
  const [dragging, setDragging] = createSignal<T>();
  const [layoutPosition, setLayoutPosition] = createSignal<Position>();
  return {
    dragging,
    setDragging,
    layoutPosition,
    setLayoutPosition,
  };
}

export interface GroupItem {
  readonly state: ItemState;
  readonly dispose: () => void;
  readonly idx: Accessor<number>;
  readonly setIdx: (value: Accessor<number>) => void;
  readonly isMouseDown: Accessor<boolean>;
  readonly setIsMouseDown: (value: Accessor<boolean>) => void;
}

export interface DragListGroup<T> {
  readonly members: Set<DragListRef<T>>;
  readonly dragState: DragState<T>;
  readonly props: InheritableDragListProps<T>;
  readonly owner: Owner | null;
  readonly itemEntries: Map<T, GroupItem>;
  readonly render: (props: DragListRenderProps<T>) => GroupItem;
}

function createDragListGroup<T>(
  props: InheritableDragListProps<T>,
  render?: (props: DragListRenderProps<T>) => JSX.Element,
): DragListGroup<T> {
  const itemEntries = new Map<T, GroupItem>();

  return {
    members: new Set(),
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
        const createEntry: GroupItem = createRoot((dispose) => {
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
        batch(() => {
          entry.setIdx(idx);
          entry.setIsMouseDown(isMouseDown);
        });
        return entry;
      }
    },
  };
}

export function createDragListGroupContext<T>() {
  return createContext<DragListGroup<T>>();
}

export function DragListGroupContext<T>(
  props: {
    readonly context: Context<DragListGroup<T> | undefined>;
    readonly render?: (props: DragListRenderProps<T>) => JSX.Element;
    readonly children: JSX.Element;
  } & InheritableDragListProps<T>,
) {
  const [local, others] = splitProps(props, ["context", "children", "render"]);
  const group = createDragListGroup<T>(others, local.render);
  return (
    <local.context.Provider value={group}>
      {local.children}
    </local.context.Provider>
  );
}

export interface DragListMutationEvents<T> {
  readonly onMove?: (item: T, fromIdx: number, toIdx: number) => void;
  readonly onInsert?: (item: T, idx: number) => void;
  readonly onRemove?: (item: T, idx: number) => void;
}

export interface DragListEvents<T> extends DragListMutationEvents<T> {
  readonly onDragStart?: (item: T, idx: number) => void;
  readonly onDragEnd?: (
    item: T,
    startIdx: number | undefined,
    endIdx: number | undefined,
  ) => void;
  readonly onClick?: (item: T, idx: number) => void;
  readonly onHoldOver?: (
    dragging: T,
    over: T,
    from: number,
    to: number,
  ) => void;
}

interface InheritableDragListProps<T> {
  readonly placeholder?: (item: T) => JSX.Element;

  readonly animated?: boolean;
  readonly timingFunction?: TimingFunction;
  readonly animationDurationMs?: number;

  readonly moveThreshhold?: number;

  readonly mouseDownClass?: string;

  readonly clickThresholdDurationMs?: number;
  readonly clickThreshholdDistancePx?: number;
}

const defaultInheritableProps = {
  timingFunction: linear,
  animationDurationMs: 250,
  moveThreshhold: 0.5,
  clickThresholdDurationMs: 100,
  clickThreshholdDistancePx: 8,
};

interface DragListProps<T>
  extends InheritableDragListProps<T>,
    DragListEvents<T> {
  readonly each: ReadonlyArray<T>;

  readonly group?: Context<DragListGroup<T> | undefined>; // non-reactive

  readonly shouldInsert?: (item: T) => boolean;
}

interface ItemEntry {
  readonly idx: Accessor<number>;
  readonly state: ItemState;
  animationController?: AnimationController;
}

interface ItemState {
  readonly ref: Accessor<HTMLElement>;
  readonly resolved: ChildrenReturn;
  readonly handleRefs: SetSignal<HTMLElement>;
}

export function DragList<T, U extends JSX.Element>(
  props: DragListProps<T> & {
    readonly children?: (props: DragListRenderProps<T>) => U; // non-reactive
  },
) {
  let childRef!: HTMLDivElement;
  let parentRef!: HTMLElement;
  let dragListRef!: DragListRef<T>;

  const itemEntries = new Map<T, ItemEntry>();

  const group = props.group != null ? useContext(props.group) : undefined;
  const dragState = group?.dragState ?? createDragState<T>();
  const owner = group?.owner ?? getOwner();

  const resolvedProps =
    group != null
      ? mergeProps(defaultInheritableProps, group.props, props)
      : mergeProps(defaultInheritableProps, props);

  const isMouseDownSelector = createSelector(
    () => dragState.dragging(),
    (item, dragging) => item === dragging,
  );

  onMount(() => {
    if (childRef.parentElement == null) {
      console.error("drag list must have parent element");
      return;
    } else {
      parentRef = childRef.parentElement;
    }

    parentRef.draggable = false;

    createEffect(() => {
      if (resolvedProps.placeholder != null) {
        const prev = parentRef.style.position;
        parentRef.style.position = "relative";
        onCleanup(() => (parentRef.style.position = prev));
      }
    });

    dragListRef = {
      parent: parentRef,
      props: resolvedProps,
      itemEntries,
    };

    group?.members.add(dragListRef);
    onCleanup(() => group?.members.delete(dragListRef));
  });

  return (
    <>
      <div ref={childRef} style={{ display: "none" }} />
      <Show
        when={
          resolvedProps.placeholder != null &&
          dragState.dragging() != null &&
          resolvedProps.each.includes(dragState.dragging()!)
        }
      >
        <Placeholder
          render={resolvedProps.placeholder!}
          dragState={dragState}
          itemEntries={itemEntries}
        />
      </Show>
      <For each={resolvedProps.each}>
        {(item, idx) => {
          const isMouseDown = createMemo(() => isMouseDownSelector(item));

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
              group.itemEntries.get(item)?.dispose();
              group.itemEntries.delete(item);
            }
          });

          const animatedMemo = createMemo(() => resolvedProps.animated);
          createEffect(() => {
            if (animatedMemo() ?? false) {
              const controller = createAnimationController(
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

          createEffect(() => {
            const ref = state.ref();
            ref.draggable = false;
          });

          createEffect(() => {
            for (const handle of state.handleRefs.get()) {
              handle.draggable = false;
            }
          });

          const mouseDownListener = (e: MouseEvent) => {
            dragState.setDragging(item);
            createRoot((dispose) =>
              handleDrag(e, dragListRef, group, dragState, item, dispose),
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
    <DragListHandleContext.Provider value={handleRefs}>
      {render()}
    </DragListHandleContext.Provider>
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
          throw Error("drag list child did not resolve to a DOM node");
        }
      },
    ),
  );

  return {
    ref,
    resolved,
    handleRefs,
  };
}

function Placeholder<T>(props: {
  render: (item: T) => JSX.Element;
  dragState: DragState<T>;
  itemEntries: Map<T, ItemEntry>;
}) {
  const position = () => props.dragState.layoutPosition();
  const [size, setSize] = createSignal<Size>();

  createComputed(() => {
    const dragging = props.dragState.dragging();
    if (dragging != null) {
      const itemEntry = props.itemEntries.get(dragging);
      if (itemEntry != null) {
        const observer = new ResizeObserver((entries) => {
          for (const entry of entries) {
            // TODO: this will have issues if using vertical languages
            setSize({
              width: entry.borderBoxSize[0]!.inlineSize,
              height: entry.borderBoxSize[0]!.blockSize,
            });
          }
        });

        observer.observe(itemEntry.state.ref());
        onCleanup(() => observer.disconnect());
      }
    }
    return undefined;
  });
  return (
    <Show
      when={
        props.dragState.dragging() != null &&
        position() != null &&
        size() != null
      }
    >
      <div
        style={{
          position: "absolute",
          top: "0",
          left: "0",
          height: `${size()!.height}px`,
          width: `${size()!.width}px`,
          transform: `translate(${position()!.x}px, ${position()!.y}px)`,
        }}
      >
        {props.render(props.dragState.dragging()!)}
      </div>
    </Show>
  );
}
