import { render } from "solid-js/web";
import "./styles.css";
import { Pages } from "./Pages";
import { SimpleGridTest } from "./SimpleGridTest";

declare module "solid-js" {
  namespace JSX {
    interface Directives {
      sortableHandle: boolean;
    }
  }
}

render(() => <Pages />, document.getElementById("root")!);
