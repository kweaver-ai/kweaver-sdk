#!/usr/bin/env node

// Wait for stdout and stderr to fully flush before terminating. Checking
// writableNeedDrain alone is not enough — a single console.log under the
// highWaterMark returns synchronously while bytes are still queued, so
// process.exit() can truncate piped output (~7-8KB) under spawn capture.
// Empty write + callback fires only after all preceding writes drain.
function exit(code) {
  let pending = 2;
  const done = () => {
    pending -= 1;
    if (pending === 0) process.exit(code);
  };
  process.stdout.write("", done);
  process.stderr.write("", done);
}

import("../dist/cli.js").then(({ run }) => {
  run(process.argv.slice(2))
    .then((code) => exit(code))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      exit(1);
    });
});
