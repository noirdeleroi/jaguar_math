export const MIN_STUDENT_PASSWORD_LENGTH = 4;

const SUPABASE_MIN_PASSWORD_LENGTH = 6;
const SHORT_PASSWORD_PREFIX = "JaguarMath-Student-PIN-v1:";

/** Keep existing passwords unchanged while making 4–5 character student PINs
 * compatible with Supabase Auth's six-character platform minimum. */
export function passwordForAuthentication(password: string) {
  return password.length < SUPABASE_MIN_PASSWORD_LENGTH ? `${SHORT_PASSWORD_PREFIX}${password}` : password;
}
