/** Replace docs_ai task tags with Markdown tasks from Task v2. */

import { createClient, fetchWithAuth } from "../client.js";
import type { AuthInfo, GlobalOpts } from "../types/index.js";
import { pLimit } from "../utils/concurrency.js";
import { CliError } from "../utils/errors.js";
import { withScopeRecovery } from "../utils/scope-prompt.js";
import { validateToken } from "../utils/validate.js";

const TASK_TAG_RE =
  /<task\b[^>]*\btask-id=(["'])([^"']+)\1[^>]*>(?:\s*<\/task>)?/g;

interface TaskMember {
  id?: string;
  role?: string;
  name?: string;
}

interface TaskDetail {
  summary?: string;
  status?: string;
  completed_at?: string;
  members?: TaskMember[];
}

interface TaskResponse {
  task?: TaskDetail;
}

export async function enrichTaskTags(
  markdown: string,
  globalOpts: GlobalOpts,
): Promise<string> {
  const taskIds = [
    ...new Set([...markdown.matchAll(TASK_TAG_RE)].map((match) => match[2])),
  ];
  if (taskIds.length === 0) return markdown;

  const tasks = await withScopeRecovery(async () => {
    const { authInfo } = await createClient(globalOpts);
    const limit = pLimit(5);
    return Promise.all(
      taskIds.map((taskId) => limit(() => fetchTask(authInfo, taskId))),
    );
  }, globalOpts, ["task:task:read"], { autoAuthorize: true });
  const taskMap = new Map(taskIds.map((taskId, index) => [taskId, tasks[index]]));

  return markdown.replace(TASK_TAG_RE, (tag, _quote, taskId: string) => {
    const task = taskMap.get(taskId);
    return task ? renderTask(task, taskId) : tag;
  });
}

async function fetchTask(
  authInfo: AuthInfo,
  taskId: string,
): Promise<TaskDetail> {
  validateToken(taskId, "task_id");
  try {
    const res = await fetchWithAuth<TaskResponse>(
      authInfo,
      `/open-apis/task/v2/tasks/${encodeURIComponent(taskId)}`,
      { params: { user_id_type: "open_id" } },
    );
    if (!res.data?.task) {
      throw new CliError("API_ERROR", `Task API 未返回任务详情: ${taskId}`, {
        recovery: "确认当前用户可以查看该任务",
      });
    }
    return res.data.task;
  } catch (err) {
    if (
      err instanceof CliError &&
      err.errorType === "SCOPE_MISSING"
    ) {
      throw new CliError("SCOPE_MISSING", "缺少权限: task:task:read", {
        apiCode: err.apiCode,
        missingScopes: ["task:task:read"],
        recovery: 'feishu-docs authorize --scope "task:task:read"',
      });
    }
    throw err;
  }
}

function renderTask(task: TaskDetail, taskId: string): string {
  const completed =
    task.status === "done" || Number(task.completed_at) > 0;
  const summary = (task.summary || taskId).replace(/\s+/g, " ").trim();
  const assignees = [
    ...new Set(
      (task.members ?? [])
        .filter((member) => member.role === "assignee")
        .map((member) => member.name || member.id)
        .filter((name): name is string => !!name),
    ),
  ];
  return `- [${completed ? "x" : " "}] ${summary}${assignees.map((name) => ` @${name}`).join("")}`;
}
