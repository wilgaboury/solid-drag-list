import { createSignal, type Component, batch, Show } from "solid-js";
import styles from "./App.module.css";
import {
  Sortable,
  flowGridLayout,
  horizontalLayout,
  move,
  sortableHandle,
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

const App: Component = () => {
  const [data, setData] = createSignal<ReadonlyArray<number>>([]);
  const [count, setCount] = createSignal(0);
  const [layoutIdx, setLayoutIdx] = createSignal(0);
  const [alignIdx, setAlignIdx] = createSignal(0);

  return (
    <div class={styles.App}>
      <div>
        <button
          style={{ margin: "24px", padding: "8px" }}
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
          style={{ margin: "24px", padding: "8px" }}
          onClick={() => setLayoutIdx((cur) => (cur + 1) % layouts.length)}
        >
          Layout: {layouts[layoutIdx()]}
        </button>
        <Show when={layouts[layoutIdx()] === "flow"}>
          <button
            style={{ margin: "24px", padding: "8px" }}
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
          setData((cur) => move([...cur], from, to));
        }}
        autoscroll={document.documentElement}
      >
        {({ item }) => (
          <div class={styles.block}>
            #{item}
            <div use:sortableHandle class={styles.handle} />
          </div>
        )}
      </Sortable>
    </div>
  );
};

export default App;
