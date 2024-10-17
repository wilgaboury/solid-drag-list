import { onMount } from "solid-js";

export function TransformMeasureTest() {
  let ref: HTMLDivElement | undefined;

  onMount(() => {
    const observer = new ResizeObserver(() => {
      console.log("resize");
      ref!.style.width = "100px";
      requestAnimationFrame((time) => console.log("paint2", time));
    });
    observer.observe(ref!);
  });

  return (
    <>
      <button
        onClick={() => {
          ref!.style.width = "200px";
          requestAnimationFrame((time) => console.log("paint1", time));
        }}
      >
        TEST!
      </button>
      <div
        ref={ref}
        style={{ width: "100px", height: "100px", "background-color": "blue" }}
      />
    </>
  );
}
