// Calls the server's JSON API. A failed call throws an ApiError whose
// message the page can show as it is: the server writes its errors for the
// person reading them. Some errors also have a code, such as
// "password_needed", for the app to act on, since the message can change.

import { t } from "./i18n.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  return send(method, path, {
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
  });
}

/** Like `api`, for a body that isn't JSON, such as a file's text, and
 * headers of its own. */
export async function send<T>(method: string, path: string, init: { headers: HeadersInit; body: BodyInit | null }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { method, ...init });
  } catch {
    throw new ApiError(0, t("error.offline"));
  }
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const { error, code } = data as { error?: unknown; code?: unknown };
    throw new ApiError(
      response.status,
      typeof error === "string" ? error : t("error.problem"),
      typeof code === "string" ? code : null,
    );
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
  /** The modules that are on and live in the web app, such as "drive" and
   * "notes". Servers from before Notes don't send it. */
  modules?: string[];
}

/** The modules that are on. A server from before Notes had only Drive,
 * such as one that's still running while its web app was updated. */
export function modulesOn(session: Session): readonly string[] {
  return session.modules ?? ["drive"];
}
