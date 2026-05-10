# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run setup        # First-time setup: install deps + Prisma generate + migrations
npm run dev          # Start dev server with Turbopack (http://localhost:3000)
npm run dev:daemon   # Run dev server in background (logs → logs.txt)
npm run build        # Production build
npm run lint         # ESLint
npm run test         # Vitest unit tests
npm run db:reset     # Reset SQLite database to initial state
```

Run a single test file:
```bash
npx vitest run src/lib/__tests__/file-system.test.ts
```

## Environment

`.env` requires `ANTHROPIC_API_KEY`. If omitted, the app falls back to a `MockLanguageModel` that generates static component code — useful for development without API access.

## Architecture

UIGen is an AI-powered React component generator with live preview. Users describe a component in chat; Claude generates it using file-manipulation tools; the result renders immediately in an iframe.

### Data flow

1. User submits a prompt in `ChatInterface`
2. Frontend POST to `/api/chat` with `{ messages, files, projectId }`
3. `route.ts` calls Claude via Vercel AI SDK `streamText()` with two tools:
   - `str_replace_editor` — view/create/str_replace/insert operations on files
   - `file_manager` — rename/delete files
4. Tool calls are forwarded to `FileSystemContext` handlers on the client, which mutate an in-memory `VirtualFileSystem` instance (no disk writes)
5. `PreviewFrame` watches file state, runs Babel transforms via `jsx-transformer.ts`, builds an import map, and injects everything into an `<iframe>` srcdoc
6. After streaming completes, `route.ts` persists messages + serialized file system to the `Project` row in SQLite (authenticated users only)

### Key files

| Path | Role |
|------|------|
| `src/app/api/chat/route.ts` | AI generation endpoint — streaming, tools, DB persistence |
| `src/lib/file-system.ts` | `VirtualFileSystem` class — all CRUD + serialize/deserialize |
| `src/lib/provider.ts` | LLM abstraction — real Claude or `MockLanguageModel` |
| `src/lib/transform/jsx-transformer.ts` | Babel JSX transform + import map + preview HTML generation |
| `src/lib/contexts/file-system-context.tsx` | React context wiring tool calls to `VirtualFileSystem` |
| `src/lib/contexts/chat-context.tsx` | Chat state, message history, streaming state |
| `src/lib/tools/` | Tool definitions (`str_replace_editor`, `file_manager`) |
| `src/lib/prompts/generation.tsx` | System prompt sent to Claude |
| `src/app/main-content.tsx` | Top-level shell — resizable panels, tabs |
| `prisma/schema.prisma` | `User` + `Project` models (SQLite) |

### Virtual file system conventions

- Root is `/` — all paths start with `/`
- `App.jsx` is the required entry point for previews
- All inter-file imports use the `@/` alias (e.g. `import Foo from '@/Foo'`)
- No HTML files; JSX only
- Files live entirely in memory; `serialize()` / `deserializeFromNodes()` handle DB round-trips

### Auth

JWT tokens stored in cookies, validated by `src/middleware.ts`. Anonymous users can generate components but cannot save projects. Server actions in `src/actions/` handle sign-up/in/out and project CRUD.

### Testing

- Framework: Vitest + jsdom + `@testing-library/react`
- Test files: `src/**/__tests__/*.test.{ts,tsx}`
- 9 test files covering: file system, jsx transformer, chat/file-system contexts, and UI components
