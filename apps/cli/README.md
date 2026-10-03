# wiremap

See how a codebase is wired: its import graph by folder, what each file is, the routes a
backend exposes, and the frontend calls that reach them.

`wiremap analyze` runs entirely on your machine and needs no account. `upload` and `scan`
send the graph it builds to a wiremap server, and never the source.

```bash
npx wiremap analyze . -o graph.json
```

```
36 files · 71 imports between files here · 21 routes
frameworks: nestjs
Graph is partial: 72 of 76 imports into this repository resolved (95%)
1 cycles · 1 unused files · 9 unguarded routes
```

TypeScript, JavaScript and PHP. NestJS, Next.js, TanStack Start and Laravel routes are read
from the code, or from an `openapi.json` when the repository has one.

## Sending a graph to wiremap

Create an API key in wiremap under **Settings → API keys**, then:

```bash
wiremap login --server https://your-wiremap.example
# paste the key when asked; it is checked, then saved readable by you alone

wiremap scan . --project shop-api --branch main --commit "$(git rev-parse HEAD)"
```

In CI, set `WIREMAP_SERVER` and `WIREMAP_API_KEY` instead of logging in. A flag beats the
environment, and the environment beats the saved login.

## Commands

| Command | |
|---|---|
| `analyze [dir]` | Read a repository and write its graph. `-o graph.json.gz` compresses |
| `upload <graph>` | Send a graph you built to a project |
| `scan [dir]` | `analyze`, then `upload` |
| `login`, `logout`, `whoami` | Save, forget and check the server and API key |
| `mcp` | Serve a graph to an AI assistant over the Model Context Protocol |

`wiremap --help` lists every option.

## Where the login is kept

`$XDG_CONFIG_HOME/wiremap/credentials.json`, or `~/.config/wiremap/` (`%APPDATA%\wiremap\` on
Windows), with mode `0600`. `wiremap logout` deletes it.
