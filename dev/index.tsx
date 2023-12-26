import { render } from "solid-js/web";
import "./styles.css";

import App from "./App";

declare module "solid-js" {
  namespace JSX {
    interface Directives {
      sortableHandle: boolean;
    }
  }
}

render(() => <App />, document.getElementById("root")!);
