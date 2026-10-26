/** Development-only React Native render inspection; not physical touch automation. */
type Fiber = { tag?: number; memoizedProps?: unknown; child?: Fiber | null; sibling?: Fiber | null };
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
function roots(): Fiber[] {
  const hook: unknown = Reflect.get(globalThis,'__REACT_DEVTOOLS_GLOBAL_HOOK__');
  if (!object(hook) || typeof hook.getFiberRoots !== 'function' || !(hook.renderers instanceof Map)) throw Error('REACT_RENDER_INSPECTION_UNAVAILABLE');
  const result: Fiber[] = [];
  for (const id of hook.renderers.keys()) {
    const set: unknown = Reflect.apply(hook.getFiberRoots,hook,[id]);
    if (!(set instanceof Set)) continue;
    for (const root of set) if (object(root) && object(root.current)) result.push(root.current);
  }
  return result;
}
function walk(start: Fiber[]): Fiber[] {
  const nodes: Fiber[] = [], pending = [...start], seen = new Set<Fiber>();
  while (pending.length && nodes.length < 40000) { const f = pending.pop(); if (!f || seen.has(f)) continue; seen.add(f); nodes.push(f); if (f.child) pending.push(f.child); if (f.sibling) pending.push(f.sibling); }
  return nodes;
}
function text(f: Fiber): string {
  // Only native text leaves, so composite Text wrappers do not duplicate every label.
  return walk(f.child ? [f.child] : []).filter(n => n.tag === 6 && typeof n.memoizedProps === 'string').map(n => n.memoizedProps).join('').trim();
}
export const integrationUI = {
  inspect() {
    const nodes = walk(roots());
    return { texts: nodes.filter(n => n.tag === 6 && typeof n.memoizedProps === 'string').map(n => n.memoizedProps),
      inputs: nodes.flatMap(n => object(n.memoizedProps) && typeof n.memoizedProps.onChangeText === 'function' ? [{ placeholder: n.memoizedProps.placeholder, value: n.memoizedProps.value }] : []) };
  },
  press(label: string) {
    const node = walk(roots()).find(f => object(f.memoizedProps) && typeof f.memoizedProps.onPress === 'function' &&
      (f.memoizedProps.accessibilityLabel === label || text(f) === label));
    if (!node || !object(node.memoizedProps)) throw Error('UI_BUTTON_NOT_FOUND');
    if (node.memoizedProps.disabled === true) throw Error('UI_BUTTON_DISABLED');
    const callback = node.memoizedProps.onPress; if (typeof callback !== 'function') throw Error('UI_BUTTON_NOT_FOUND');
    Reflect.apply(callback,undefined,[]); return { invoked: label };
  },
  fill(placeholder: string, value: string, index = 0) {
    const nodes = walk(roots()).filter(f => object(f.memoizedProps) && (f.memoizedProps.placeholder === placeholder || f.memoizedProps.label === placeholder) && typeof f.memoizedProps.onChangeText === 'function');
    const node = nodes[index]; if (!node || !object(node.memoizedProps)) throw Error('UI_INPUT_NOT_FOUND');
    if (node.memoizedProps.editable === false) throw Error('UI_INPUT_LOCKED');
    const callback = node.memoizedProps.onChangeText; if (typeof callback !== 'function') throw Error('UI_INPUT_NOT_FOUND');
    Reflect.apply(callback,undefined,[value]); return { changed: placeholder };
  },
};
