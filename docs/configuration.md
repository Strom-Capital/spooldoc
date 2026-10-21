---
title: "Configuration"
description: "The environment variables the server reads, and the settings that live in the app."
---

Spooldoc reads a few settings from the environment when it starts, and
keeps the rest in the database under Settings, where they change without a
restart. `apps/web/.env.example` lists the variables with comments; copy it
to `apps/web/.env.local` for development, or put the same variables in the
`.env` file next to `compose.yaml` for Docker.

## Environment variables

| Variable | Required | Default | What it is |
|----------|----------|---------|------------|
| `DATABASE_URL` | Yes | | The Postgres connection string. `docker compose up -d db` starts one at `postgres://spooldoc:spooldoc@localhost:5433/spooldoc`. |
| `BETTER_AUTH_SECRET` | Yes | | Signs the login sessions. At least 32 characters; `openssl rand -base64 32` makes one. |
| `SPOOLDOC_SECRET_KEY` | Yes | | Encrypts the IBM i passwords of saved servers, the model keys, the Carbone Cloud key, the mail server password, the Microsoft 365 client secret and Spooldoc's private key for Carbone (AES-256-GCM). 32 bytes in base64; `openssl rand -base64 32` makes one. Keep it: with another key the saved passwords cannot be read and must be entered again. |
| `PORT` | No | `3000` | The port the server listens on. |
| `APP_URL` | No | | The address users reach the app at, such as `https://spooldoc.example.com`. Origin checks accept it and the request's own host, and cookies are marked secure when it is https. Set it behind a reverse proxy. |
| `SPOOLDOC_WATCHER` | No | `on` | Run the queue watcher in this process. Turn it off on every instance but one; the watcher also takes database locks, so two instances never read the same data queue or run the same job at once. |
| `SPOOLDOC_MIGRATE` | No | `on` | Apply the database migrations when the server starts. With it off, run `pnpm --filter @spooldoc/web db:migrate` yourself. |
| `SPOOLDOC_DEFAULT_CCSID` | No | | The code page for spooled files that have no CHRID when the job CCSID is not supported, for example `273` or `37`. Also the CCSID of queue descriptions when the system has no default CCSID. |
| `SPOOLDOC_ALLOWED_HOSTS` | No | | Comma-separated hosts servers may use. When set, the server form shows a list instead of a free text field. |
| `SPOOLDOC_LOG_LEVEL` | No | `info` | How much the server logs: `off`, `error`, `warn`, `info` or `debug`. See [Server log](#server-log). |

The server refuses to start with a missing or malformed required variable
and says which one. The agent's model, its key and effort, and the Carbone
connection are not environment variables: they are set in the app under
Settings. So is masking, which was `SPOOLDOC_MASK` before; the server log
says so when that variable is still set. See [Carbone](carbone.md) and
[Masking](agent.md#masking).

The Compose file passes two more variables from `.env` to the `carbone`
service:

| Variable | What it is |
|----------|------------|
| `CARBONE_AUTHENTICATION_PUBLIC_KEY` | Spooldoc's public key, as Settings shows it under Rendering: one line, with `\n` for each newline. |
| `CARBONE_LICENSE` | A Carbone Enterprise license. Without it Carbone runs as the Community Edition. |

## Server log

The server writes its log to stdout, one JSON object per line, so
`docker compose logs` or any log collector can read it. Each line has
`time`, `level` and `msg`, and fields such as `serverId`, `jobId`, `runId`
and `error`. Passwords and keys are taken out of error text before it is
logged.

```json
{"time":"2026-10-19T08:12:03.512Z","level":"warn","msg":"Real-time watching failed; the queues are polled meanwhile","serverId":"6f1c...","dataQueue":"SPOOLDOC/SPOOLDOC","error":"Connection reset","retryInSeconds":5}
```

At the default level, `info`, the log has what fails before a run exists:
a server the watcher cannot reach, a queue list it cannot read, real-time
watching that stopped and started again, a job whose active version cannot
be read, runs a stopped server cut off, a failed cleanup, agent chats
that fail, and the warnings and errors of the sign-in library. A problem
that lasts is logged once, and again when it is gone. `warn` keeps only
the problems.

## Settings in the app

Under Settings, for the whole app:

| Setting | Default | What it is |
|---------|---------|------------|
| Poll interval | 30 seconds | How often the watcher lists a polled queue. |
| Safety check | 5 minutes | How often a real-time queue is listed anyway, in case a data queue entry was missed. |
| Keep runs for | 90 days | How long runs are kept, 1 to 3650 days. See [Retention](job-log.md#retention). |
| Agent | None | The provider, key, model and effort of the agent. See [Agent](agent.md#choosing-a-model). The section also shows the agent's [usage](agent.md#usage) this month and last month. |
| Formats | `1,234.56`, `YYYY-MM-DD` | How numbers, amounts and dates print in documents and email fields. See [Formats](#formats). |
| Mail server | None | The SMTP server email destinations send through. See [Mail server](#mail-server). |

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/settings-dark.png">
    <img src="assets/settings-light.png" alt="The Settings page shows Rendering with Carbone connected, its URL and Spooldoc's public key, Formats set to 1 234,56, 29.10.2026 and EUR, the Mail server with its host, security, port, user name, a saved password and the From address, the Agent with its provider, model, effort and usage, and the Watching and Retention settings." width="900">
  </picture>
</p>

## Formats

How numbers, amounts and dates print, for the whole app. Every render
sends them to Carbone, and email fields follow them too.

| Setting | Choices | What it does |
|---------|---------|--------------|
| Number format | `1,234.56` (the default), `1 234,56`, `1.234,56`, `1’234.56` | The separators of `formatN` and `formatC`, and the language of month and day names in `formatD`: English, Swedish, German and Swiss German. |
| Date format | `YYYY-MM-DD` (the default), `DD.MM.YYYY`, `DD/MM/YYYY`, `MM/DD/YYYY` | A date field in an email field without `formatD`. In a template, `formatD` sets the pattern. |
| Currency | Empty (the default), or a code such as EUR, USD, GBP, SEK, NOK, DKK or CHF | The currency `formatC` prints. Empty is the number format's own: USD for `1,234.56`, SEK for `1 234,56`, EUR for `1.234,56`, CHF for `1’234.56`. |

The defaults print what Spooldoc printed before Formats existed. With
`1.234,56` and EUR, `{d.pg.total:formatC(2)}` prints `1.234,50 €` and
`{d.pg.total:formatN(2)}` prints `1.234,50`. Carbone has no number format
of its own for Finnish, Norwegian or Danish, so `1 234,56` comes with
Swedish month names. A currency must be one Carbone knows; Settings lists
them.

## Mail server

[Email destinations](destinations.md#email) send through the mail server
set under Settings, **Mail server**, for the whole app. **Send with**
picks how:

- **SMTP server**: your own mail server or a sending service.
- **Microsoft 365**: a mailbox in your Microsoft 365 tenant, through
  Microsoft Graph. Spooldoc signs in as an app registered in Microsoft
  Entra ID, with no user password. Microsoft 365 is turning off SMTP
  sign-in with a password by default, so use this one when your mail is
  there.

Each keeps its own settings, so you can switch back. The From address
and From name are shared.

Save, then **Send test email** sends one to your own address with the
saved settings and says what happened: "Test email sent to
you@example.com", or what to check, such as "The mail server refused the
sign-in. Check the user name and password in Settings, under Mail server,
or use an app password." The server's own text is under Details.

### SMTP server

| Setting | What it is |
|---------|------------|
| Host | The SMTP server, such as `smtp.example.com`. The Spooldoc server connects to it, so it must be reachable from there. Empty turns email off. |
| Security | STARTTLS (usually port 587), TLS (usually port 465), or None, for a relay on your own network. |
| Port | Follows Security unless you change it. |
| User name and password | Optional: a server that takes email without a sign-in needs neither. The password is stored encrypted and never shown again. Some services want an app password here. |
| From address and From name | Every email comes from this address. Use one the server lets the user send from. |

### Microsoft 365

| Setting | What it is |
|---------|------------|
| Directory (tenant) ID | Your tenant: a GUID, or a domain such as `contoso.onmicrosoft.com`. Empty turns email off. |
| Application (client) ID | The app registration Spooldoc signs in as. |
| Client secret | The secret's value, not its ID. Stored encrypted and never shown again. |
| From address and From name | The mailbox every email is sent from: a user mailbox with an Exchange Online license, or a shared mailbox. Each email is also kept in its Sent Items. |

Spooldoc gets a token with the OAuth 2.0 client credentials flow from
`login.microsoftonline.com` and sends each email with Microsoft Graph,
`graph.microsoft.com`, over HTTPS on port 443. The Spooldoc server must
reach both.

**Register the app.** In the [Microsoft Entra admin
center](https://entra.microsoft.com), as an administrator:

1. Under **App registrations**, choose **New registration**. Name it, for
   example `Spooldoc`, keep **Accounts in this organizational directory
   only**, and leave the redirect URI empty.
2. On its **Overview** page, copy the **Application (client) ID** and the
   **Directory (tenant) ID** into Settings.
3. Under **API permissions**, choose **Add a permission**, **Microsoft
   Graph**, **Application permissions**, and pick **Mail.Send**. Then
   choose **Grant admin consent**. Skip this step if you limit the app
   with RBAC for Applications, below.
4. Under **Certificates & secrets**, choose **New client secret**, and
   pick when it expires. Copy its **Value** (not the Secret ID) into
   Settings right away: it is shown only once.

Note the expiry date. When the secret expires, every email fails with
"The client secret has expired". Make a new secret before then and enter
its value in Settings.

**Limit the app to one mailbox.** The Mail.Send application permission
lets the app send as any mailbox in the tenant. Limit it to the mailbox
in From, so a leaked secret cannot send as anyone else. Run these in
[Exchange Online PowerShell](https://learn.microsoft.com/powershell/exchange/connect-to-exchange-online-powershell),
with your own IDs and addresses.

With [RBAC for Applications](https://learn.microsoft.com/exchange/permissions-exo/application-rbac),
which Microsoft recommends, the role in Exchange Online gives the app
Mail.Send for one mailbox only. Leave Mail.Send out of the app's API
permissions in Microsoft Entra ID (step 3): a consent there applies to
every mailbox. The object ID is the one on the app's **Enterprise
applications** page, not on App registrations.

```powershell
New-ServicePrincipal -AppId <application-id> -ObjectId <enterprise-app-object-id> -DisplayName "Spooldoc"
New-ManagementScope -Name "Spooldoc mailbox" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'invoices@contoso.example'"
New-ManagementRoleAssignment -App <application-id> -Role "Application Mail.Send" -CustomResourceScope "Spooldoc mailbox"
Test-ServicePrincipalAuthorization -Identity <application-id> -Resource invoices@contoso.example
```

With an [application access policy](https://learn.microsoft.com/graph/auth-limit-mailbox-access),
the older way, keep the Mail.Send consent from step 3, put the mailbox
in a mail-enabled security group, and restrict the app to that group:

```powershell
New-ApplicationAccessPolicy -AppId <application-id> -PolicyScopeGroupId spooldoc-senders@contoso.example -AccessRight RestrictAccess -Description "Spooldoc sends only as these mailboxes"
Test-ApplicationAccessPolicy -Identity invoices@contoso.example -AppId <application-id>
```

A change can take up to two hours to apply in Exchange Online. Then
**Send test email** shows whether the app may send as the mailbox. When
it may not, the message says so, such as "Microsoft 365 does not let the
app send as invoices@contoso.example", with Microsoft's own text under
Details. A wrong tenant ID, client ID or secret, a missing permission
and a mailbox that does not exist each get their own message.

## Per server and per job

The libraries a server lists queues from are on the server; see
[Servers](servers.md). The filters, trigger, formats, destination and
finish action are on each job; see [Jobs](jobs.md).
