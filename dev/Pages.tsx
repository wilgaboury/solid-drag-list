import { A, Route, Router } from "@solidjs/router";
import { GridPage } from "./GridPage";
import { FlexPage } from "./FlexPage";

export function Pages() {
  return (
    <Router>
      <Route
        path="/"
        component={() => (
          <ul>
            <li>
              <A href="/grid-test">Grid Test</A>
            </li>
            <li>
              <A href="/flex-test">Flex Test</A>
            </li>
          </ul>
        )}
      />
      <Route path="/grid-test" component={GridPage} />
      <Route path="/flex-test" component={FlexPage} />
    </Router>
  );
}
