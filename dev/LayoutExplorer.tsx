import { createSignal, type Component, batch, Show } from "solid-js";
import styles from "./LayoutExploerer.module.css";
import {
  Sortable,
  flowGridLayout,
  horizontalLayout,
  move,
  sortableHandle,
  splice,
  verticalLayout,
} from "../src";

sortableHandle;

const layouts = ["flow", "horizontal", "vertical"] as const;
type Layout = (typeof layouts)[number];

const aligns = ["left", "center", "right"] as const;
type Align = (typeof aligns)[number];

function getLayout(layout: Layout, align: Align) {
  switch (layout) {
    case "flow":
      return flowGridLayout({ align });
    case "horizontal":
      return horizontalLayout();
    case "vertical":
      return verticalLayout();
  }
}

export function LayoutExplorer() {
  const [data, setData] = createSignal<ReadonlyArray<number>>([]);
  const [count, setCount] = createSignal(0);
  const [layoutIdx, setLayoutIdx] = createSignal(0);
  const [alignIdx, setAlignIdx] = createSignal(0);
  const [wide, setWide] = createSignal(true);

  return (
    <div class={styles.App}>
      <div>
        <button class={styles.button} onClick={() => setWide((cur) => !cur)}>
          wide: {wide() ? "true" : "false"}
        </button>
        <button
          class={styles.button}
          onClick={() =>
            batch(() => {
              setCount((cur) => cur + 1);
              setData((cur) => [...cur, count()]);
            })
          }
        >
          Count: {count()}
        </button>
        <button
          class={styles.button}
          onClick={() => setLayoutIdx((cur) => (cur + 1) % layouts.length)}
        >
          Layout: {layouts[layoutIdx()]}
        </button>
        <Show when={layouts[layoutIdx()] === "flow"}>
          <button
            class={styles.button}
            onClick={() => setAlignIdx((cur) => (cur + 1) % aligns.length)}
          >
            Align: {aligns[alignIdx()]}
          </button>
        </Show>
      </div>
      <Sortable
        each={data()}
        layout={getLayout(layouts[layoutIdx()]!, aligns[alignIdx()]!)}
        onMove={(_item, from, to) => {
          setData((cur) => move(cur, from, to));
        }}
        autoscroll={document.documentElement}
      >
        {({ item, idx }) => (
          <div
            class={styles.block}
            style={{ width: wide() ? "300px" : "150px" }}
          >
            #{item}
            <div use:sortableHandle class={styles.handle} />
            <button
              class={styles.button}
              onClick={() => setData((cur) => splice(cur, idx(), 1))}
            >
              Remove
            </button>
          </div>
        )}
      </Sortable>
    </div>
  );
}
