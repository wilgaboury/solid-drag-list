import { Component, For, createSignal, onCleanup, onMount } from "solid-js";

import { createSortableAnimationController } from "../src/animation";
import { easeInOutSine } from "../src/ease";

function getRandomColor() {
  var letters = "0123456789ABCDEF";
  var color = "#";
  for (var i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
}

export const FlexPage: Component = () => {
  const [elements, setElements] = createSignal(Array.from(Array(200).keys()));

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
      <div
        style={{
          display: "flex",
          "flex-wrap": "wrap",
          padding: "50px",
          gap: "25px",
        }}
      >
        <For each={elements()}>
          {(element, idx) => {
            let childRef: HTMLDivElement | undefined;

            onMount(() => {
              const controller = createSortableAnimationController(
                childRef!,
                () => easeInOutSine,
                () => 250,
              );
              onCleanup(controller.cleanup);
            });

            return (
              <div
                id={`id${element}`}
                ref={childRef}
                style={{
                  width: "100px",
                  height: "100px",
                  "background-color": getRandomColor(),
                  color: "black",
                }}
              >
                {element}
              </div>
            );
          }}
        </For>
      </div>
    </>
  );
};
