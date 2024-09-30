import { Component, For, createSignal, onCleanup, onMount } from "solid-js";

import { easeOutQuad } from "../src/timing";
import { Sortable2 } from "../src/Sortable2";
import { move } from "../src";

export function getRandomColor() {
  var letters = "0123456789ABCDEF";
  var color = "#";
  for (var i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
}

export const GridPage: Component = () => {
  const [elements, setElements] = createSignal<ReadonlyArray<number>>(
    Array.from(Array(20).keys()),
  );
  const [largeGap, setLargeGap] = createSignal(false);

  return (
    <>
      <button
        onClick={() => {
          setElements((arr) => [
            arr[arr.length - 1]!,
            ...arr.slice(0, arr.length - 1),
          ]);
        }}
      >
        Rotate
      </button>
      <button
        onClick={() => {
          setElements((arr) => [...arr.slice(1), arr[0]!]);
        }}
      >
        Rotate Back
      </button>
      <button
        onClick={() => {
          setElements((arr) => [
            ...arr,
            arr.reduce((v1, v2) => Math.max(v1, v2), 0) + 1,
          ]);
        }}
      >
        Add
      </button>
      <button
        onClick={() => {
          setElements((arr) => arr.slice(0, arr.length - 1));
        }}
      >
        Remove
      </button>
      <button onClick={() => setLargeGap((v) => !v)}>Gap</button>

      <div
        draggable={false}
        style={{
          padding: "20px",
          display: "grid",
          gap: largeGap() ? "50px" : "20px",
          "grid-template-columns": "repeat(auto-fill, 150px)",
          "justify-content": "center",
          "user-select": "none",
        }}
      >
        <Sortable2
          each={elements()}
          onMove={(_item, from, to) => setElements((e) => move(e, from, to))}
          animated
          animationDurationMs={250}
          timingFunction={easeOutQuad}
        >
          {({ item, isMouseDown }) => {
            const color = getRandomColor();
            return (
              <div
                draggable={false}
                style={{
                  height: "100px",
                  "background-color": color,
                  color: "black",
                  border: isMouseDown()
                    ? "2px solid blue"
                    : "2px solid transparent",
                }}
              >
                {item}
              </div>
            );
          }}
        </Sortable2>
      </div>
    </>
  );
};
