import {
  DEFAULT_CHUNK_SIZE_KB,
  DEFAULT_FROM,
  DEFAULT_LINES,
  MEMORY_LIMIT_BYTES,
  type ViewerOptions
} from "../core/types.js"

export type CliCommand =
  | {
    readonly kind: "help"
  }
  | {
    readonly kind: "run"
    readonly options: ViewerOptions
  }

const parsePositiveInt = (raw: string, flag: string): number => {
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`)
  }

  return parsed
}

const extractFlagValue = (
  args: ReadonlyArray<string>,
  index: number,
  name: string
): {
  readonly value: string
  readonly nextIndex: number
} => {
  const arg = args[index]
  if (arg === undefined) {
    throw new Error(`${name} requires a value`)
  }
  const prefix = `${name}=`

  if (arg.startsWith(prefix)) {
    return {
      value: arg.slice(prefix.length),
      nextIndex: index
    }
  }

  const value = args[index + 1]
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`)
  }

  return {
    value,
    nextIndex: index + 1
  }
}

export const printHelp = (): string =>
  `Usage:
  viewer <file-path> [--from <line>] [--lines <count>] [--tail] [--encoding <name>] [--no-auto-encoding] [--chunk-kb <size>]

Options:
  --from <line>         First line to print in forward mode (1-based, default: ${DEFAULT_FROM})
  --lines <count>       Number of lines to print (default: ${DEFAULT_LINES})
  --tail                Print last N lines with minimized disk reads
  --encoding <name>     Force text encoding (iconv-lite names)
  --no-auto-encoding    Disable heuristic auto detection and use UTF-8 when encoding isn't passed
  --chunk-kb <size>     Read chunk size in KB (default: ${DEFAULT_CHUNK_SIZE_KB})
  --help, -h            Show this help message
`

export const parseCliArgs = (args: ReadonlyArray<string>): CliCommand => {
  if (args.length === 0) {
    return { kind: "help" }
  }

  let filePath: string | undefined
  let lines = DEFAULT_LINES
  let from = DEFAULT_FROM
  let tail = false
  let explicitEncoding: string | undefined
  let autoDetectEncoding = true
  let chunkSizeKb = DEFAULT_CHUNK_SIZE_KB

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === undefined) {
      continue
    }

    if (arg === "--help" || arg === "-h") {
      return { kind: "help" }
    }

    if (arg === "--tail") {
      tail = true
      continue
    }

    if (arg === "--no-auto-encoding") {
      autoDetectEncoding = false
      continue
    }

    if (arg === "--auto-encoding") {
      autoDetectEncoding = true
      continue
    }

    if (arg === "--lines" || arg.startsWith("--lines=")) {
      const extracted = extractFlagValue(args, index, "--lines")
      lines = parsePositiveInt(extracted.value, "--lines")
      index = extracted.nextIndex
      continue
    }

    if (arg === "--from" || arg.startsWith("--from=")) {
      const extracted = extractFlagValue(args, index, "--from")
      from = parsePositiveInt(extracted.value, "--from")
      index = extracted.nextIndex
      continue
    }

    if (arg === "--encoding" || arg.startsWith("--encoding=")) {
      const extracted = extractFlagValue(args, index, "--encoding")
      explicitEncoding = extracted.value
      index = extracted.nextIndex
      continue
    }

    if (arg === "--chunk-kb" || arg.startsWith("--chunk-kb=")) {
      const extracted = extractFlagValue(args, index, "--chunk-kb")
      chunkSizeKb = parsePositiveInt(extracted.value, "--chunk-kb")
      index = extracted.nextIndex
      continue
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`)
    }

    if (filePath === undefined) {
      filePath = arg
      continue
    }

    throw new Error(`Unexpected positional argument: ${arg}`)
  }

  if (filePath === undefined) {
    throw new Error("File path is required")
  }

  const chunkSizeBytes = chunkSizeKb * 1024
  if (chunkSizeBytes >= MEMORY_LIMIT_BYTES) {
    throw new Error("--chunk-kb must be smaller than memory limit")
  }

  const options: ViewerOptions = {
    filePath,
    lines,
    from,
    tail,
    explicitEncoding,
    autoDetectEncoding,
    chunkSizeBytes,
    memoryLimitBytes: MEMORY_LIMIT_BYTES
  }

  return {
    kind: "run",
    options
  }
}
