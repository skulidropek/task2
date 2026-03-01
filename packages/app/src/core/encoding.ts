import { open } from "node:fs/promises"

import iconv from "iconv-lite"
import jschardet from "jschardet"

const SAMPLE_SIZE = 64 * 1024
const MIN_CONFIDENCE = 0.2

const normalizeEncoding = (encoding: string): string =>
  encoding
    .trim()
    .toLowerCase()
    .replaceAll("_", "-")

const mapDetectedEncoding = (detected: string): string => {
  const normalized = normalizeEncoding(detected)

  if (normalized === "ascii") {
    return "utf8"
  }

  if (normalized === "utf-8") {
    return "utf8"
  }

  if (normalized === "utf-16") {
    return "utf16le"
  }

  return normalized
}

const detectBomEncoding = (sample: Buffer): string | undefined => {
  if (sample.length >= 3 && sample[0] === 0xEF && sample[1] === 0xBB && sample[2] === 0xBF) {
    return "utf8"
  }

  if (sample.length >= 4 && sample[0] === 0x00 && sample[1] === 0x00 && sample[2] === 0xFE && sample[3] === 0xFF) {
    return "utf32be"
  }

  if (sample.length >= 4 && sample[0] === 0xFF && sample[1] === 0xFE && sample[2] === 0x00 && sample[3] === 0x00) {
    return "utf32le"
  }

  if (sample.length >= 2 && sample[0] === 0xFF && sample[1] === 0xFE) {
    return "utf16le"
  }

  if (sample.length >= 2 && sample[0] === 0xFE && sample[1] === 0xFF) {
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
  const detection = jschardet.detect(sample) as {
    readonly encoding?: string
    readonly confidence?: number
  }

  if (detection.encoding === undefined) {
    return undefined
  }

  const confidence = detection.confidence ?? 0
  if (confidence < MIN_CONFIDENCE) {
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

export const resolveEncoding = async (params: {
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

export const newlinePatternForEncoding = (encoding: string): Buffer => {
  const normalized = normalizeEncoding(encoding).replaceAll("-", "")

  if (normalized === "utf16le" || normalized === "ucs2" || normalized === "ucs2le") {
    return Buffer.from([0x0A, 0x00])
  }

  if (normalized === "utf16be" || normalized === "ucs2be") {
    return Buffer.from([0x00, 0x0A])
  }

  if (normalized === "utf32le") {
    return Buffer.from([0x0A, 0x00, 0x00, 0x00])
  }

  if (normalized === "utf32be") {
    return Buffer.from([0x00, 0x00, 0x00, 0x0A])
  }

  return Buffer.from([0x0A])
}
