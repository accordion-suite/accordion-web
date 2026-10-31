// Some changes, such as creating an app password, need a sign-in from the
// last 15 minutes. The server refuses them with 403 and a message that
// starts "For your security", which is how the app tells this refusal from
// others, such as a standard account trying an admin's action.

import { ApiError } from "../api.ts";

export function needsPassword(problem: unknown): problem is ApiError {
  return problem instanceof ApiError && problem.status === 403 && problem.message.startsWith("For your security");
}
