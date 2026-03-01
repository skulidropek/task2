import { Effect } from "effect"

import { viewFile } from "../core/viewer.js"
import { parseCliArgs, printHelp } from "../shell/cli.js"

const stdoutSink = {
  write: (chunk: string): void => {
    process.stdout.write(chunk)
  }
}

export const runCli = async (args: ReadonlyArray<string>): Promise<void> => {
  const command = parseCliArgs(args)

  if (command.kind === "help") {
    process.stdout.write(printHelp())
    return
  }

  await viewFile(command.options, stdoutSink)
}

export const program = Effect.tryPromise({
  try: () => runCli(process.argv.slice(2)),
  catch: (error) => error instanceof Error ? error : new Error(`Unexpected failure: ${String(error)}`)
})
