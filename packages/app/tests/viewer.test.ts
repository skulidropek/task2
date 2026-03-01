import { describe, expect, it } from "@effect/vitest"
import { Effect, pipe } from "effect"
import iconv from "iconv-lite"

import type { OutputSink } from "../src/core/types.js"
import { viewFile } from "../src/core/viewer.js"
import { withTempFile } from "./support/temp-file.js"

const createCollector = (): {
  readonly sink: OutputSink
  readonly output: () => string
} => {
  let buffer = ""

  return {
    sink: {
      write: (chunk: string) => {
        buffer += chunk
      }
    },
    output: () => buffer
  }
}

const runViewFile = (
  filePath: string,
  sink: OutputSink,
  options: {
    readonly lines: number
    readonly from: number
    readonly tail: boolean
    readonly explicitEncoding: string | undefined
    readonly autoDetectEncoding: boolean
    readonly chunkSizeBytes: number
    readonly memoryLimitBytes: number
  }
) =>
  viewFile(
    {
      filePath,
      lines: options.lines,
      from: options.from,
      tail: options.tail,
      explicitEncoding: options.explicitEncoding,
      autoDetectEncoding: options.autoDetectEncoding,
      chunkSizeBytes: options.chunkSizeBytes,
      memoryLimitBytes: options.memoryLimitBytes
    },
    sink
  )

type RunViewFileOptions = Parameters<typeof runViewFile>[2]

const defaultRunOptions: RunViewFileOptions = {
  lines: 1,
  from: 1,
  tail: false,
  explicitEncoding: undefined,
  autoDetectEncoding: true,
  chunkSizeBytes: 8 * 1024,
  memoryLimitBytes: 10 * 1024 * 1024
}

const mergeRunOptions = (
  overrides: Partial<RunViewFileOptions>
): RunViewFileOptions => ({
  ...defaultRunOptions,
  ...overrides
})

const runCase = (
  filePath: string,
  options: RunViewFileOptions
) =>
  Effect.gen(function*(_) {
    const collected = createCollector()
    const result = yield* _(runViewFile(filePath, collected.sink, options))

    return {
      output: collected.output(),
      result
    }
  })

describe("viewFile", () => {
  it.effect("prints selected line range in forward mode", () =>
    Effect.scoped(
      Effect.gen(function*(_) {
        const lines = Array.from({ length: 200 }, (_, index) => `line-${index + 1}`).join("\n")
        const filePath = yield* _(withTempFile("viewer-tests", "range.txt", `${lines}\n`))
        const outcome = yield* _(runCase(filePath, mergeRunOptions({ lines: 3, from: 120 })))

        yield* _(
          Effect.sync(() => {
            expect(outcome.output).toBe("line-120\nline-121\nline-122\n")
            expect(outcome.result.mode).toBe("forward")
            expect(outcome.result.linesPrinted).toBe(3)
          })
        )
      })
    ))

  it.effect("prints tail lines and avoids full-file scan", () =>
    Effect.scoped(
      Effect.gen(function*(_) {
        const lines = Array.from({ length: 20_000 }, (_, index) => `row-${index + 1}`)
        const filePath = yield* _(
          withTempFile("viewer-tests", "tail.txt", `${lines.join("\n")}\n`)
        )
        const outcome = yield* _(
          runCase(
            filePath,
            mergeRunOptions({
              lines: 4,
              tail: true,
              explicitEncoding: "utf8",
              autoDetectEncoding: false,
              chunkSizeBytes: 32 * 1024
            })
          )
        )

        yield* _(
          Effect.sync(() => {
            expect(outcome.output).toBe("row-19997\nrow-19998\nrow-19999\nrow-20000\n")
            expect(outcome.result.mode).toBe("tail")
            expect(outcome.result.bytesRead).toBeLessThan(300_000)
          })
        )
      })
    ))

  it.effect("reads explicit windows-1251 encoding", () =>
    Effect.scoped(
      Effect.gen(function*(_) {
        const text = "Привет\nМир\nТест\n"
        const encoded = iconv.encode(text, "windows-1251")
        const filePath = yield* _(withTempFile("viewer-tests", "cp1251.txt", encoded))
        const outcome = yield* _(
          runCase(
            filePath,
            mergeRunOptions({
              lines: 2,
              explicitEncoding: "windows-1251",
              chunkSizeBytes: 4 * 1024
            })
          )
        )

        yield* _(
          Effect.sync(() => {
            expect(outcome.output).toBe("Привет\nМир\n")
            expect(outcome.result.encoding).toBe("windows-1251")
          })
        )
      })
    ))

  it.effect("fails when tail cannot fit inside memory budget", () =>
    Effect.scoped(
      Effect.gen(function*(_) {
        const filePath = yield* _(
          withTempFile("viewer-tests", "long-line.txt", "x".repeat(2_200_000))
        )
        const failure = yield* _(
          pipe(
            runCase(
              filePath,
              mergeRunOptions({
                tail: true,
                explicitEncoding: "utf8",
                autoDetectEncoding: false,
                chunkSizeBytes: 128 * 1024,
                memoryLimitBytes: 2 * 1024 * 1024
              })
            ),
            Effect.flip
          )
        )

        yield* _(
          Effect.sync(() => {
            expect(failure.message).toContain("Cannot collect enough trailing lines")
          })
        )
      })
    ))
})
