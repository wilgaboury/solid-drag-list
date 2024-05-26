import { A, Route, Router } from "@solidjs/router";
import { LayoutExplorer } from "./LayoutExplorer";
import { TransformMeasureTest } from "./TransformMeasureTest";

export function Pages() {
  return (
    <Router>
      <Route
        path="/"
        component={() => (
          <ul>
            <li>
              <A href="/layout-explorer">Layout Explorer</A>
            </li>
            <li>
              <A href="/transform-measure-test">Transform Measure Test</A>
            </li>
          </ul>
        )}
      />
      <Route path="/layout-explorer" component={LayoutExplorer} />
      <Route path="/transform-measure-test" component={TransformMeasureTest} />
    </Router>
  );
}