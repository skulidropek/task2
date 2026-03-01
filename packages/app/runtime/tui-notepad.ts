import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import type { NotepadOptions, NotepadResult } from "../src/core/types.js"

interface EditorState {
  readonly lines: ReadonlyArray<string>
  readonly cursorRow: number
  readonly cursorCol: number
  readonly scrollRow: number
  readonly filePath: string | undefined
  readonly status: string
  readonly dirty: boolean
  readonly pendingQuit: boolean
}

const CTRL_C = "\u0003"
const CTRL_Q = "\u0011"
const CTRL_S = "\u0013"
const ENTER = "\r"
const BACKSPACE = "\u007f"

const ESCAPE_SEQUENCES = [
  "\u001b[A",
  "\u001b[B",
  "\u001b[C",
  "\u001b[D",
  "\u001b[H",
  "\u001b[F",
  "\u001b[3~"
] as const

const DEFAULT_FILENAME = "tui-notepad.txt"
const INITIAL_STATUS = "Ctrl+S save | Ctrl+Q quit | Arrows move cursor"

const normalizeLoadedLines = (text: string): ReadonlyArray<string> => {
  const normalized = text.replaceAll("\r\n", "\n")
  const lines = normalized.split("\n")
  return lines.length === 0 ? [""] : lines
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

const lineAt = (state: EditorState, index: number): string => state.lines[index] ?? ""

const toInitialState = (options: NotepadOptions): EditorState => {
  if (options.filePath === undefined) {
    return {
      lines: [""],
      cursorRow: 0,
      cursorCol: 0,
      scrollRow: 0,
      filePath: undefined,
      status: INITIAL_STATUS,
      dirty: false,
      pendingQuit: false
    }
  }

  const absolutePath = resolve(process.cwd(), options.filePath)
  if (!existsSync(absolutePath)) {
    return {
      lines: [""],
      cursorRow: 0,
      cursorCol: 0,
      scrollRow: 0,
      filePath: absolutePath,
      status: `New file: ${absolutePath}`,
      dirty: false,
      pendingQuit: false
    }
  }

  const loaded = readFileSync(absolutePath, "utf8")
  return {
    lines: normalizeLoadedLines(loaded),
    cursorRow: 0,
    cursorCol: 0,
    scrollRow: 0,
    filePath: absolutePath,
    status: `Opened: ${absolutePath}`,
    dirty: false,
    pendingQuit: false
  }
}

const withCursorColClamped = (state: EditorState): EditorState => ({
  ...state,
  cursorCol: clamp(state.cursorCol, 0, lineAt(state, state.cursorRow).length)
})

const moveCursorUp = (state: EditorState): EditorState => {
  const next = {
    ...state,
    cursorRow: clamp(state.cursorRow - 1, 0, Math.max(state.lines.length - 1, 0))
  }
  return withCursorColClamped(next)
}

const moveCursorDown = (state: EditorState): EditorState => {
  const next = {
    ...state,
    cursorRow: clamp(state.cursorRow + 1, 0, Math.max(state.lines.length - 1, 0))
  }
  return withCursorColClamped(next)
}

const moveCursorLeft = (state: EditorState): EditorState => {
  if (state.cursorCol > 0) {
    return {
      ...state,
      cursorCol: state.cursorCol - 1
    }
  }

  if (state.cursorRow === 0) {
    return state
  }

  const previousRow = state.cursorRow - 1
  return {
    ...state,
    cursorRow: previousRow,
    cursorCol: lineAt(state, previousRow).length
  }
}

const moveCursorRight = (state: EditorState): EditorState => {
  const currentLine = lineAt(state, state.cursorRow)
  if (state.cursorCol < currentLine.length) {
    return {
      ...state,
      cursorCol: state.cursorCol + 1
    }
  }

  if (state.cursorRow >= state.lines.length - 1) {
    return state
  }

  return {
    ...state,
    cursorRow: state.cursorRow + 1,
    cursorCol: 0
  }
}

const moveCursorHome = (state: EditorState): EditorState => ({
  ...state,
  cursorCol: 0
})

const moveCursorEnd = (state: EditorState): EditorState => ({
  ...state,
  cursorCol: lineAt(state, state.cursorRow).length
})

const withEditMarker = (state: EditorState): EditorState => ({
  ...state,
  dirty: true,
  pendingQuit: false
})

const updateCurrentLine = (state: EditorState, value: string): ReadonlyArray<string> => {
  const next = [...state.lines]
  next[state.cursorRow] = value
  return next
}

const insertCharacter = (state: EditorState, char: string): EditorState => {
  const line = lineAt(state, state.cursorRow)
  const nextLine = `${line.slice(0, state.cursorCol)}${char}${line.slice(state.cursorCol)}`
  return withEditMarker({
    ...state,
    lines: updateCurrentLine(state, nextLine),
    cursorCol: state.cursorCol + char.length
  })
}

const insertNewLine = (state: EditorState): EditorState => {
  const line = lineAt(state, state.cursorRow)
  const before = line.slice(0, state.cursorCol)
  const after = line.slice(state.cursorCol)
  const next = [...state.lines]
  next[state.cursorRow] = before
  next.splice(state.cursorRow + 1, 0, after)

  return withEditMarker({
    ...state,
    lines: next,
    cursorRow: state.cursorRow + 1,
    cursorCol: 0
  })
}

const deleteBackward = (state: EditorState): EditorState => {
  if (state.cursorCol > 0) {
    const line = lineAt(state, state.cursorRow)
    const nextLine = `${line.slice(0, state.cursorCol - 1)}${line.slice(state.cursorCol)}`
    return withEditMarker({
      ...state,
      lines: updateCurrentLine(state, nextLine),
      cursorCol: state.cursorCol - 1
    })
  }

  if (state.cursorRow === 0) {
    return state
  }

  const previousRow = state.cursorRow - 1
  const previousLine = lineAt(state, previousRow)
  const currentLine = lineAt(state, state.cursorRow)
  const next = [...state.lines]
  next[previousRow] = `${previousLine}${currentLine}`
  next.splice(state.cursorRow, 1)

  return withEditMarker({
    ...state,
    lines: next,
    cursorRow: previousRow,
    cursorCol: previousLine.length
  })
}

const deleteForward = (state: EditorState): EditorState => {
  const line = lineAt(state, state.cursorRow)
  if (state.cursorCol < line.length) {
    const nextLine = `${line.slice(0, state.cursorCol)}${line.slice(state.cursorCol + 1)}`
    return withEditMarker({
      ...state,
      lines: updateCurrentLine(state, nextLine)
    })
  }

  if (state.cursorRow >= state.lines.length - 1) {
    return state
  }

  const next = [...state.lines]
  const merged = `${line}${lineAt(state, state.cursorRow + 1)}`
  next[state.cursorRow] = merged
  next.splice(state.cursorRow + 1, 1)

  return withEditMarker({
    ...state,
    lines: next
  })
}

const saveFile = (
  state: EditorState
): {
  readonly state: EditorState
  readonly bytesWritten: number
} => {
  const target = state.filePath ?? resolve(process.cwd(), DEFAULT_FILENAME)
  const content = state.lines.join("\n")
  writeFileSync(target, content, "utf8")
  const bytesWritten = Buffer.byteLength(content, "utf8")

  return {
    state: {
      ...state,
      filePath: target,
      status: `Saved ${bytesWritten} bytes to ${target}`,
      dirty: false,
      pendingQuit: false
    },
    bytesWritten
  }
}

const isPrintable = (key: string): boolean => {
  const codePoint = key.codePointAt(0)
  if (codePoint === undefined) {
    return false
  }

  return codePoint >= 32 && key !== "\u001b"
}

const parseInputKeys = (input: string): ReadonlyArray<string> => {
  const keys: string[] = []
  let index = 0

  while (index < input.length) {
    const remaining = input.slice(index)
    const escapeSequence = ESCAPE_SEQUENCES.find((candidate) =>
      remaining.startsWith(candidate)
    )
    if (escapeSequence !== undefined) {
      keys.push(escapeSequence)
      index += escapeSequence.length
      continue
    }

    const [char] = Array.from(remaining)
    if (char === undefined) {
      break
    }

    keys.push(char)
    index += char.length
  }

  return keys
}

const dimensions = (): {
  readonly width: number
  readonly editorHeight: number
} => {
  const width = Math.max(process.stdout.columns ?? 80, 20)
  const height = Math.max(process.stdout.rows ?? 24, 4)
  return {
    width,
    editorHeight: Math.max(height - 2, 1)
  }
}

const sliceChars = (value: string, maxChars: number): string => {
  if (maxChars <= 0) {
    return ""
  }
  const chars = Array.from(value)
  return chars.length <= maxChars ? value : chars.slice(0, maxChars).join("")
}

const padToWidth = (value: string, width: number): string => {
  const chars = Array.from(value)
  if (chars.length >= width) {
    return chars.slice(0, width).join("")
  }

  return `${value}${" ".repeat(width - chars.length)}`
}

const withScrollAdjusted = (
  state: EditorState,
  editorHeight: number
): EditorState => {
  if (state.cursorRow < state.scrollRow) {
    return {
      ...state,
      scrollRow: state.cursorRow
    }
  }

  if (state.cursorRow >= state.scrollRow + editorHeight) {
    return {
      ...state,
      scrollRow: state.cursorRow - editorHeight + 1
    }
  }

  return state
}

const render = (state: EditorState): EditorState => {
  const { width, editorHeight } = dimensions()
  const nextState = withScrollAdjusted(state, editorHeight)
  const lineNumberWidth = Math.max(String(nextState.lines.length).length, 2)
  const chunks: string[] = ["\u001b[?25l", "\u001b[H"]

  for (let row = 0; row < editorHeight; row += 1) {
    const lineIndex = nextState.scrollRow + row
    if (lineIndex < nextState.lines.length) {
      const gutter = `${String(lineIndex + 1).padStart(lineNumberWidth, " ")} `
      const contentWidth = Math.max(width - gutter.length, 0)
      const text = sliceChars(lineAt(nextState, lineIndex), contentWidth)
      chunks.push(`${gutter}${text}`)
    } else {
      chunks.push("~")
    }

    chunks.push("\u001b[K")
    if (row < editorHeight - 1) {
      chunks.push("\r\n")
    }
  }

  const fileName = nextState.filePath ?? "[new file]"
  const saveState = nextState.dirty ? "modified" : "saved"
  const leftStatus = `${fileName} | ${nextState.lines.length} lines | ${saveState}`
  const rightStatus = `${nextState.cursorRow + 1}:${nextState.cursorCol + 1}`
  const spaceCount = Math.max(width - leftStatus.length - rightStatus.length, 1)
  const statusLine = padToWidth(`${leftStatus}${" ".repeat(spaceCount)}${rightStatus}`, width)
  const messageLine = padToWidth(sliceChars(nextState.status, width), width)

  chunks.push("\r\n")
  chunks.push(`\u001b[7m${statusLine}\u001b[m`)
  chunks.push("\r\n")
  chunks.push(messageLine)

  const cursorScreenRow = nextState.cursorRow - nextState.scrollRow + 1
  const gutterWidth = lineNumberWidth + 1
  const maxVisibleEditorCol = Math.max(width - gutterWidth - 1, 0)
  const visibleCol = clamp(nextState.cursorCol, 0, maxVisibleEditorCol)
  const cursorScreenCol = gutterWidth + 1 + visibleCol + 1
  chunks.push(`\u001b[${cursorScreenRow};${cursorScreenCol}H`)
  chunks.push("\u001b[?25h")

  process.stdout.write(chunks.join(""))
  return nextState
}

export const runTuiNotepadRuntime = (
  options: NotepadOptions
): Promise<NotepadResult> => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return Promise.reject(new Error("TUI mode requires an interactive terminal"))
  }

  return new Promise<NotepadResult>((resolvePromise, rejectPromise) => {
    let state = toInitialState(options)
    let finalized = false
    let bytesWritten: number | undefined

    const cleanup = (): void => {
      process.stdin.off("data", onData)
      process.stdout.off("resize", onResize)
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdout.write("\u001b[?25h\u001b[0m\r\n")
    }

    const resolve = (): void => {
      if (finalized) {
        return
      }
      finalized = true
      cleanup()
      resolvePromise({
        filePath: state.filePath,
        saved: !state.dirty,
        bytesWritten
      })
    }

    const reject = (error: unknown): void => {
      if (finalized) {
        return
      }
      finalized = true
      cleanup()
      rejectPromise(error instanceof Error ? error : new Error(String(error)))
    }

    const requestQuit = (): void => {
      if (state.dirty && !state.pendingQuit) {
        state = {
          ...state,
          pendingQuit: true,
          status: "Unsaved changes. Press Ctrl+Q again to quit without saving."
        }
        return
      }

      resolve()
    }

    const applyKey = (key: string): void => {
      if (key === CTRL_Q || key === CTRL_C) {
        requestQuit()
        return
      }

      if (key === CTRL_S) {
        const saved = saveFile(state)
        state = saved.state
        bytesWritten = saved.bytesWritten
        return
      }

      if (key === ENTER) {
        state = insertNewLine(state)
        return
      }

      if (key === BACKSPACE) {
        state = deleteBackward(state)
        return
      }

      if (key === "\u001b[3~") {
        state = deleteForward(state)
        return
      }

      if (key === "\u001b[A") {
        state = moveCursorUp(state)
        return
      }

      if (key === "\u001b[B") {
        state = moveCursorDown(state)
        return
      }

      if (key === "\u001b[C") {
        state = moveCursorRight(state)
        return
      }

      if (key === "\u001b[D") {
        state = moveCursorLeft(state)
        return
      }

      if (key === "\u001b[H") {
        state = moveCursorHome(state)
        return
      }

      if (key === "\u001b[F") {
        state = moveCursorEnd(state)
        return
      }

      if (isPrintable(key)) {
        state = insertCharacter(state, key)
      }
    }

    const onData = (chunk: string | Buffer): void => {
      try {
        const input = typeof chunk === "string" ? chunk : chunk.toString("utf8")
        const keys = parseInputKeys(input)

        for (const key of keys) {
          applyKey(key)
          if (finalized) {
            return
          }
        }

        state = render(state)
      } catch (error) {
        reject(error)
      }
    }

    const onResize = (): void => {
      if (finalized) {
        return
      }
      state = render(state)
    }

    try {
      process.stdout.write("\u001b[2J\u001b[H")
      process.stdin.setRawMode(true)
      process.stdin.resume()
      process.stdin.on("data", onData)
      process.stdout.on("resize", onResize)
      state = render(state)
    } catch (error) {
      reject(error)
    }
  })
}
