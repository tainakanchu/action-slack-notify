"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/index.ts
var core = __toESM(require("@actions/core"));
var import_node_fetch = __toESM(require("node-fetch"));
var import_form_data = __toESM(require("form-data"));
var import_fs = require("fs");
var import_fs2 = require("fs");
var import_path = __toESM(require("path"));
var import_yaml = __toESM(require("yaml"));
var import_slackify_markdown = __toESM(require("slackify-markdown"));
var DEFAULT_ICON = "https://avatars0.githubusercontent.com/u/43742164";
var DEFAULT_USERNAME = "rtBot";
var DEFAULT_TITLE = "Message";
async function run() {
  try {
    const workspace = getEnv("GITHUB_WORKSPACE");
    const githubRef = getEnv("GITHUB_REF");
    const branch = githubRef.includes("/") ? githubRef.substring(githubRef.lastIndexOf("/") + 1) : githubRef;
    const hostsContext = await readHostsContext(workspace, branch);
    const mode = determineMessageMode(hostsContext.channel);
    const endpoint = resolveEndpoint(mode);
    const threadTs = getEnv("SLACK_THREAD_TS");
    const eventContext = await readEventContext();
    const enableEscapes = getEnv("ENABLE_ESCAPES") === "true";
    const slackifyEnabled = getEnv("SLACKIFY_MARKDOWN") === "true";
    const messages = deriveMessages(enableEscapes, eventContext.commitMessage, slackifyEnabled);
    if (!messages.base && !getEnv("SLACK_CUSTOM_PAYLOAD")) {
      throw new Error("SLACK_MESSAGE is required. Provide a value or ensure the event payload contains commits.");
    }
    const customPayload = getEnv("SLACK_CUSTOM_PAYLOAD");
    if (customPayload) {
      await sendRaw(endpoint, customPayload, mode);
      await maybeUploadFile(messages.base, hostsContext.channel, threadTs);
      core.info("Successfully sent the message!");
      return;
    }
    const payload = buildPayload({
      hostsContext,
      eventContext,
      message: messages.base || "EOM",
      successMessage: messages.success,
      failureMessage: messages.failure,
      cancelMessage: messages.cancel,
      threadTs
    });
    await sendPayload(endpoint, payload, mode);
    await maybeUploadFile(messages.base, payload.channel, threadTs);
    core.info("Successfully sent the message!");
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}
function determineMessageMode(hostChannel) {
  const webhook = getEnv("SLACK_WEBHOOK");
  if (webhook) {
    return "WEBHOOK";
  }
  const token = getEnv("SLACK_TOKEN");
  const channel = getEnv("SLACK_CHANNEL") || hostChannel;
  if (token && channel) {
    return "TOKEN";
  }
  throw new Error("Either SLACK_WEBHOOK or a combination of SLACK_TOKEN and SLACK_CHANNEL is required.");
}
function resolveEndpoint(mode) {
  if (mode === "WEBHOOK") {
    const endpoint = getEnv("SLACK_WEBHOOK");
    if (!endpoint) {
      throw new Error("SLACK_WEBHOOK is not configured.");
    }
    return endpoint;
  }
  return "https://slack.com/api/chat.postMessage";
}
async function readEventContext() {
  const eventPath = getEnv("GITHUB_EVENT_PATH");
  if (!eventPath) {
    return {};
  }
  try {
    const content = await import_fs2.promises.readFile(eventPath, "utf8");
    const data = JSON.parse(content);
    const commits = Array.isArray(data?.commits) ? data.commits : [];
    const lastCommit = commits.length > 0 ? commits[commits.length - 1] : void 0;
    const commitMessage = typeof lastCommit?.message === "string" ? lastCommit.message : void 0;
    const pullRequestSha = typeof data?.pull_request?.head?.sha === "string" ? data.pull_request.head.sha : void 0;
    return { commitMessage, pullRequestSha };
  } catch (error) {
    core.warning(`Unable to read event payload: ${error}`);
    return {};
  }
}
function deriveMessages(enableEscapes, commitMessage, slackifyEnabled) {
  const interpret = (value) => enableEscapes ? unescapeText(value) : value;
  const maybeSlackify = (value) => {
    if (!slackifyEnabled || !value) {
      return value;
    }
    return (0, import_slackify_markdown.default)(value);
  };
  let base = maybeSlackify(getEnv("SLACK_MESSAGE"));
  let success = maybeSlackify(getEnv("SLACK_MESSAGE_ON_SUCCESS"));
  let failure = maybeSlackify(getEnv("SLACK_MESSAGE_ON_FAILURE"));
  let cancel = maybeSlackify(getEnv("SLACK_MESSAGE_ON_CANCEL"));
  if (!base && commitMessage) {
    base = commitMessage;
  }
  if (!base) {
    const runNumber = getEnv("GITHUB_RUN_NUMBER");
    const sha = getEnv("GITHUB_SHA");
    const branch = getEnv("GITHUB_REF").replace("refs/heads/", "");
    const repo = getEnv("GITHUB_REPOSITORY");
    base = `Notification from action run \`${runNumber}\`, which ran against commit \`${sha}\` from branch \`${branch}\` of \`${repo}\` repository.`;
  }
  if (enableEscapes) {
    base = interpret(base);
    if (success) success = interpret(success);
    if (failure) failure = interpret(failure);
    if (cancel) cancel = interpret(cancel);
  }
  return { base, success, failure, cancel };
}
function unescapeText(value) {
  return value.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "	");
}
async function readHostsContext(workspace, branch) {
  if (!workspace) {
    return {};
  }
  const hostsPath = import_path.default.join(workspace, ".github", "hosts.yml");
  try {
    await import_fs2.promises.access(hostsPath);
  } catch {
    return {};
  }
  try {
    const raw = await import_fs2.promises.readFile(hostsPath, "utf8");
    const doc = import_yaml.default.parse(raw) ?? {};
    const ciOptionsKey = getEnv("CI_SCRIPT_OPTIONS") || "ci_script_options";
    const ciOptions = typeof doc[ciOptionsKey] === "object" ? doc[ciOptionsKey] : void 0;
    const slackChannel = typeof ciOptions?.["slack-channel"] === "string" ? ciOptions["slack-channel"].toLowerCase() : void 0;
    const branchData = branch && typeof doc[branch] === "object" ? doc[branch] : void 0;
    const hostUser = typeof branchData?.user === "string" ? branchData.user : void 0;
    const hostNameValue = typeof branchData?.hostname === "string" ? branchData.hostname : void 0;
    const deployPath = typeof branchData?.deploy_path === "string" ? branchData.deploy_path : void 0;
    const hostName = hostUser && hostNameValue ? `\`${hostUser}@${hostNameValue}\`` : void 0;
    const siteName = deriveSiteName(deployPath);
    const context = {};
    if (slackChannel) {
      context.channel = slackChannel;
    }
    if (siteName) {
      context.siteName = siteName;
      context.siteTitle = "Site";
    }
    if (hostName) {
      context.hostName = hostName;
      context.hostTitle = "SSH Host";
    }
    return context;
  } catch (error) {
    core.warning(`Failed to parse hosts file: ${error}`);
    return {};
  }
}
function deriveSiteName(deployPath) {
  if (!deployPath) {
    return void 0;
  }
  const [beforeAppRaw] = deployPath.split("/app");
  const beforeApp = beforeAppRaw ?? deployPath;
  if (!beforeApp) {
    return void 0;
  }
  const marker = "sites/";
  const index = beforeApp.lastIndexOf(marker);
  if (index === -1) {
    return void 0;
  }
  return beforeApp.substring(index + marker.length);
}
function buildPayload(params) {
  const {
    hostsContext,
    eventContext,
    message,
    successMessage,
    failureMessage,
    cancelMessage,
    threadTs
  } = params;
  const username = getEnv("SLACK_USERNAME") || DEFAULT_USERNAME;
  const iconUrl = getEnv("SLACK_ICON") || DEFAULT_ICON;
  const iconEmoji = getEnv("SLACK_ICON_EMOJI");
  const linkNames = getEnv("SLACK_LINK_NAMES");
  const footer = getEnv("SLACK_FOOTER");
  const githubActor = getEnv("SLACK_MSG_AUTHOR") || getEnv("GITHUB_ACTOR");
  const githubServer = getEnv("GITHUB_SERVER_URL") || "https://github.com";
  const repository = getEnv("GITHUB_REPOSITORY");
  const workflowRaw = getEnv("GITHUB_WORKFLOW");
  const workflow = workflowRaw.startsWith(".github") ? "Link to action run.yaml" : workflowRaw;
  const githubRunId = getEnv("GITHUB_RUN_ID");
  const githubRun = getEnv("GITHUB_RUN") || (repository && githubRunId ? `${githubServer}/${repository}/actions/runs/${githubRunId}` : "");
  const shaFromEvent = eventContext.pullRequestSha && eventContext.pullRequestSha !== "null" ? eventContext.pullRequestSha : void 0;
  const githubSha = shaFromEvent || getEnv("GITHUB_SHA");
  const commitShortSha = githubSha ? githubSha.substring(0, 6) : "";
  const githubRef = getEnv("GITHUB_REF");
  const githubEventName = getEnv("GITHUB_EVENT_NAME");
  let text = message;
  let color = getEnv("SLACK_COLOR").toLowerCase();
  switch (color) {
    case "success":
      color = "good";
      if (successMessage) {
        text = successMessage;
      }
      break;
    case "cancelled":
      color = "#808080";
      if (cancelMessage) {
        text = cancelMessage;
      }
      break;
    case "failure":
      color = "danger";
      if (failureMessage) {
        text = failureMessage;
      }
      break;
    case "good":
    case "warning":
    case "danger":
      break;
    default:
      color = color || "good";
  }
  const minimal = getEnv("MSG_MINIMAL");
  const title = getEnv("SLACK_TITLE") || DEFAULT_TITLE;
  const actionsUrl = repository && githubSha ? `<${githubServer}/${repository}/commit/${githubSha}/checks|${workflow}>` : workflow;
  const commitUrl = repository && githubSha ? `<${githubServer}/${repository}/commit/${githubSha}|${commitShortSha}>` : commitShortSha;
  const baseFields = buildFields({
    minimal,
    title,
    text,
    githubRef,
    githubEventName,
    actionsUrl,
    commitUrl
  });
  const siteName = getEnv("SITE_NAME") || hostsContext.siteName;
  if (siteName) {
    const siteTitle = getEnv("SITE_TITLE") || hostsContext.siteTitle || "Site";
    baseFields.push({
      title: siteTitle,
      value: siteName,
      short: true
    });
  }
  const hostName = getEnv("HOST_NAME") || hostsContext.hostName;
  if (hostName) {
    const hostTitle = getEnv("HOST_TITLE") || hostsContext.hostTitle || "SSH Host";
    baseFields.push({
      title: hostTitle,
      value: hostName,
      short: true
    });
  }
  const fallback = getEnv("SLACK_MESSAGE") || `GITHUB_ACTION=${getEnv("GITHUB_ACTION")} 
 GITHUB_ACTOR=${githubActor} 
 GITHUB_EVENT_NAME=${githubEventName} 
 GITHUB_REF=${githubRef} 
 GITHUB_REPOSITORY=${repository} 
 GITHUB_WORKFLOW=${workflow}`;
  const footerText = footer || `<https://github.com/tainakanchu/actions-slack-notify|Slack Notify Action> | <${githubRun}|Triggered on this workflow run>`;
  const channel = getEnv("SLACK_CHANNEL") || hostsContext.channel || "";
  const attachment = {
    fallback,
    color,
    footer: footerText,
    fields: baseFields
  };
  if (githubActor) {
    attachment.author_name = githubActor;
    attachment.author_link = `${githubServer}/${githubActor}`;
    attachment.author_icon = `${githubServer}/${githubActor}.png?size=32`;
  }
  const payload = {
    text,
    username,
    icon_url: iconUrl,
    unfurl_links: false,
    attachments: [attachment]
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
function buildFields(context) {
  const { minimal, title, text, githubRef, githubEventName, actionsUrl, commitUrl } = context;
  const textField = { title, value: text, short: false };
  if (minimal === "true") {
    return [textField];
  }
  if (minimal) {
    const tokens = minimal.split(",").map((token) => token.trim().toLowerCase()).filter(Boolean);
    const ordered = [textField];
    for (const token of tokens) {
      switch (token) {
        case "ref":
          ordered.unshift({ title: "Ref", value: githubRef, short: true });
          break;
        case "event":
          ordered.unshift({ title: "Event", value: githubEventName, short: true });
          break;
        case "actions url":
          ordered.unshift({ title: "Actions URL", value: actionsUrl, short: true });
          break;
        case "commit":
          ordered.unshift({ title: "Commit", value: commitUrl, short: true });
          break;
        default:
          break;
      }
    }
    return ordered;
  }
  return [
    { title: "Ref", value: githubRef, short: true },
    { title: "Event", value: githubEventName, short: true },
    { title: "Actions URL", value: actionsUrl, short: true },
    { title: "Commit", value: commitUrl, short: true },
    textField
  ];
}
async function sendPayload(endpoint, payload, mode) {
  const body = JSON.stringify(payload);
  await sendRaw(endpoint, body, mode);
}
async function sendRaw(endpoint, body, mode) {
  let response;
  if (mode === "WEBHOOK") {
    response = await (0, import_node_fetch.default)(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Error sending Slack message: ${response.status} ${response.statusText} - ${text}`);
    }
    return;
  } else {
    const token = getEnv("SLACK_TOKEN");
    if (!token) {
      throw new Error("SLACK_TOKEN is required when MSG_MODE is TOKEN.");
    }
    response = await (0, import_node_fetch.default)(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Error sending Slack message: ${response.status} ${response.statusText} - ${text}`);
    }
    const apiResponse = await response.json();
    if (!apiResponse.ok) {
      throw new Error(`Slack API error: ${apiResponse.error || "unknown error"}`);
    }
  }
}
async function maybeUploadFile(message, channel, threadTs) {
  const uploadPath = getEnv("SLACK_FILE_UPLOAD");
  if (!uploadPath) {
    return;
  }
  const token = getEnv("SLACK_TOKEN");
  if (!token) {
    throw new Error("SLACK_TOKEN is required when SLACK_FILE_UPLOAD is specified.");
  }
  const targetChannel = channel || getEnv("SLACK_CHANNEL");
  if (!targetChannel) {
    throw new Error("SLACK_CHANNEL is required when SLACK_FILE_UPLOAD is specified.");
  }
  const workspace = getEnv("GITHUB_WORKSPACE");
  const resolvedPath = import_path.default.isAbsolute(uploadPath) || !workspace ? uploadPath : import_path.default.join(workspace, uploadPath);
  await import_fs2.promises.access(resolvedPath);
  const form = new import_form_data.default();
  form.append("file", (0, import_fs.createReadStream)(resolvedPath));
  if (message) {
    form.append("initial_comment", message);
  }
  form.append("channels", targetChannel);
  if (threadTs) {
    form.append("thread_ts", threadTs);
  }
  const response = await (0, import_node_fetch.default)("https://slack.com/api/files.upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...form.getHeaders()
    },
    body: form
  });
  const result = await response.json();
  if (!result.ok) {
    throw new Error(`Error uploading file to Slack: ${JSON.stringify(result)}`);
  }
}
function getEnv(name) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}
run();
//# sourceMappingURL=index.js.map