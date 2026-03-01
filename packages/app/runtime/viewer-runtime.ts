import { createReadStream } from "node:fs"
import { open } from "node:fs/promises"

import iconv from "iconv-lite"
import jschardet from "jschardet"

import type { ViewerOptions, ViewResult } from "../src/core/types.js"

const SAMPLE_SIZE = 64 * 1024
const MIN_CONFIDENCE = 0.2
const SAFETY_MARGIN_BYTES = 1 * 1024 * 1024

const normalizeEncoding = (encoding: string): string =>
  encoding
    .trim()
    .toLowerCase()
    .replaceAll("_", "-")

const mapDetectedEncoding = (detected: string): string => {
  const normalized = normalizeEncoding(detected)

  if (normalized === "ascii" || normalized === "utf8" || normalized === "utf-8") {
    return "utf8"
  }

  if (normalized === "utf-16") {
    return "utf16le"
  }

  return normalized
}

const detectBomEncoding = (sample: Buffer): string | undefined => {
  if (sample.length >= 3 && sample[0] === 0xef && sample[1] === 0xbb && sample[2] === 0xbf) {
    return "utf8"
  }

  if (
    sample.length >= 4 &&
    sample[0] === 0x00 &&
    sample[1] === 0x00 &&
    sample[2] === 0xfe &&
    sample[3] === 0xff
  ) {
    return "utf32be"
  }

  if (
    sample.length >= 4 &&
    sample[0] === 0xff &&
    sample[1] === 0xfe &&
    sample[2] === 0x00 &&
    sample[3] === 0x00
  ) {
    return "utf32le"
  }

  if (sample.length >= 2 && sample[0] === 0xff && sample[1] === 0xfe) {
    return "utf16le"
  }

  if (sample.length >= 2 && sample[0] === 0xfe && sample[1] === 0xff) {
    return "utf16be"
  }

  return undefined
}

const readSample = async (filePath: string, sampleSize: number): Promise<Buffer> => {
  const handle = await open(filePath, "r")

  try {
    const buffer = Buffer.allocUnsafe(sampleSize)
    const result = await handle.read(buffer, 0, sampleSize, 0)
    return result.bytesRead === buffer.length ? buffer : buffer.subarray(0, result.bytesRead)
  } finally {
    await handle.close()
  }
}

const detectHeuristicEncoding = (sample: Buffer): string | undefined => {
  const detection = jschardet.detect(sample)

  if (detection.encoding === undefined) {
    return undefined
  }

  if ((detection.confidence ?? 0) < MIN_CONFIDENCE) {
    return undefined
  }

  const mapped = mapDetectedEncoding(detection.encoding)
  return iconv.encodingExists(mapped) ? mapped : undefined
}

const ensureSupportedEncoding = (encoding: string): string => {
  const normalized = normalizeEncoding(encoding)
  if (!iconv.encodingExists(normalized)) {
    throw new Error(`Unsupported encoding: ${encoding}`)
  }

  return normalized
}

const resolveEncoding = async (params: {
  readonly filePath: string
  readonly explicitEncoding: string | undefined
  readonly autoDetectEncoding: boolean
}): Promise<string> => {
  if (params.explicitEncoding !== undefined) {
    return ensureSupportedEncoding(params.explicitEncoding)
  }

  if (!params.autoDetectEncoding) {
    return "utf8"
  }

  const sample = await readSample(params.filePath, SAMPLE_SIZE)
  const bomEncoding = detectBomEncoding(sample)
  if (bomEncoding !== undefined && iconv.encodingExists(bomEncoding)) {
    return bomEncoding
  }

  const detectedEncoding = detectHeuristicEncoding(sample)
  if (detectedEncoding !== undefined) {
    return detectedEncoding
  }

  return "utf8"
}

const stripCarriageReturn = (line: string): string =>
  line.endsWith("\r") ? line.slice(0, Math.max(line.length - 1, 0)) : line

const splitLines = (text: string): ReadonlyArray<string> => {
  const rawLines = text.split("\n").map((line) => stripCarriageReturn(line))

  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
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
    for (let index = 0; index < haystack.length; index += 1) {
      if (haystack[index] === byte) {
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

const newlinePatternForEncoding = (encoding: string): Buffer => {
  const normalized = normalizeEncoding(encoding).replaceAll("-", "")

  if (normalized === "utf16le" || normalized === "ucs2" || normalized === "ucs2le") {
    return Buffer.from([0x0a, 0x00])
  }

  if (normalized === "utf16be" || normalized === "ucs2be") {
    return Buffer.from([0x00, 0x0a])
  }

  if (normalized === "utf32le") {
    return Buffer.from([0x0a, 0x00, 0x00, 0x00])
  }

  if (normalized === "utf32be") {
    return Buffer.from([0x00, 0x00, 0x00, 0x0a])
  }

  return Buffer.from([0x0a])
}

const viewForward = async (
  options: ViewerOptions,
  encoding: string,
  write: (chunk: string) => void
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
        write(`${line}\n`)
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
    write(`${stripCarriageReturn(carry)}\n`)
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
  write: (chunk: string) => void
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
    const bufferedChunks: Buffer[] = []
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

    const merged =
      bufferedChunks.length === 0
        ? Buffer.alloc(0)
        : bufferedChunks.length === 1
          ? bufferedChunks[0]!
          : Buffer.concat(bufferedChunks)
    const decoded = iconv.decode(merged, encoding)
    const lines = splitLines(decoded)
    const startIndex = Math.max(lines.length - options.lines, 0)
    const selected = lines.slice(startIndex)

    for (const line of selected) {
      write(`${line}\n`)
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

export const viewFileRuntime = async (
  options: ViewerOptions,
  write: (chunk: string) => void
): Promise<ViewResult> => {
  const encoding = await resolveEncoding({
    filePath: options.filePath,
    explicitEncoding: options.explicitEncoding,
    autoDetectEncoding: options.autoDetectEncoding
  })

  return options.tail
    ? viewTail(options, encoding, write)
    : viewForward(options, encoding, write)
}
