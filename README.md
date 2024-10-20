<p>
  <img width="100%" src="https://assets.solidjs.com/banner?type=solid-drag-list&background=tiles&project=%20" alt="solid-drag-list">
</p>

# solid-drag-list

[![pnpm](https://img.shields.io/badge/maintained%20with-pnpm-cc00ff.svg?style=for-the-badge&logo=pnpm)](https://pnpm.io/)

drag and drop lists for SolidJS

currently undergoing rapid development, so I wouldn't reccomend using it for production

## Quick start

<!-- Install it:

```bash
npm i solid-drag-list
# or
yarn add solid-drag-list
# or
pnpm add solid-drag-list
``` -->

Use it:

```ts
import { DragList } from "solid-drag-list";
```

Add to project to use drag handle directive in typescript:

```ts
declare module "solid-js" {
  namespace JSX {
    interface Directives {
      dragHandle: boolean;
    }
  }
}
```

## Obligatory Feature List

- animations
- custom layouts
- autoscroll
- drag from one list to another
- data-driven, reactive API
- specify drag handle (custom directive)
