import { ConnectionError } from "./connection.js";

/**
 * Settles like `promise`, or rejects with `onTimeout()` when `promise` has not settled
 * within `ms`. `promise` itself goes on; `onTimeout` is the place to clean up after it.
 */
export function withDeadline<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/** A host error for a system that did not answer within `ms`. */
export function noAnswerError(host: string, ms: number): ConnectionError {
  return new ConnectionError(
    "host",
    `No answer from ${host} within ${Math.round(ms / 1000)} seconds. The system may be busy, ` +
      "or a firewall drops traffic to its host server ports (449 and 8470-8476).",
  );
}
