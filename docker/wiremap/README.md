# wiremap

**See how a codebase is wired.** Wiremap scans your repositories and shows the import graph by
folder, what each file does, the routes, insights about the structure, and an assistant that
answers questions with citations into the code.

Everything runs in this one image: Postgres with pgvector, Redis, object storage, a mail catcher,
the web app and the worker. Your source code never leaves your machine. Scans run inside the
container, and each clone is deleted when its scan finishes.

## Run it

```bash
docker run -d --name wiremap --restart unless-stopped \
  -p 127.0.0.1:43000:43000 -p 127.0.0.1:48025:48025 \
  -v wiremap-data:/data \
  prodigycorp/wiremap
```

The first start takes about a minute. Then:

1. Open **http://localhost:43000** and sign up. Use `localhost`, not `127.0.0.1`: sign-in only
   works from the address wiremap was started for.
2. Open the verification email in the built-in inbox at **http://localhost:48025**.
3. Make yourself the admin:

   ```bash
   docker exec wiremap wiremap-admin grant you@example.com
   ```

4. Go to **Platform → GitHub** and click **Create GitHub App**. GitHub opens with the App filled
   in. Click **Create** there, and you land back in wiremap with GitHub connected.
5. Create a project, click **Connect GitHub**, pick repositories, and scan.

There is nothing to configure before the first start. Passwords and keys are generated on the
first start and kept in `/data/secrets.env`.

## Another address

Wiremap must know the address people open it at. The default is `http://localhost:43000`. To
use a LAN address or a domain, set it when you start the container, before you create the
GitHub App:

```bash
docker run ... -e WIREMAP_PUBLIC_URL=https://wiremap.example.com ... prodigycorp/wiremap
```

At a public `https` address, GitHub sends pushes by webhook and they are scanned within seconds.
At any other address, wiremap checks each tracked branch every hour instead. A free Cloudflare
Tunnel gives you a public address without opening a port: set `CLOUDFLARE_TUNNEL_TOKEN` to the
tunnel's token and `WIREMAP_PUBLIC_URL` to its hostname.

## Settings

All optional. Pass them with `-e` or `--env-file`.

| Variable | What it does |
|---|---|
| `WIREMAP_PUBLIC_URL` | The address people open wiremap at. Default `http://localhost:43000` |
| `SMTP_URL`, `EMAIL_FROM` | Send real email. Without them, mail is caught at port 48025 |
| `AUTH_REQUIRE_EMAIL_VERIFICATION=false` | Skip email verification, for a single-person install |
| `CLOUDFLARE_TUNNEL_TOKEN` | Serve wiremap at a public hostname through a Cloudflare Tunnel, with `WIREMAP_PUBLIC_URL` |
| `GITHUB_POLLING=false` | Stop the hourly branch check |
| `WIREMAP_BACKUP_HOUR` | The UTC hour of the daily backup (default `4`), or `off` |
| `EMBEDDING_PROVIDER`, `EMBEDDING_API_KEY` | `openai` or `gemini`, for semantic search. Default is text search |
| `WEB_PROCESSES`, `POSTGRES_SHARED_BUFFERS`, `REDIS_MAXMEMORY` | Sizing. Defaults `2`, `128MB`, `256mb` |

The assistant is switched on per organization, in its settings, with that organization's own
Gemini key.

To use a GitHub App you registered yourself instead of creating one in the app, set
`GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`,
`GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. These take precedence over an App created in the
app.

## Backups and upgrades

A backup is written to `/data/backups/` every day, and the last seven are kept. Each one holds
the database, the stored files and `secrets.env`. Copy them somewhere off the machine too.

```bash
docker exec wiremap wiremap-admin backup      # one now
docker exec wiremap wiremap-admin backups     # list them
docker exec wiremap wiremap-admin restore <name> && docker restart wiremap
```

To upgrade, pull the new image and start it on the same volume. Migrations run on start.

```bash
docker pull prodigycorp/wiremap
docker rm -f wiremap
docker run -d --name wiremap ... -v wiremap-data:/data prodigycorp/wiremap
```

## What it needs

About 420 MB of memory at idle and 1 GB of disk for the image. Images are published for
`linux/amd64` and `linux/arm64`, which includes Apple Silicon. `docker logs wiremap` shows
everything the container does.

**Ports are bound to `127.0.0.1` above** on purpose. Docker's published ports bypass a host
firewall, so publish on all interfaces only behind a reverse proxy or a tunnel.

## Licence

[AGPL-3.0](https://github.com/sami999khan999/wiremap/blob/main/LICENSE). You may run, change and
share wiremap. If you offer a changed version to others over a network, you must offer them your
source too. The source is at
[github.com/sami999khan999/wiremap](https://github.com/sami999khan999/wiremap).
