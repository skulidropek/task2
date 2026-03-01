# Large Text Viewer

Streaming text-file viewer for very large files (100GB+), built on top of the `effect-template` workspace structure.

## Features

- Reads files in a streaming way (no full-file load to memory).
- Supports explicit encoding via `iconv-lite` (`--encoding`).
- Supports auto-detection (BOM + `jschardet`) with UTF-8 fallback.
- Supports range viewing (`--from`, `--lines`) and efficient tail mode (`--tail`).
- Keeps working memory under configured 10MB limit by design.

## Install

```bash
pnpm install
```

## Usage

```bash
pnpm start -- <file-path> [--from <line>] [--lines <count>] [--tail] [--encoding <name>] [--no-auto-encoding] [--chunk-kb <size>]
```

Examples:

```bash
pnpm start -- ./huge.log --from 1500000 --lines 200
pnpm start -- ./huge.log --tail --lines 300
pnpm start -- ./legacy.txt --encoding windows-1251 --lines 50
```
