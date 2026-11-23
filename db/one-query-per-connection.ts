// Never pipeline queries through Supabase's transaction pooler.
//
// postgres.js pipelines: when every connection is busy it writes the next query on a busy
// connection without waiting for the previous reply (up to 100 deep). Through Supabase's
// transaction-mode pooler (Supavisor, port 6543) a pipelined query can lose its reply: the pooler
// hands the server connection back after the first reply, and the queries behind it never answer.
// postgres.js has no query timeout, so that connection, and with `max: 1` every later query of the
// process, then waits forever. Reproduced on 2026-11-22 against staging with Drizzle and the health
// route's queries: eight concurrent requests left one with a wrong answer and seven hanging, and
// the dev server stayed stuck until restarted (the "Core dev server hangs" known gap).
//
// The gate below admits at most as many queries as the client has connections. postgres.js then
// always finds an idle connection, because a connection is back in its idle list before the
// awaiting code resumes, so nothing is ever pipelined. Queries beyond the limit wait in order.
//
// Only what Drizzle's postgres-js driver uses is wrapped: `unsafe(...)` (awaited directly or through
// `.values()`) and `begin(...)`, which holds one permit for the whole transaction. Queries inside a
// transaction run on its reserved connection, which the pooler keeps until the transaction ends.

import type postgres from "postgres";

type Run<T> = () => PromiseLike<T>;

/** A first-in, first-out limit on how many runs are in flight at once. */
export function createGate(permits: number) {
  if (!Number.isInteger(permits) || permits < 1)
    throw new Error("A query gate needs at least one permit.");
  let active = 0;
  const waiting: (() => void)[] = [];
  const acquire = (): Promise<void> => {
    if (active < permits) {
      active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => waiting.push(resolve));
  };
  // The permit passes straight to the next waiter, so nobody can overtake the queue.
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };
  return {
    async run<T>(run: Run<T>): Promise<T> {
      await acquire();
      try {
        return await run();
      } finally {
        release();
      }
    },
    /** For tests: how many runs are in flight and waiting. */
    state: () => ({ active, waiting: waiting.length }),
  };
}

type Unsafe = (
  query: string,
  parameters?: unknown[],
  options?: unknown
) => PromiseLike<unknown> & { values(): PromiseLike<unknown> };

/**
 * The client, with at most `connections` queries or transactions in flight. Pass the same number
 * as the client's `max`.
 */
export function oneQueryPerConnection<T extends postgres.Sql>(
  client: T,
  connections: number
): T {
  const gate = createGate(connections);
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === "unsafe") {
        const unsafe = Reflect.get(target, property, receiver) as Unsafe;
        return (query: string, parameters?: unknown[], options?: unknown) => {
          // postgres.js queries start when awaited; start this one once, inside the gate.
          let started: Promise<unknown> | undefined;
          const start = (values: boolean) =>
            (started ??= gate.run(() => {
              const pending = unsafe.call(target, query, parameters, options);
              return values ? pending.values() : pending;
            }));
          return {
            then: <A, B>(
              resolve?: ((value: unknown) => A | PromiseLike<A>) | null,
              reject?: ((reason: unknown) => B | PromiseLike<B>) | null
            ) => start(false).then(resolve, reject),
            values: () => start(true),
          };
        };
      }
      if (property === "begin") {
        const begin = Reflect.get(target, property, receiver) as (
          ...args: unknown[]
        ) => PromiseLike<unknown>;
        return (...args: unknown[]) =>
          gate.run(() => begin.apply(target, args));
      }
      return Reflect.get(target, property, receiver);
    },
  });
}
