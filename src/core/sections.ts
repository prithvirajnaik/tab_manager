import type { Section, Topic } from './model';
import type { LiveGroup } from './ports';

export type SectionResult = {
  sections: Section[];
  /** groupId -> sectionId for this window's groups. */
  groupLinks: Record<string, string>;
};

/**
 * Mirrors a window's tab groups into the topic's sections. `groups` must be in tab-strip
 * order. A group keeps its section through renames via the session link, or is matched by
 * name after a restart; sections whose group is gone are dropped (their tabs are ungrouped).
 */
export function reconcileSections(
  topic: Topic,
  groups: LiveGroup[],
  groupLinks: Record<string, string>,
  newId: () => string,
  /** Keep sections whose group is not (yet) in the window, as when merging after a restart. */
  keepUnmatched = false,
): SectionResult {
  const own = new Map(topic.sections.map((s) => [s.id, s]));
  const used = new Set<string>();
  const sections: Section[] = [];
  const links: Record<string, string> = {};

  const claim = (g: LiveGroup, id: string) => {
    used.add(id);
    links[String(g.id)] = id;
    sections.push({ id, name: g.title, color: g.color, collapsed: g.collapsed });
  };

  const pending: LiveGroup[] = [];
  for (const g of groups) {
    const linked = groupLinks[String(g.id)];
    if (linked && own.has(linked) && !used.has(linked)) claim(g, linked);
    else pending.push(g);
  }
  for (const g of pending) {
    const byName = topic.sections.find((s) => !used.has(s.id) && s.name === g.title);
    claim(g, byName?.id ?? newId());
  }
  // Restore tab-strip order (pass 2 appended).
  const order = new Map(groups.map((g, i) => [links[String(g.id)], i]));
  sections.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  if (keepUnmatched) sections.push(...topic.sections.filter((s) => !used.has(s.id)));
  return { sections, groupLinks: links };
}
