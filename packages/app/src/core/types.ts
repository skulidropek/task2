export const DEFAULT_LINES = 100
export const DEFAULT_FROM = 1
export const DEFAULT_CHUNK_SIZE_KB = 256
export const MEMORY_LIMIT_BYTES = 10 * 1024 * 1024

export interface ViewerOptions {
  readonly filePath: string
  readonly lines: number
  readonly from: number
  readonly tail: boolean
  readonly explicitEncoding: string | undefined
  readonly autoDetectEncoding: boolean
  readonly chunkSizeBytes: number
  readonly memoryLimitBytes: number
}

export interface ViewResult {
  readonly mode: "forward" | "tail"
  readonly encoding: string
  readonly linesPrinted: number
  readonly bytesRead: number
}

export interface OutputSink {
  readonly write: (chunk: string) => void
}

export interface NotepadOptions {
  readonly filePath: string | undefined
}

export interface NotepadResult {
  readonly filePath: string | undefined
  readonly saved: boolean
  readonly bytesWritten: number | undefined
}
