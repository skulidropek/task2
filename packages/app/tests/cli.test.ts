import { describe, expect, it } from "vitest"

import { DEFAULT_CHUNK_SIZE_KB, DEFAULT_LINES, MEMORY_LIMIT_BYTES } from "../src/core/types.js"
import { parseCliArgs } from "../src/shell/cli.js"

describe("parseCliArgs", () => {
  it("parses defaults in forward mode", () => {
    const result = parseCliArgs(["./file.txt"])

    expect(result.kind).toBe("run")
    if (result.kind === "run") {
      expect(result.options.filePath).toBe("./file.txt")
      expect(result.options.lines).toBe(DEFAULT_LINES)
      expect(result.options.tail).toBe(false)
      expect(result.options.chunkSizeBytes).toBe(DEFAULT_CHUNK_SIZE_KB * 1024)
      expect(result.options.memoryLimitBytes).toBe(MEMORY_LIMIT_BYTES)
    }
  })

  it("parses tail mode and encoding", () => {
    const result = parseCliArgs([
      "./log.txt",
      "--tail",
      "--lines",
      "250",
      "--encoding",
      "windows-1251"
    ])

    expect(result.kind).toBe("run")
    if (result.kind === "run") {
      expect(result.options.tail).toBe(true)
      expect(result.options.lines).toBe(250)
      expect(result.options.explicitEncoding).toBe("windows-1251")
    }
  })

  it("returns help for --help", () => {
    const result = parseCliArgs(["--help"])
    expect(result).toEqual({ kind: "help" })
  })

  it("fails on unknown option", () => {
    expect(() => parseCliArgs(["./file.txt", "--wat"])).toThrow(
      "Unknown option: --wat"
    )
  })
})
