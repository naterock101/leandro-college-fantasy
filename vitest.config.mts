import { defineConfig } from "vitest/config";

/* The DOM half of the suite. `node --test` still owns everything pure - the
   builders, lib/, the payload split - because it needs no config, no
   transform and no dependency at all, and that is worth keeping. What it
   cannot do is render a component, so the two runners split on that line and
   `npm test` runs both.
 *
 * jsdom is the only thing this adds to the tree, and it is a devDependency.
 * The runtime dependency count is still zero. */
export default defineConfig({
  /* tsconfig says jsx: "preserve", because Next does the transform. Vitest is
     not Next, so it has to be told which runtime to compile JSX against;
     without this every .tsx test fails on an undefined `React`. */
  oxc: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    /* Disjoint from `node --test tests/*.test.mjs` by extension, so neither
       runner ever picks up the other's files and no test runs twice. */
    include: ["tests/**/*.test.tsx"],
    setupFiles: ["tests/setup.ts"],
    restoreMocks: true,
  },
});
