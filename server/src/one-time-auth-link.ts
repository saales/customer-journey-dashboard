export type OneTimeAuthTokenParameter = "token" | "reset";

/** Keep one-time credentials in the URL fragment so HTTP requests and proxy access logs never receive them. */
export function createOneTimeAuthLink(origin: string, parameter: OneTimeAuthTokenParameter, token: string): string {
  const link = new URL("/", origin);
  link.hash = new URLSearchParams({ [parameter]: token }).toString();
  return link.toString();
}
