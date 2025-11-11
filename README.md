Originally forked from [rtCamp/action-slack-notify](https://github.com/rtCamp/action-slack-notify) and fully rewritten in TypeScript for ease of maintenance.

# Slack Notify – GitHub Action

[![Project Status: Active – The project has reached a stable, usable state and is being actively developed.](https://www.repostatus.org/badges/latest/active.svg)](https://www.repostatus.org/#active)

A lightweight Node.js 20 action that posts richly formatted messages (and optional file uploads) to Slack Channels, Threads, or DMs. The runtime is now pure TypeScript → JavaScript, so you no longer need Docker or a Go toolchain—`runs-on: ubuntu-*-slim` works out of the box.

The `Site` and `SSH Host` fields automatically appear when this action runs after [Deploy WordPress](https://github.com/rtCamp/action-deploy-wordpress) (or any workflow that writes `.github/hosts.yml`).

> **Heads up**  
> Version 3+ of this action is **not** a composite/Docker wrapper. Instead it executes `dist/index.js` directly under Node 20. Update your workflow to use `uses: tainakanchu/actions-slack-notify@v3` (or a specific tag) with no container step required.

## Usage

### Basic webhook example

```yml
on: push
name: Slack Notification Demo
jobs:
  slackNotification:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Slack Notification
        uses: tainakanchu/actions-slack-notify@v3
        env:
          SLACK_WEBHOOK: ${{ secrets.SLACK_WEBHOOK }}
          SLACK_MESSAGE: 'Deploy succeeded for ${{ github.ref }}'
```

### Token (chat.postMessage) mode

Provide both `SLACK_TOKEN` (Bot/User OAuth token) and `SLACK_CHANNEL`, optionally targeting a thread:

```yml
      - name: Slack Notification via Bot Token
        uses: tainakanchu/actions-slack-notify@v3
        env:
          SLACK_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
          SLACK_CHANNEL: 'C0123456789'
          SLACK_THREAD_TS: '1734638290.123456'
          SLACK_MESSAGE: ':rocket: Release ready!'
          SLACK_COLOR: ${{ job.status }}
```

### File uploads

Uploading build artifacts requires a Slack token (file uploads are not supported with incoming webhooks):

```yml
      - name: Upload report
        uses: tainakanchu/actions-slack-notify@v3
        env:
          SLACK_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
          SLACK_CHANNEL: 'C0123456789'
          SLACK_FILE_UPLOAD: reports/summary.txt
          SLACK_MESSAGE: 'See the attached test summary'
```

`SLACK_FILE_UPLOAD` can be absolute or relative to `GITHUB_WORKSPACE`. When provided the file is sent after the chat message succeeds.

## Environment variables

| Name | Default | Notes |
| ---- | ------- | ----- |
| `SLACK_WEBHOOK` | – | Incoming webhook URL. If set, WEBHOOK mode is used. |
| `SLACK_TOKEN` | – | Bot/User OAuth token. Required for TOKEN mode or file uploads. |
| `SLACK_CHANNEL` | – | Channel/DM for TOKEN mode and file uploads. Falls back to `.github/hosts.yml` if present. |
| `SLACK_CUSTOM_PAYLOAD` | – | Raw JSON payload string; sent as-is to Slack. Skips all formatting logic. |
| `SLACK_MESSAGE` | Commit message fallback | Main message body. Required unless commit data or `SLACK_CUSTOM_PAYLOAD` is supplied. |
| `SLACK_MESSAGE_ON_SUCCESS` / `SLACK_MESSAGE_ON_FAILURE` / `SLACK_MESSAGE_ON_CANCEL` | – | Override text when `SLACK_COLOR` is `success`, `failure`, or `cancelled`. |
| `SLACK_COLOR` | `good` | Accepts `good`, `warning`, `danger`, `success`, `failure`, `cancelled`, or any hex color. |
| `SLACK_TITLE` | `Message` | Title for the main field. |
| `SLACK_USERNAME` / `SLACK_ICON` / `SLACK_ICON_EMOJI` | `rtBot`, default avatar | Customize sender identity. |
| `SLACK_LINK_NAMES` | – | Set to `1` to force Slack to resolve `@user` and `#channel` mentions. |
| `SLACK_THREAD_TS` | – | Send message (and optional file upload) as a reply to an existing Slack thread. |
| `SLACK_FILE_UPLOAD` | – | Relative/absolute path to upload after the message posts (TOKEN mode + `SLACK_CHANNEL` required). |
| `SLACKIFY_MARKDOWN` | `false` | When `true`, applies GitHub-flavored Markdown → Slack formatting using `slackify-markdown`. |
| `ENABLE_ESCAPES` | `false` | Interprets `\n`, `\t`, etc. inside message env vars after interpolation. |
| `MSG_MINIMAL` | – | `true` shows only the main text. Provide a comma list (`ref,event,actions url,commit`) to keep specific fields. |
| `SLACK_FOOTER` | Slack Notify attribution | Set to override the default footer message. |
| `SITE_NAME` / `SITE_TITLE` / `HOST_NAME` / `HOST_TITLE` | – | Override host metadata (normally inferred from `.github/hosts.yml`). |

All standard GitHub environment variables (e.g., `GITHUB_REF`, `GITHUB_EVENT_NAME`, `GITHUB_SHA`) are read directly—no inputs are required.

## Optional `.github/hosts.yml`

If your repository contains `.github/hosts.yml`, the action attempts to:

- Derive `SLACK_CHANNEL` from `ci_script_options.slack-channel`.
- Populate `Site` / `SSH Host` fields using `<branch>.deploy_path`, `<branch>.hostname`, and `<branch>.user`.

This mirrors the behavior of the earlier shell scripts but without requiring rsync or bash glue.

## Development

The project is authored in TypeScript and bundled with `tsup`.

```bash
npm install
npm run typecheck
npm run build
```

Publishing the action requires committing the generated `dist/` files.

## License

MIT © tainakanchu (with thanks to rtCamp for the original project)
