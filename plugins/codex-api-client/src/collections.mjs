const uuid = () => globalThis.crypto.randomUUID();
export function normalizeCollection(input) {
  const c = structuredClone(input);
  c.info = { ...c.info, _postman_id: c.info?._postman_id || uuid(), schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' };
  const seen = new Set();
  const visit = root => (root.item || []).forEach(item => {
    if (!item.id || seen.has(item.id)) item.id = uuid();
    seen.add(item.id); visit(item);
  });
  c.item ||= []; visit(c); return c;
}
export function findItem(root, id, parents = []) {
  for (const [index, item] of (root.item || []).entries()) {
    if (item.id === id) return { item, parent: root, index, parents };
    const nested = findItem(item, id, [...parents, item]);
    if (nested) return nested;
  }
  return null;
}
export function moveItem(input, id, parentId, position) {
  const c = structuredClone(input), source = findItem(c, id);
  const target = parentId ? findItem(c, parentId)?.item : c;
  if (!source || !target || !Array.isArray(target.item)) throw new Error('NOT_FOUND: 请求或目标文件夹不存在');
  if (source.item === target || findItem(source.item, parentId)) throw new Error('CYCLE: 不能移动到自身或子文件夹');
  source.parent.item.splice(source.index, 1);
  target.item.splice(Math.max(0, Math.min(position, target.item.length)), 0, source.item);
  return c;
}
export function duplicateItem(input, id) {
  const c = structuredClone(input), source = findItem(c, id);
  if (!source) throw new Error('NOT_FOUND');
  const copy = structuredClone(source.item);
  const rekey = item => { item.id = uuid(); (item.item || []).forEach(rekey); };
  rekey(copy); copy.name += ' 副本'; source.parent.item.splice(source.index + 1, 0, copy); return c;
}
export function selectCollection(input, id) {
  if (!id) return structuredClone(input);
  const c = structuredClone(input), found = findItem(c, id);
  if (!found) throw new Error('NOT_FOUND: 请求或文件夹不存在');
  // Keep the ancestor chain so auth, variables and scripts inherit exactly as saved.
  let selected = found.item;
  for (const parent of found.parents.toReversed()) selected = { ...parent, item: [selected] };
  c.item = [selected]; return c;
}
export function flattenRequests(root, path = []) {
  return (root.item || []).flatMap(item => item.item ? flattenRequests(item, [...path, item.name]) : [{ ...item, path: [...path, item.name].join(' / ') }]);
}
