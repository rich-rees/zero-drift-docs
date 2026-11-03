// The module hook `zdd-engine test` registers (kit-register.mjs, decision
// 0048, As built slice 4): an adapter's tests import the kit as
// `@rich-rees/zdd`, and a repo whose adapters are in place may have no
// node_modules at all (a Python app runs ZDD through npx). So the name
// resolves to the engine that runs the tests, whatever the repo has
// installed: the kit an adapter is tested with is the one that will hand it
// its io. Every other specifier resolves as Node resolves it.

const KIT = new URL("./kit.mjs", import.meta.url).href;
const NAME = "@rich-rees/zdd";

export async function resolve(specifier, context, next) {
  if (specifier === NAME) return { url: KIT, shortCircuit: true };
  return next(specifier, context);
}
