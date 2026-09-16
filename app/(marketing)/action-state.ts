// Plain shared state/types for the registration form's useActionState.
// Deliberately NOT in actions.ts: that file has "use server", and a
// "use server" module may only export async functions — any other export
// (a constant, a type re-export as a value, etc.) crashes at request time
// in a production build with "A 'use server' file can only export async
// functions, found object", even though dev mode and `next build`'s own
// compile step don't catch it. See lib/registrations/README.md's M4 note.

import type { RegisterForEventError } from "@/lib/registrations";

export type RegisterActionState =
  | { status: "idle" }
  | { status: "success"; waitlisted?: boolean }
  | { status: "error"; error: RegisterForEventError };

export const initialRegisterActionState: RegisterActionState = {
  status: "idle",
};
