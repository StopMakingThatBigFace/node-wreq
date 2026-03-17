import type {
  AfterResponseContext,
  BeforeErrorContext,
  BeforeRequestContext,
  Hooks,
  InitContext,
} from './types';
import type { Response } from './response';

export function mergeHooks(base?: Hooks, override?: Hooks): Hooks | undefined {
  if (!base && !override) {
    return undefined;
  }

  return {
    init: [...(base?.init ?? []), ...(override?.init ?? [])],
    beforeRequest: [...(base?.beforeRequest ?? []), ...(override?.beforeRequest ?? [])],
    afterResponse: [...(base?.afterResponse ?? []), ...(override?.afterResponse ?? [])],
    beforeRetry: [...(base?.beforeRetry ?? []), ...(override?.beforeRetry ?? [])],
    beforeError: [...(base?.beforeError ?? []), ...(override?.beforeError ?? [])],
  };
}

export async function runInitHooks(hooks: Hooks | undefined, context: InitContext): Promise<void> {
  for (const hook of hooks?.init ?? []) {
    await hook(context);
  }
}

export async function runBeforeRequestHooks(
  hooks: Hooks | undefined,
  context: BeforeRequestContext,
): Promise<Response | undefined> {
  for (const hook of hooks?.beforeRequest ?? []) {
    const result = await hook(context);

    if (result) {
      return result;
    }
  }

  return undefined;
}

export async function runAfterResponseHooks(
  hooks: Hooks | undefined,
  context: AfterResponseContext,
): Promise<Response> {
  let current = context.response;

  for (const hook of hooks?.afterResponse ?? []) {
    const result = await hook({ ...context, response: current });

    if (result) {
      current = result;
    }
  }

  return current;
}

export async function runBeforeErrorHooks(
  hooks: Hooks | undefined,
  context: BeforeErrorContext,
): Promise<Error> {
  let current = context.error;

  for (const hook of hooks?.beforeError ?? []) {
    const result = await hook({ ...context, error: current });
    if (result) {
      current = result;
    }
  }

  return current;
}
