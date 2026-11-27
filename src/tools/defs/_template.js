/*
 * TEMPLATE for a new tool (function). Files starting with "_" are ignored.
 * Easiest way: run   npm run new -- tool my_tool_name
 *
 * 1. name: lowercase_with_underscores. Agents reference it as design:<name>.
 * 2. description: tell the model WHAT it does and WHEN to use it. This is what it reads.
 * 3. input: zod fields. The model must send these. Add .describe('…') to explain a field.
 * 4. readOnly: true only if it never changes anything (no file writes, no network calls).
 *    Anything else must be false: you'll be asked before each use.
 * 5. run(args, ctx): return any data (object or string). Throw an Error to report a problem.
 *    ctx.roots[0] is the project folder. Use isInside() before touching any path.
 * 6. Run `npm run check`, then restart dea.
 */
import { z } from 'zod';

export default {
  name: '__NAME__',
  description: 'Describe what this tool does and when the agent should use it.',
  input: {
    text: z.string().describe('The input to work on'),
  },
  readOnly: true,
  async run({ text }, ctx) {
    return { length: text.length };
  },
};
