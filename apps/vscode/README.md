# wiremap for VS Code

A **wiremap** view in the Explorer shows how the file you are editing is wired:

- its role (controller, service, page, …) and size;
- the files it imports, and the files that import it;
- the HTTP routes its handlers serve, each opening at its line;
- how many files depend on it, directly or not.

**wiremap: Show impact of this file** lists every dependent by distance, and the routes among
them. **wiremap: Open this file in wiremap** opens the project's explorer with the file
selected.

## Where the graph comes from

1. A file written by `npx wiremap analyze -o graph.json` in the workspace folder. Set
   `wiremap.graphFile` for another name, or a `.json.gz`.
2. Otherwise, the latest scan of a wiremap project. Set `wiremap.server` and
   `wiremap.project`, then run **wiremap: Set API key**. The key is kept in VS Code's secret
   storage, not in settings.

The extension reads the graph and nothing else, and it sends no source anywhere.
