import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Effect, pipe } from "effect"

import { program } from "./program.js"

const main = pipe(program, Effect.provide(NodeContext.layer))

NodeRuntime.runMain(main)
