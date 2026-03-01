import { Effect } from "effect"

import { runTuiNotepadRuntime } from "../../runtime/tui-notepad.js"
import type { NotepadOptions, NotepadResult } from "./types.js"

export const openNotepad = (
  options: NotepadOptions
): Effect.Effect<NotepadResult, Error> =>
  Effect.tryPromise({
    try: () => runTuiNotepadRuntime(options),
    catch: (cause) => new Error(String(cause))
  })
