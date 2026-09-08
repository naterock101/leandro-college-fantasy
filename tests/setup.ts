import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/* Unmount between tests. Without it every render stays in the document and a
   `getByRole` that should find one tab strip finds four, which fails as an
   ambiguous-match error a long way from the test that actually leaked. */
afterEach(cleanup);
