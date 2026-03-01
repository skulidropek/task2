import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { Effect, pipe } from "effect"

export const withTempFile = (
  prefix: string,
  fileName: string,
  content: string | Buffer
) =>
  pipe(
    Effect.acquireRelease(
      Effect.tryPromise({
        try: () => mkdtemp(path.join(tmpdir(), `${prefix}-`)),
        catch: (cause) => new Error(String(cause))
      }),
      (directory) =>
        Effect.tryPromise({
          try: () => rm(directory, { recursive: true, force: true }),
          catch: (cause) => new Error(String(cause))
        }).pipe(Effect.orDie)
    ),
    Effect.flatMap((directory) => {
      const target = path.join(directory, fileName)

      return Effect.tryPromise({
        try: () => writeFile(target, content).then(() => target),
        catch: (cause) => new Error(String(cause))
      })
    })
  )
