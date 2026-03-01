import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { vi } from "vitest"

import { runCli } from "../../src/app/program.js"
import { withTempFile } from "../support/temp-file.js"

const withStdoutCapture = Effect.acquireRelease(
  Effect.sync(() => {
    let buffer = ""
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      buffer += String(chunk)
      return true
    })

    return {
      read: () => buffer,
      spy
    }
  }),
  ({ spy }) =>
    Effect.sync(() => {
      spy.mockRestore()
    })
)

const runCliEffect = (args: ReadonlyArray<string>) =>
  Effect.tryPromise({
    try: () => runCli(args),
    catch: (cause) => new Error(String(cause))
  })

describe("main program", () => {
  it.effect("prints help when arguments are not provided", () =>
    Effect.scoped(
      Effect.gen(function*(_) {
        const capture = yield* _(withStdoutCapture)

        yield* _(runCliEffect([]))

        yield* _(
          Effect.sync(() => {
            expect(capture.read()).toContain("Usage:")
            expect(capture.read()).toContain("viewer <file-path>")
          })
        )
      })
    ))

  it.effect("prints requested lines from a file", () =>
    Effect.scoped(
      Effect.gen(function*(_) {
        const capture = yield* _(withStdoutCapture)
        const filePath = yield* _(
          withTempFile("program-tests", "sample.txt", "line-1\nline-2\nline-3\nline-4\n")
        )

        yield* _(
          runCliEffect([filePath, "--from", "2", "--lines", "2", "--no-auto-encoding"])
        )

        yield* _(
          Effect.sync(() => {
            expect(capture.read()).toBe("line-2\nline-3\n")
          })
        )
      })
    ))
})
