import { createSignal, type Component, batch } from "solid-js";
import styles from "./App.module.css";
import { Sortable, flowGridLayout, move, sortableHandle } from "../src";

sortableHandle;

const App: Component = () => {
  const [data, setData] = createSignal<ReadonlyArray<number>>([]);
  const [count, setCount] = createSignal(0);

  return (
    <div class={styles.App}>
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
      <Sortable
        each={data()}
        layout={flowGridLayout}
        onMove={(_item, from, to) => {
          setData((cur) => move([...cur], from, to));
        }}
        autoscroll={document.documentElement}
      >
        {({ item }) => (
          <div
            style={{
              width: "300px",
              height: "200px",
              "background-color": "red",
              "line-height": "100%",
              "text-align": "center",
              "font-size": "50px",
              "user-select": "none",
            }}
          >
            {item}
            <div
              use:sortableHandle
              style={{
                width: "50px",
                height: "50px",
                "background-color": "blue",
              }}
            />
          </div>
        )}
      </Sortable>
    </div>
  );
};

export default App;
