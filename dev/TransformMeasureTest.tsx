export function TransformMeasureTest() {
  let ref: HTMLDivElement | undefined;
  return (
    <>
      <button
        onClick={() => {
          const e = ref!;

          requestAnimationFrame(() => console.log("paint"));
          console.log(e.getBoundingClientRect());
          e.style.transform = "translate(100px, 100px)";
          console.log(e.getBoundingClientRect());
          e.style.transform = "";
          console.log(e.getBoundingClientRect());
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
