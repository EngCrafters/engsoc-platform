// Migration 0035's recovery guard: a routine that would leave no account able to manage both
// permissions and administrator access raises LAST_RECOVERY_ACCOUNT, which rolls the whole call
// back. This turns that one database error into the routine's ordinary result code.

export const LAST_RECOVERY_ACCOUNT = "LAST_RECOVERY_ACCOUNT";

/** The database error itself, or one wrapped by the query layer (its `cause`). */
export function isRecoveryGuardError(error: unknown): boolean {
  for (
    let e = error, depth = 0;
    e && typeof e === "object" && depth < 4;
    depth++
  ) {
    if ((e as { message?: unknown }).message === LAST_RECOVERY_ACCOUNT)
      return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

export async function withRecoveryGuard<T>(
  call: () => Promise<T>
): Promise<T | { code: typeof LAST_RECOVERY_ACCOUNT }> {
  try {
    return await call();
  } catch (error) {
    if (isRecoveryGuardError(error)) return { code: LAST_RECOVERY_ACCOUNT };
    throw error;
  }
}

export const LAST_RECOVERY_ACCOUNT_MESSAGE =
  "This would leave no account able to manage permissions and administrator access. Give that access to someone else first.";
