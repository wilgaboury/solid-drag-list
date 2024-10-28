import { createAnimationController } from "../src/animation";
import { randomColor } from "./GridPage";
import { onMount } from "solid-js";

export function SimpleGridTest() {
  return (
    <div
      style={{
        padding: "20px",
        display: "grid",
        gap: "20px",
        "grid-template-columns": "repeat(auto-fill, 150px)",
        "justify-content": "center",
      }}
    >
      {Array.from(Array(20).keys()).map(() => {
        let ref!: HTMLDivElement;
        onMount(() => {
          createAnimationController(ref);
        });
        return (
          <div
            style={{
              "background-color": randomColor(),
              height: "100px",
            }}
            ref={ref}
          />
        );
      })}
    </div>
  );
}
