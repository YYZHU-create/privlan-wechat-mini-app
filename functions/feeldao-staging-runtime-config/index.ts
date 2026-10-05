import { createHandler } from './handler.mjs';

// Deploy exclusively to asmhysidbg5g, with platform JWT verification enabled.
// No request/response logging: the successful payload is server-only configuration.
Deno.serve(createHandler({ getEnv: (name: string) => Deno.env.get(name) }));
