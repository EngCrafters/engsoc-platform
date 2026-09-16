export type ResetActionState =
  { status: "idle" } | { status: "error"; message: string };

export const initialResetActionState: ResetActionState = { status: "idle" };
