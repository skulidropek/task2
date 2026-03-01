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

interface ParseState {
  readonly filePath: string | undefined
  readonly lines: number
  readonly from: number
  readonly tail: boolean
  readonly explicitEncoding: string | undefined
  readonly autoDetectEncoding: boolean
  readonly chunkSizeKb: number
}

const initialState: ParseState = {
  filePath: undefined,
  lines: DEFAULT_LINES,
  from: DEFAULT_FROM,
  tail: false,
  explicitEncoding: undefined,
  autoDetectEncoding: true,
  chunkSizeKb: DEFAULT_CHUNK_SIZE_KB
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

const parseToggleFlag = (
  arg: string,
  state: ParseState
): ParseState | undefined => {
  if (arg === "--tail") {
    return { ...state, tail: true }
  }

  if (arg === "--no-auto-encoding") {
    return { ...state, autoDetectEncoding: false }
  }

  if (arg === "--auto-encoding") {
    return { ...state, autoDetectEncoding: true }
  }

  return undefined
}

interface ValueFlagParser {
  readonly matches: (arg: string) => boolean
  readonly apply: (
    args: ReadonlyArray<string>,
    index: number,
    state: ParseState
  ) => {
    readonly state: ParseState
    readonly nextIndex: number
  }
}

const linesFlagParser: ValueFlagParser = {
  matches: (arg) => arg === "--lines" || arg.startsWith("--lines="),
  apply: (args, index, state) => {
    const extracted = extractFlagValue(args, index, "--lines")
    return {
      state: { ...state, lines: parsePositiveInt(extracted.value, "--lines") },
      nextIndex: extracted.nextIndex + 1
    }
  }
}

const fromFlagParser: ValueFlagParser = {
  matches: (arg) => arg === "--from" || arg.startsWith("--from="),
  apply: (args, index, state) => {
    const extracted = extractFlagValue(args, index, "--from")
    return {
      state: { ...state, from: parsePositiveInt(extracted.value, "--from") },
      nextIndex: extracted.nextIndex + 1
    }
  }
}

const encodingFlagParser: ValueFlagParser = {
  matches: (arg) => arg === "--encoding" || arg.startsWith("--encoding="),
  apply: (args, index, state) => {
    const extracted = extractFlagValue(args, index, "--encoding")
    return {
      state: { ...state, explicitEncoding: extracted.value },
      nextIndex: extracted.nextIndex + 1
    }
  }
}

const chunkFlagParser: ValueFlagParser = {
  matches: (arg) => arg === "--chunk-kb" || arg.startsWith("--chunk-kb="),
  apply: (args, index, state) => {
    const extracted = extractFlagValue(args, index, "--chunk-kb")
    return {
      state: { ...state, chunkSizeKb: parsePositiveInt(extracted.value, "--chunk-kb") },
      nextIndex: extracted.nextIndex + 1
    }
  }
}

const valueFlagParsers: ReadonlyArray<ValueFlagParser> = [
  linesFlagParser,
  fromFlagParser,
  encodingFlagParser,
  chunkFlagParser
]

const parseValueFlag = (
  args: ReadonlyArray<string>,
  index: number,
  state: ParseState
): {
  readonly state: ParseState
  readonly nextIndex: number
} | undefined => {
  const arg = args[index]
  if (arg === undefined) {
    return undefined
  }

  const parser = valueFlagParsers.find((candidate) => candidate.matches(arg))
  if (parser !== undefined) {
    return parser.apply(args, index, state)
  }

  return undefined
}

const applyPositional = (arg: string, state: ParseState): ParseState => {
  if (state.filePath === undefined) {
    return { ...state, filePath: arg }
  }

  throw new Error(`Unexpected positional argument: ${arg}`)
}

const toViewerOptions = (state: ParseState): ViewerOptions => {
  if (state.filePath === undefined) {
    throw new Error("File path is required")
  }

  const chunkSizeBytes = state.chunkSizeKb * 1024
  if (chunkSizeBytes >= MEMORY_LIMIT_BYTES) {
    throw new Error("--chunk-kb must be smaller than memory limit")
  }

  return {
    filePath: state.filePath,
    lines: state.lines,
    from: state.from,
    tail: state.tail,
    explicitEncoding: state.explicitEncoding,
    autoDetectEncoding: state.autoDetectEncoding,
    chunkSizeBytes,
    memoryLimitBytes: MEMORY_LIMIT_BYTES
  }
}

const parseLoopStep = (
  args: ReadonlyArray<string>,
  index: number,
  state: ParseState
): {
  readonly command: CliCommand | undefined
  readonly state: ParseState
  readonly nextIndex: number
} => {
  const arg = args[index]
  if (arg === undefined) {
    return {
      command: undefined,
      state,
      nextIndex: index + 1
    }
  }

  if (arg === "--help" || arg === "-h") {
    return {
      command: { kind: "help" },
      state,
      nextIndex: index + 1
    }
  }

  const toggled = parseToggleFlag(arg, state)
  if (toggled !== undefined) {
    return {
      command: undefined,
      state: toggled,
      nextIndex: index + 1
    }
  }

  const parsedValue = parseValueFlag(args, index, state)
  if (parsedValue !== undefined) {
    return {
      command: undefined,
      state: parsedValue.state,
      nextIndex: parsedValue.nextIndex
    }
  }

  if (arg.startsWith("--")) {
    throw new Error(`Unknown option: ${arg}`)
  }

  return {
    command: undefined,
    state: applyPositional(arg, state),
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

  let index = 0
  let state = initialState

  while (index < args.length) {
    const nextStep = parseLoopStep(args, index, state)
    if (nextStep.command !== undefined) {
      return nextStep.command
    }

    state = nextStep.state
    index = nextStep.nextIndex
  }

  return {
    kind: "run",
    options: toViewerOptions(state)
  }
}
