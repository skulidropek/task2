import { Effect } from "effect"

import { viewFile } from "../core/viewer.js"
import { parseCliArgs, printHelp } from "../shell/cli.js"

const stdoutSink = {
  write: (chunk: string): void => {
    process.stdout.write(chunk)
  }
}

export const runCli = (args: ReadonlyArray<string>) =>
  Effect.gen(function*(_) {
    const command = parseCliArgs(args)

    if (command.kind === "help") {
      stdoutSink.write(printHelp())
      return
    }

    yield* _(viewFile(command.options, stdoutSink))
  })

export const program = runCli(process.argv.slice(2))
