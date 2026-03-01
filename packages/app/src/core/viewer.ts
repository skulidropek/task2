import { Effect } from "effect"

import { viewFileRuntime } from "../../runtime/viewer-runtime.js"
import type { OutputSink, ViewerOptions, ViewResult } from "./types.js"

export const viewFile = (
  options: ViewerOptions,
  output: OutputSink
): Effect.Effect<ViewResult, Error> =>
  Effect.tryPromise({
    try: () => viewFileRuntime(options, output.write),
    catch: (cause) => new Error(String(cause))
  })
