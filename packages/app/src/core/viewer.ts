import { createReadStream } from "node:fs"
import { open } from "node:fs/promises"

import iconv from "iconv-lite"

import { newlinePatternForEncoding, resolveEncoding } from "./encoding.js"
import type { OutputSink, ViewerOptions, ViewResult } from "./types.js"

const SAFETY_MARGIN_BYTES = 1 * 1024 * 1024

const writeLine = async (output: OutputSink, line: string): Promise<void> => {
  await output.write(`${line}\n`)
}

const stripCarriageReturn = (line: string): string =>
  line.endsWith("\r") ? line.slice(0, Math.max(line.length - 1, 0)) : line

const splitLines = (text: string): ReadonlyArray<string> => {
  const rawLines = text.split("\n").map((line) => stripCarriageReturn(line))

  if (rawLines.length > 0 && rawLines.at(-1) === "") {
    return rawLines.slice(0, Math.max(rawLines.length - 1, 0))
  }

  return rawLines
}

const ensureCarryWithinLimit = (carry: string, options: ViewerOptions): void => {
  const softLimit = options.memoryLimitBytes - options.chunkSizeBytes - SAFETY_MARGIN_BYTES

  if (softLimit <= 0) {
    throw new Error("Invalid memory/chunk configuration")
  }

  if (Buffer.byteLength(carry, "utf8") > softLimit) {
    throw new Error(
      `A single logical line is too large for memory limit ${options.memoryLimitBytes} bytes`
    )
  }
}

const countPattern = (haystack: Buffer, needle: Buffer): number => {
  if (needle.length === 0 || haystack.length < needle.length) {
    return 0
  }

  if (needle.length === 1) {
    let count = 0
    const byte = needle[0]
    for (const element of haystack) {
      if (element === byte) {
        count += 1
      }
    }

    return count
  }

  let count = 0
  for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    let matches = true
    for (let needleIndex = 0; needleIndex < needle.length; needleIndex += 1) {
      if (haystack[index + needleIndex] !== needle[needleIndex]) {
        matches = false
        break
      }
    }

    if (matches) {
      count += 1
    }
  }

  return count
}

const countBoundaryPattern = (left: Buffer, rightPrefix: Buffer, needle: Buffer): number => {
  if (needle.length <= 1 || rightPrefix.length === 0 || left.length === 0) {
    return 0
  }

  const overlap = needle.length - 1
  const leftSuffix = left.subarray(Math.max(0, left.length - overlap))
  const bridge = Buffer.concat([leftSuffix, rightPrefix])
  const splitIndex = leftSuffix.length

  let count = 0

  for (let index = 0; index <= bridge.length - needle.length; index += 1) {
    const crossesBoundary = index < splitIndex && index + needle.length > splitIndex
    if (!crossesBoundary) {
      continue
    }

    let matches = true
    for (let needleIndex = 0; needleIndex < needle.length; needleIndex += 1) {
      if (bridge[index + needleIndex] !== needle[needleIndex]) {
        matches = false
        break
      }
    }

    if (matches) {
      count += 1
    }
  }

  return count
}

const viewForward = async (
  options: ViewerOptions,
  encoding: string,
  output: OutputSink
): Promise<ViewResult> => {
  let bytesRead = 0
  let currentLine = 1
  let linesPrinted = 0
  let carry = ""

  const stream = createReadStream(options.filePath, {
    highWaterMark: options.chunkSizeBytes
  })

  stream.on("data", (chunk: string | Buffer) => {
    bytesRead += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length
  })

  const decoded = stream.pipe(iconv.decodeStream(encoding))

  for await (const chunk of decoded) {
    const combined = `${carry}${String(chunk)}`
    let lineStart = 0
    let nextLineBreak = combined.indexOf("\n", lineStart)

    while (nextLineBreak !== -1) {
      const line = stripCarriageReturn(combined.slice(lineStart, nextLineBreak))

      if (currentLine >= options.from && linesPrinted < options.lines) {
        await writeLine(output, line)
        linesPrinted += 1

        if (linesPrinted >= options.lines) {
          stream.destroy()
          return {
            mode: "forward",
            encoding,
            linesPrinted,
            bytesRead
          }
        }
      }

      currentLine += 1
      lineStart = nextLineBreak + 1
      nextLineBreak = combined.indexOf("\n", lineStart)
    }

    carry = combined.slice(lineStart)
    ensureCarryWithinLimit(carry, options)
  }

  if (carry.length > 0 && currentLine >= options.from && linesPrinted < options.lines) {
    await writeLine(output, stripCarriageReturn(carry))
    linesPrinted += 1
  }

  return {
    mode: "forward",
    encoding,
    linesPrinted,
    bytesRead
  }
}

const viewTail = async (
  options: ViewerOptions,
  encoding: string,
  output: OutputSink
): Promise<ViewResult> => {
  const handle = await open(options.filePath, "r")
  const newlinePattern = newlinePatternForEncoding(encoding)
  const memoryBudgetForTail = options.memoryLimitBytes - options.chunkSizeBytes - SAFETY_MARGIN_BYTES

  if (memoryBudgetForTail <= 0) {
    throw new Error("Invalid memory/chunk configuration")
  }

  try {
    const stats = await handle.stat()
    let offset = stats.size
    let bytesRead = 0
    let bufferedBytes = 0
    let newlineCount = 0
    const bufferedChunks: Array<Buffer> = []
    let nextChunkPrefix = Buffer.alloc(0)

    while (offset > 0 && newlineCount <= options.lines) {
      const readSize = Math.min(options.chunkSizeBytes, offset)
      const readOffset = offset - readSize
      const chunk = Buffer.allocUnsafe(readSize)
      const result = await handle.read(chunk, 0, readSize, readOffset)
      const data = result.bytesRead === chunk.length ? chunk : chunk.subarray(0, result.bytesRead)

      bytesRead += data.length
      bufferedBytes += data.length
      offset = readOffset

      newlineCount += countPattern(data, newlinePattern)
      newlineCount += countBoundaryPattern(data, nextChunkPrefix, newlinePattern)

      const prefixLength = Math.min(Math.max(newlinePattern.length - 1, 0), data.length)
      nextChunkPrefix = data.subarray(0, prefixLength)

      bufferedChunks.unshift(data)

      if (bufferedBytes > memoryBudgetForTail && offset > 0 && newlineCount <= options.lines) {
        throw new Error(
          `Cannot collect enough trailing lines inside memory budget ${options.memoryLimitBytes} bytes`
        )
      }
    }

    const merged = bufferedChunks.length === 0
      ? Buffer.alloc(0)
      : (bufferedChunks.length === 1
        ? bufferedChunks[0]!
        : Buffer.concat(bufferedChunks))
    const decoded = iconv.decode(merged, encoding)
    const lines = splitLines(decoded)
    const startIndex = Math.max(lines.length - options.lines, 0)
    const selected = lines.slice(startIndex)

    for (const line of selected) {
      await writeLine(output, line)
    }

    return {
      mode: "tail",
      encoding,
      linesPrinted: selected.length,
      bytesRead
    }
  } finally {
    await handle.close()
  }
}

export const viewFile = async (options: ViewerOptions, output: OutputSink): Promise<ViewResult> => {
  const encoding = await resolveEncoding({
    filePath: options.filePath,
    explicitEncoding: options.explicitEncoding,
    autoDetectEncoding: options.autoDetectEncoding
  })

  if (options.tail) {
    return viewTail(options, encoding, output)
  }

  return viewForward(options, encoding, output)
}
