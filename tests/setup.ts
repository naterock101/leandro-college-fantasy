import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/* React only lets act() flush work when it is told it is in a test. Without
   this every direct act() call warns and, worse, does not flush, so an
   assertion runs against the DOM as it was before the interaction. */
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/* Unmount between tests. Without it every render stays in the document and a
   `getByRole` that should find one tab strip finds four, which fails as an
   ambiguous-match error a long way from the test that actually leaked. */
afterEach(cleanup);
