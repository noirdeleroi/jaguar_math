type CookieLike = { name: string };
type AuthErrorLike = { name?: string } | null;

export function hasSupabaseAuthCookie(cookies: CookieLike[]) {
  return cookies.some(({ name }) => /^sb-.+-auth-token(?:\.\d+)?$/.test(name));
}

export function authFailureRequiresLogin(error: AuthErrorLike, hadAuthCookie: boolean) {
  return !hadAuthCookie || error?.name === "AuthSessionMissingError";
}
