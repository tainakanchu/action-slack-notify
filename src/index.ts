import * as core from '@actions/core';
import fetch, {Response} from 'node-fetch';
import FormData from 'form-data';
import {createReadStream} from 'fs';
import {promises as fs} from 'fs';
import path from 'path';
import YAML from 'yaml';
import slackifyMarkdown from 'slackify-markdown';

type MessageMode = 'WEBHOOK' | 'TOKEN';

interface Field {
  title?: string;
  value?: string;
  short?: boolean;
}

interface Attachment {
  fallback: string;
  pretext?: string;
  color?: string;
  author_name?: string;
  author_link?: string;
  author_icon?: string;
  footer?: string;
  fields?: Field[];
}

interface SlackPayload {
  text?: string;
  username?: string;
  icon_url?: string;
  icon_emoji?: string;
  channel?: string;
  link_names?: string;
  unfurl_links?: boolean;
  attachments?: Attachment[];
  thread_ts?: string;
}

interface HostsContext {
  channel?: string;
  hostName?: string;
  hostTitle?: string;
  siteName?: string;
  siteTitle?: string;
}

interface EventContext {
  commitMessage?: string;
  pullRequestSha?: string;
}

interface SlackApiResponse {
  ok: boolean;
  error?: string;
}

const DEFAULT_ICON = 'https://avatars0.githubusercontent.com/u/43742164';
const DEFAULT_USERNAME = 'rtBot';
const DEFAULT_TITLE = 'Message';

async function run(): Promise<void> {
  try {
    const workspace = getEnv('GITHUB_WORKSPACE');
    const githubRef = getEnv('GITHUB_REF');
    const branch = githubRef.includes('/') ? githubRef.substring(githubRef.lastIndexOf('/') + 1) : githubRef;

    const hostsContext = await readHostsContext(workspace, branch);
    const mode = determineMessageMode(hostsContext.channel);
    const endpoint = resolveEndpoint(mode);
    const threadTs = getEnv('SLACK_THREAD_TS');
    const eventContext = await readEventContext();

    const enableEscapes = getEnv('ENABLE_ESCAPES') === 'true';
    const slackifyEnabled = getEnv('SLACKIFY_MARKDOWN') === 'true';
    const messages = deriveMessages(enableEscapes, eventContext.commitMessage, slackifyEnabled);

    if (!messages.base && !getEnv('SLACK_CUSTOM_PAYLOAD')) {
      throw new Error('SLACK_MESSAGE is required. Provide a value or ensure the event payload contains commits.');
    }

    const customPayload = getEnv('SLACK_CUSTOM_PAYLOAD');
    if (customPayload) {
      await sendRaw(endpoint, customPayload, mode);
      await maybeUploadFile(messages.base, hostsContext.channel, threadTs);
      core.info('Successfully sent the message!');
      return;
    }

    const payload = buildPayload({
      hostsContext,
      eventContext,
      message: messages.base || 'EOM',
      successMessage: messages.success,
      failureMessage: messages.failure,
      cancelMessage: messages.cancel,
      threadTs,
    });

    await sendPayload(endpoint, payload, mode);
    await maybeUploadFile(messages.base, payload.channel, threadTs);
    core.info('Successfully sent the message!');
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

function determineMessageMode(hostChannel?: string): MessageMode {
  const webhook = getEnv('SLACK_WEBHOOK');
  if (webhook) {
    return 'WEBHOOK';
  }

  const token = getEnv('SLACK_TOKEN');
  const channel = getEnv('SLACK_CHANNEL') || hostChannel;
  if (token && channel) {
    return 'TOKEN';
  }

  throw new Error('Either SLACK_WEBHOOK or a combination of SLACK_TOKEN and SLACK_CHANNEL is required.');
}

function resolveEndpoint(mode: MessageMode): string {
  if (mode === 'WEBHOOK') {
    const endpoint = getEnv('SLACK_WEBHOOK');
    if (!endpoint) {
      throw new Error('SLACK_WEBHOOK is not configured.');
    }
    return endpoint;
  }

  return 'https://slack.com/api/chat.postMessage';
}

async function readEventContext(): Promise<EventContext> {
  const eventPath = getEnv('GITHUB_EVENT_PATH');
  if (!eventPath) {
    return {};
  }

  try {
    const content = await fs.readFile(eventPath, 'utf8');
    const data = JSON.parse(content);

    const commits = Array.isArray(data?.commits) ? data.commits : [];
    const lastCommit = commits.length > 0 ? commits[commits.length - 1] : undefined;
    const commitMessage = typeof lastCommit?.message === 'string' ? lastCommit.message : undefined;
    const pullRequestSha = typeof data?.pull_request?.head?.sha === 'string' ? data.pull_request.head.sha : undefined;

    return {commitMessage, pullRequestSha};
  } catch (error) {
    core.warning(`Unable to read event payload: ${error}`);
    return {};
  }
}

function deriveMessages(enableEscapes: boolean, commitMessage?: string, slackifyEnabled?: boolean) {
  const interpret = (value: string): string => enableEscapes ? unescapeText(value) : value;
  const maybeSlackify = (value: string): string => {
    if (!slackifyEnabled || !value) {
      return value;
    }
    return slackifyMarkdown(value);
  };

  let base = maybeSlackify(getEnv('SLACK_MESSAGE'));
  let success = maybeSlackify(getEnv('SLACK_MESSAGE_ON_SUCCESS'));
  let failure = maybeSlackify(getEnv('SLACK_MESSAGE_ON_FAILURE'));
  let cancel = maybeSlackify(getEnv('SLACK_MESSAGE_ON_CANCEL'));

  if (!base && commitMessage) {
    base = commitMessage;
  }

  if (!base) {
    const runNumber = getEnv('GITHUB_RUN_NUMBER');
    const sha = getEnv('GITHUB_SHA');
    const branch = getEnv('GITHUB_REF').replace('refs/heads/', '');
    const repo = getEnv('GITHUB_REPOSITORY');
    base = `Notification from action run \`${runNumber}\`, which ran against commit \`${sha}\` from branch \`${branch}\` of \`${repo}\` repository.`;
  }

  if (enableEscapes) {
    base = interpret(base);
    if (success) success = interpret(success);
    if (failure) failure = interpret(failure);
    if (cancel) cancel = interpret(cancel);
  }

  return {base, success, failure, cancel};
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t');
}

async function readHostsContext(workspace: string | undefined, branch: string): Promise<HostsContext> {
  if (!workspace) {
    return {};
  }

  const hostsPath = path.join(workspace, '.github', 'hosts.yml');
  try {
    await fs.access(hostsPath);
  } catch {
    return {};
  }

  try {
    const raw = await fs.readFile(hostsPath, 'utf8');
    const doc = YAML.parse(raw) ?? {};
    const ciOptionsKey = getEnv('CI_SCRIPT_OPTIONS') || 'ci_script_options';
    const ciOptions = typeof doc[ciOptionsKey] === 'object' ? doc[ciOptionsKey] : undefined;
    const slackChannel = typeof ciOptions?.['slack-channel'] === 'string' ? ciOptions['slack-channel'].toLowerCase() : undefined;

    const branchData = branch && typeof doc[branch] === 'object' ? doc[branch] : undefined;
    const hostUser = typeof branchData?.user === 'string' ? branchData.user : undefined;
    const hostNameValue = typeof branchData?.hostname === 'string' ? branchData.hostname : undefined;
    const deployPath = typeof branchData?.deploy_path === 'string' ? branchData.deploy_path : undefined;

    const hostName = hostUser && hostNameValue ? `\`${hostUser}@${hostNameValue}\`` : undefined;
    const siteName = deriveSiteName(deployPath);

    const context: HostsContext = {};
    if (slackChannel) {
      context.channel = slackChannel;
    }
    if (siteName) {
      context.siteName = siteName;
      context.siteTitle = 'Site';
    }
    if (hostName) {
      context.hostName = hostName;
      context.hostTitle = 'SSH Host';
    }

    return context;
  } catch (error) {
    core.warning(`Failed to parse hosts file: ${error}`);
    return {};
  }
}

function deriveSiteName(deployPath?: string): string | undefined {
  if (!deployPath) {
    return undefined;
  }
  const [beforeAppRaw] = deployPath.split('/app');
  const beforeApp = beforeAppRaw ?? deployPath;
  if (!beforeApp) {
    return undefined;
  }
  const marker = 'sites/';
  const index = beforeApp.lastIndexOf(marker);
  if (index === -1) {
    return undefined;
  }
  return beforeApp.substring(index + marker.length);
}

function buildPayload(params: {
  hostsContext: HostsContext;
  eventContext: EventContext;
  message: string;
  successMessage?: string;
  failureMessage?: string;
  cancelMessage?: string;
  threadTs?: string;
}): SlackPayload {
  const {
    hostsContext,
    eventContext,
    message,
    successMessage,
    failureMessage,
    cancelMessage,
    threadTs,
  } = params;

  const username = getEnv('SLACK_USERNAME') || DEFAULT_USERNAME;
  const iconUrl = getEnv('SLACK_ICON') || DEFAULT_ICON;
  const iconEmoji = getEnv('SLACK_ICON_EMOJI');
  const linkNames = getEnv('SLACK_LINK_NAMES');
  const footer = getEnv('SLACK_FOOTER');
  const githubActor = getEnv('SLACK_MSG_AUTHOR') || getEnv('GITHUB_ACTOR');
  const githubServer = getEnv('GITHUB_SERVER_URL') || 'https://github.com';
  const repository = getEnv('GITHUB_REPOSITORY');
  const workflowRaw = getEnv('GITHUB_WORKFLOW');
  const workflow = workflowRaw.startsWith('.github') ? 'Link to action run.yaml' : workflowRaw;
  const githubRunId = getEnv('GITHUB_RUN_ID');
  const githubRun = getEnv('GITHUB_RUN') || (repository && githubRunId ? `${githubServer}/${repository}/actions/runs/${githubRunId}` : '');

  const shaFromEvent = eventContext.pullRequestSha && eventContext.pullRequestSha !== 'null' ? eventContext.pullRequestSha : undefined;
  const githubSha = shaFromEvent || getEnv('GITHUB_SHA');
  const commitShortSha = githubSha ? githubSha.substring(0, 6) : '';
  const githubRef = getEnv('GITHUB_REF');
  const githubEventName = getEnv('GITHUB_EVENT_NAME');

  let text = message;
  let color = getEnv('SLACK_COLOR').toLowerCase();
  switch (color) {
    case 'success':
      color = 'good';
      if (successMessage) {
        text = successMessage;
      }
      break;
    case 'cancelled':
      color = '#808080';
      if (cancelMessage) {
        text = cancelMessage;
      }
      break;
    case 'failure':
      color = 'danger';
      if (failureMessage) {
        text = failureMessage;
      }
      break;
    case 'good':
    case 'warning':
    case 'danger':
      break;
    default:
      color = color || 'good';
  }

  const minimal = getEnv('MSG_MINIMAL');
  const title = getEnv('SLACK_TITLE') || DEFAULT_TITLE;

  const actionsUrl = repository && githubSha
    ? `<${githubServer}/${repository}/commit/${githubSha}/checks|${workflow}>`
    : workflow;

  const commitUrl = repository && githubSha
    ? `<${githubServer}/${repository}/commit/${githubSha}|${commitShortSha}>`
    : commitShortSha;

  const baseFields = buildFields({
    minimal,
    title,
    text,
    githubRef,
    githubEventName,
    actionsUrl,
    commitUrl,
  });

  const siteName = getEnv('SITE_NAME') || hostsContext.siteName;
  if (siteName) {
    const siteTitle = getEnv('SITE_TITLE') || hostsContext.siteTitle || 'Site';
    baseFields.push({
      title: siteTitle,
      value: siteName,
      short: true,
    });
  }

  const hostName = getEnv('HOST_NAME') || hostsContext.hostName;
  if (hostName) {
    const hostTitle = getEnv('HOST_TITLE') || hostsContext.hostTitle || 'SSH Host';
    baseFields.push({
      title: hostTitle,
      value: hostName,
      short: true,
    });
  }

  const fallback = getEnv('SLACK_MESSAGE') ||
    `GITHUB_ACTION=${getEnv('GITHUB_ACTION')} \n GITHUB_ACTOR=${githubActor} \n GITHUB_EVENT_NAME=${githubEventName} \n GITHUB_REF=${githubRef} \n GITHUB_REPOSITORY=${repository} \n GITHUB_WORKFLOW=${workflow}`;

  const footerText = footer || `<https://github.com/tainakanchu/actions-slack-notify|Slack Notify Action> | <${githubRun}|Triggered on this workflow run>`;

  const channel = getEnv('SLACK_CHANNEL') || hostsContext.channel || '';

  const attachment: Attachment = {
    fallback,
    color,
    footer: footerText,
    fields: baseFields,
  };

  if (githubActor) {
    attachment.author_name = githubActor;
    attachment.author_link = `${githubServer}/${githubActor}`;
    attachment.author_icon = `${githubServer}/${githubActor}.png?size=32`;
  }

  const payload: SlackPayload = {
    text,
    username,
    icon_url: iconUrl,
    unfurl_links: false,
    attachments: [attachment],
  };

  if (iconEmoji) {
    payload.icon_emoji = iconEmoji;
  }
  if (channel) {
    payload.channel = channel;
  }
  if (linkNames) {
    payload.link_names = linkNames;
  }
  if (threadTs) {
    payload.thread_ts = threadTs;
  }

  return payload;
}

function buildFields(context: {
  minimal: string;
  title: string;
  text: string;
  githubRef: string;
  githubEventName: string;
  actionsUrl: string;
  commitUrl: string;
}): Field[] {
  const {minimal, title, text, githubRef, githubEventName, actionsUrl, commitUrl} = context;
  const textField: Field = {title, value: text, short: false};

  if (minimal === 'true') {
    return [textField];
  }

  if (minimal) {
    const tokens = minimal.split(',').map((token) => token.trim().toLowerCase()).filter(Boolean);
    const ordered: Field[] = [textField];

    for (const token of tokens) {
      switch (token) {
        case 'ref':
          ordered.unshift({title: 'Ref', value: githubRef, short: true});
          break;
        case 'event':
          ordered.unshift({title: 'Event', value: githubEventName, short: true});
          break;
        case 'actions url':
          ordered.unshift({title: 'Actions URL', value: actionsUrl, short: true});
          break;
        case 'commit':
          ordered.unshift({title: 'Commit', value: commitUrl, short: true});
          break;
        default:
          break;
      }
    }

    return ordered;
  }

  return [
    {title: 'Ref', value: githubRef, short: true},
    {title: 'Event', value: githubEventName, short: true},
    {title: 'Actions URL', value: actionsUrl, short: true},
    {title: 'Commit', value: commitUrl, short: true},
    textField,
  ];
}

async function sendPayload(endpoint: string, payload: SlackPayload, mode: MessageMode): Promise<void> {
  const body = JSON.stringify(payload);
  await sendRaw(endpoint, body, mode);
}

async function sendRaw(endpoint: string, body: string, mode: MessageMode): Promise<void> {
  let response: Response;
  if (mode === 'WEBHOOK') {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Error sending Slack message: ${response.status} ${response.statusText} - ${text}`);
    }
    return;
  } else {
    const token = getEnv('SLACK_TOKEN');
    if (!token) {
      throw new Error('SLACK_TOKEN is required when MSG_MODE is TOKEN.');
    }
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Error sending Slack message: ${response.status} ${response.statusText} - ${text}`);
    }
    const apiResponse = (await response.json()) as SlackApiResponse;
    if (!apiResponse.ok) {
      throw new Error(`Slack API error: ${apiResponse.error || 'unknown error'}`);
    }
  }
}

async function maybeUploadFile(message: string | undefined, channel: string | undefined, threadTs: string | undefined): Promise<void> {
  const uploadPath = getEnv('SLACK_FILE_UPLOAD');
  if (!uploadPath) {
    return;
  }

  const token = getEnv('SLACK_TOKEN');
  if (!token) {
    throw new Error('SLACK_TOKEN is required when SLACK_FILE_UPLOAD is specified.');
  }

  const targetChannel = channel || getEnv('SLACK_CHANNEL');
  if (!targetChannel) {
    throw new Error('SLACK_CHANNEL is required when SLACK_FILE_UPLOAD is specified.');
  }

  const workspace = getEnv('GITHUB_WORKSPACE');
  const resolvedPath = path.isAbsolute(uploadPath) || !workspace
    ? uploadPath
    : path.join(workspace, uploadPath);

  await fs.access(resolvedPath);

  const form = new FormData();
  form.append('file', createReadStream(resolvedPath));
  if (message) {
    form.append('initial_comment', message);
  }
  form.append('channels', targetChannel);
  if (threadTs) {
    form.append('thread_ts', threadTs);
  }

  const response = await fetch('https://slack.com/api/files.upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      ...form.getHeaders(),
    },
    body: form as unknown as any,
  });

  const result = await response.json();
  if (!result.ok) {
    throw new Error(`Error uploading file to Slack: ${JSON.stringify(result)}`);
  }
}

function getEnv(name: string): string {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

run();
