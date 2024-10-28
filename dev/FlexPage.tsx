import { Component, createSignal } from "solid-js";

import {
  createDragListGroupContext,
  defaultMutationEventListeners,
  DragList,
  DragListGroupContext,
  dragHandle,
  easeOutCirc,
} from "../src";

const N = 5;

export const FlexPage: Component = () => {
  const [elements, setElements] = createSignal<ReadonlyArray<number>>(
    Array.from(Array(N).keys()),
  );

  return (
    <div>
      <button>Do Nothing</button>
      <div
        style={{
          display: "flex",
          "flex-wrap": "wrap",
          gap: "20px",
        }}
      >
        <DragList
          each={elements()}
          {...defaultMutationEventListeners(setElements)}
          // animated
        >
          {({ item, isMouseDown }) => (
            <div
              style={{
                height: "200px",
                width: item % 2 == 0 ? "400px" : "200px",
                "background-color": isMouseDown() ? "lightblue" : "blue",
              }}
            />
          )}
        </DragList>
      </div>
    </div>
  );
};
