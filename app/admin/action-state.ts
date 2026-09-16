export type LoginActionState =
  { status: "idle" } | { status: "error"; message: string };

export type RecoveryActionState =
  | { status: "idle" }
  | { status: "sent" }
  | { status: "error"; message: string };

export const initialLoginActionState: LoginActionState = { status: "idle" };
export const initialRecoveryActionState: RecoveryActionState = {
  status: "idle",
};
