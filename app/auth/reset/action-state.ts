export type ResetActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  /** The recovery session ended while the form was open. */
  | { status: "expired"; message: string };

export const initialResetActionState: ResetActionState = { status: "idle" };
