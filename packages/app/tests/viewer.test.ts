import { mkdtemp, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"

import iconv from "iconv-lite"
import { afterEach, describe, expect, it } from "vitest"

import { viewFile } from "../src/core/viewer.js"
import type { OutputSink } from "../src/core/types.js"

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

let tempDir: string | undefined

afterEach(async () => {
  if (tempDir !== undefined) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = undefined
  }
})

const createTempFile = async (
  fileName: string,
  content: string | Buffer
): Promise<string> => {
  tempDir = await mkdtemp(path.join(tmpdir(), "viewer-tests-"))
  const target = path.join(tempDir, fileName)
  await writeFile(target, content)
  return target
}

describe("viewFile", () => {
  it("prints selected line range in forward mode", async () => {
    const lines = Array.from({ length: 200 }, (_, index) => `line-${index + 1}`).join("\n")
    const filePath = await createTempFile("range.txt", `${lines}\n`)

    const collected = createCollector()

    const result = await viewFile(
      {
        filePath,
        lines: 3,
        from: 120,
        tail: false,
        explicitEncoding: undefined,
        autoDetectEncoding: true,
        chunkSizeBytes: 8 * 1024,
        memoryLimitBytes: 10 * 1024 * 1024
      },
      collected.sink
    )

    expect(collected.output()).toBe("line-120\nline-121\nline-122\n")
    expect(result.mode).toBe("forward")
    expect(result.linesPrinted).toBe(3)
  })

  it("prints tail lines and avoids full-file scan", async () => {
    const lines = Array.from({ length: 20000 }, (_, index) => `row-${index + 1}`)
    const filePath = await createTempFile("tail.txt", `${lines.join("\n")}\n`)

    const collected = createCollector()

    const result = await viewFile(
      {
        filePath,
        lines: 4,
        from: 1,
        tail: true,
        explicitEncoding: "utf8",
        autoDetectEncoding: false,
        chunkSizeBytes: 32 * 1024,
        memoryLimitBytes: 10 * 1024 * 1024
      },
      collected.sink
    )

    expect(collected.output()).toBe("row-19997\nrow-19998\nrow-19999\nrow-20000\n")
    expect(result.mode).toBe("tail")
    expect(result.bytesRead).toBeLessThan(300_000)
  })

  it("reads explicit windows-1251 encoding", async () => {
    const text = "Привет\nМир\nТест\n"
    const encoded = iconv.encode(text, "windows-1251")
    const filePath = await createTempFile("cp1251.txt", encoded)

    const collected = createCollector()

    const result = await viewFile(
      {
        filePath,
        lines: 2,
        from: 1,
        tail: false,
        explicitEncoding: "windows-1251",
        autoDetectEncoding: true,
        chunkSizeBytes: 4 * 1024,
        memoryLimitBytes: 10 * 1024 * 1024
      },
      collected.sink
    )

    expect(collected.output()).toBe("Привет\nМир\n")
    expect(result.encoding).toBe("windows-1251")
  })

  it("fails when tail cannot fit inside memory budget", async () => {
    const filePath = await createTempFile("long-line.txt", "x".repeat(2_200_000))

    const collected = createCollector()

    await expect(
      viewFile(
        {
          filePath,
          lines: 1,
          from: 1,
          tail: true,
          explicitEncoding: "utf8",
          autoDetectEncoding: false,
          chunkSizeBytes: 128 * 1024,
          memoryLimitBytes: 2 * 1024 * 1024
        },
        collected.sink
      )
    ).rejects.toThrow("Cannot collect enough trailing lines")
  })
})
