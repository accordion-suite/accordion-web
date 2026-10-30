// Calls the server's JSON API. A failed call throws an ApiError whose
// message the page can show as it is: the server writes its errors for the
// person reading them.

import { t } from "./i18n.ts";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? null : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, t("error.offline"));
  }
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = (data as { error?: unknown }).error;
    throw new ApiError(response.status, typeof error === "string" ? error : t("error.problem"));
  }
  return data as T;
}

/** The signed-in user, from `GET /api/session`. */
export interface Session {
  user: {
    id: string;
    username: string;
    display_name: string;
    role: string;
  };
  /** Whether the server's admin pages open for this user here: they're for
   * admins, and usually only on the home network. */
  admin_pages: boolean;
}
