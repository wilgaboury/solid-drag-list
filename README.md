<p>
  <img width="100%" src="https://assets.solidjs.com/banner?type=solid-drag-list&background=tiles&project=%20" alt="solid-drag-list">
</p>

# solid-drag-list

[![pnpm](https://img.shields.io/badge/maintained%20with-pnpm-cc00ff.svg?style=for-the-badge&logo=pnpm)](https://pnpm.io/)

drag and drop lists for SolidJS

currently undergoing rapid development, so I wouldn't reccomend using it for production

## Quick start

#### Install

```bash
npm i solid-drag-list
# or
yarn add solid-drag-list
# or
pnpm add solid-drag-list
```

#### Import

```ts
import { DragList } from "solid-drag-list";
```

#### Use

```tsx
function Component() {
  const [items, setItems] = createSignal<number[]>(
    Array.from(Array(10).keys()),
  );
  return (
    <div style={{ display: "flex" }}>
      <DragList each={items()} {...defaultMutationEventListeners(setItems)}>
        {({ item, idx }) => <div>...</div>}
      </DragList>
    </div>
  );
}
```

Elements inside of a drag list can be designated as a drag handle using the `dragHandle` directive:

```tsx
<DragList each={items()} {...defaultMutationEventListeners(setItems)}>
  {({ item, idx }) => (
    <div class="container">
      <div use:dragHandle class="handle" />
      <div class="content">...</div>
    </div>
  )}
</DragList>
```

If using typscript, add the following code to your project to use the directive:

```ts
declare module "solid-js" {
  namespace JSX {
    interface Directives {
      dragHandle: boolean;
    }
  }
}
```

## Features

- data-driven, reactive API
- animations
- seamlessly use any browser layout (including CSS Flexbox and Grid)
- drag groups (drag items between lists)
- distiguishes between click and drag events
- custom placeholders
