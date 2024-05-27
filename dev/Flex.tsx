import {
  Component,
  For,
  createEffect,
  createSignal,
  on,
  onCleanup,
  onMount,
} from "solid-js";

import {
  SortableAnimationController,
  createdSortableAnimationController,
} from "../src/animation";
import { easeInOutSine } from "../src/ease";
import { off } from "process";

function getRandomColor() {
  var letters = "0123456789ABCDEF";
  var color = "#";
  for (var i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
}

let offset = 0;

function animate(element: HTMLElement) {
  element.style.transform = `translate(${offset}px,${offset}px)`;
  offset += 1;
  requestAnimationFrame(() => animate(element));
}

export const FlexPage: Component = () => {
  const [elements, setElements] = createSignal(Array.from(Array(12).keys()));
  let ref: HTMLDivElement | undefined;
  let controller: SortableAnimationController | undefined;

  onMount(() => {
    controller = createdSortableAnimationController({
      element: ref!,
      easeFunc: easeInOutSine,
      easeTime: 1000,
    });

    // requestAnimationFrame(() => animate(ref!));
  });

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
        ref={ref}
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
              const child = controller!.create(childRef!);
              createEffect(
                on(idx, () => {
                  controller?.update();
                }),
              );
              onCleanup(child.cleanup);
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
