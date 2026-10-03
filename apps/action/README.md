# wiremap GitHub Action

Analyzes the repository on the runner and sends its graph to a wiremap project. The source
stays on the runner: only the graph is uploaded.

```yaml
name: wiremap
on:
  push:
    branches: [main]

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: sami999khan999/wiremap/apps/action@main
        with:
          server: https://your-wiremap.example
          api-key: ${{ secrets.WIREMAP_API_KEY }}
          project: shop-api
```

| Input | | Default |
|---|---|---|
| `server` | The wiremap server | required |
| `api-key` | An API key holding `project.scan.run`, from a secret | required |
| `project` | The project's URL name | required |
| `path` | The folder to analyze | `.` |
| `args` | More `wiremap scan` options, split on spaces | none |
| `version` | The CLI version from npm | `latest` |

The branch is the pull request's head or the pushed ref, and the commit is `GITHUB_SHA`.

This is the upload path: the runner reads the code with your workflow's own checkout. A
project connected through the GitHub App needs no workflow at all. wiremap scans it on push.
