import { AsyncLocalStorage } from "node:async_hooks";

/** The request being handled, so next/headers stand-ins can read it (one per request). */
const current = new AsyncLocalStorage<Request>();
export const runWithRequest = <T>(request: Request, fn: () => T) => current.run(request, fn);
export const currentRequest = () => current.getStore();
