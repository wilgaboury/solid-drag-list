import { Component, createSignal } from "solid-js";

import {
  createSortableGroupContext,
  defaultMutationEventListeners,
  Sortable,
  SortableGroupContext,
  sortableHandle,
  easeOutCirc,
} from "../src";

sortableHandle;

export function randomColor() {
  var letters = "0123456789ABCDEF";
  var color = "#";
  for (var i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
}

const ExampleGroupContext = createSortableGroupContext<number>();

const N = 5;

export const GridPage: Component = () => {
  const [elements, setElements] = createSignal<ReadonlyArray<number>>(
    Array.from(Array(N).keys()),
  );
  const [elements2, setElements2] = createSignal<ReadonlyArray<number>>(
    Array.from(Array(N).keys()).map((i) => i + N),
  );
  const [elements3, setElements3] = createSignal<ReadonlyArray<number>>(
    Array.from(Array(N).keys()).map((i) => i + N * 2),
  );

  const [largeGap, setLargeGap] = createSignal(false);

  return (
    <div>
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
            [...arr, ...elements2(), ...elements3()].reduce(
              (v1, v2) => Math.max(v1, v2),
              0,
            ) + 1,
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
        style={{
          display: "flex",
          "align-items": "start",
          gap: "40px",
        }}
      >
        <SortableGroupContext
          context={ExampleGroupContext}
          animated={elements().length <= 200}
          animationDurationMs={250}
          timingFunction={easeOutCirc}
          render={({ item, isMouseDown }) => {
            const color = randomColor();
            return (
              <div
                draggable={false}
                style={{
                  position: "relative",
                  height: "100px",
                  "background-color": color,
                  color: "black",
                  border: isMouseDown()
                    ? "2px solid blue"
                    : "2px solid transparent",
                }}
              >
                {item}
                <div
                  use:sortableHandle
                  style={{
                    position: "absolute",
                    height: "15px",
                    width: "15px",
                    top: "25px",
                    left: "25px",
                    "background-color": "black",
                    cursor: "grab",
                  }}
                />
                <div
                  use:sortableHandle
                  style={{
                    position: "absolute",
                    height: "15px",
                    width: "15px",
                    top: "50px",
                    left: "50px",
                    "background-color": "black",
                    cursor: "grab",
                  }}
                />
              </div>
            );
          }}
        >
          <div
            draggable={false}
            style={{
              padding: "20px",
              display: "grid",
              gap: largeGap() ? "50px" : "20px",
              "grid-template-columns": "repeat(auto-fill, 150px)",
              "justify-content": "center",
              "user-select": "none",
              "flex-grow": "1",
              "min-width": "100px",
              "min-height": "100px",
              "background-color": "lightblue",
            }}
          >
            <Sortable
              group={ExampleGroupContext}
              each={elements()}
              {...defaultMutationEventListeners(setElements)}
            />
          </div>
          <div
            draggable={false}
            style={{
              padding: "20px",
              display: "grid",
              gap: largeGap() ? "50px" : "20px",
              "grid-template-columns": "repeat(auto-fill, 150px)",
              "justify-content": "center",
              "user-select": "none",
              "flex-grow": "1",
              "min-width": "100px",
              "min-height": "100px",
              "background-color": "lightblue",
            }}
          >
            <Sortable
              group={ExampleGroupContext}
              each={elements2()}
              {...defaultMutationEventListeners(setElements2)}
            />
          </div>
          <div
            draggable={false}
            style={{
              padding: "20px",
              display: "grid",
              gap: largeGap() ? "50px" : "20px",
              "grid-template-columns": "repeat(auto-fill, 150px)",
              "justify-content": "center",
              "user-select": "none",
              "flex-grow": "1",
              "min-width": "100px",
              "min-height": "100px",
              "background-color": "lightblue",
            }}
          >
            <Sortable
              group={ExampleGroupContext}
              each={elements3()}
              {...defaultMutationEventListeners(setElements3)}
            >
              {({ item, isMouseDown }) => {
                const color = randomColor();
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
            </Sortable>
          </div>
        </SortableGroupContext>
      </div>
    </div>
  );
};
