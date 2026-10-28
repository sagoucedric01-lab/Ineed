// Convertit un schéma Prisma issu de `prisma db pull` (noms snake_case de la base) en schéma idiomatique :
// modèles en PascalCase au singulier, champs en camelCase, enums en PascalCase, relations nommées
// d'après leur clé étrangère. Les noms de la base sont conservés via @map / @@map.
//
// Outil ponctuel : il a servi à produire prisma/schema.prisma depuis la migration initiale.
// Ensuite, schema.prisma est maintenu à la main et `pnpm migrate:check-drift` garantit sa cohérence.
// Usage : node scripts/prisma-camelize.mjs <entrée.prisma> > prisma/schema.prisma
import { readFileSync } from 'node:fs';

const camel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
const pascal = (s) => camel(s).replace(/^./, (c) => c.toUpperCase());

/** Nom de modèle singulier à partir du nom de table. */
export function modelName(table) {
  const words = table.split('_');
  let last = words.at(-1);
  const invariant = ['media', 'history', 'off', 'sys', 'hours'];
  if (last === 'hours') last = 'hour';
  else if (invariant.includes(last)) { /* inchangé */ }
  else if (last.endsWith('ies')) last = last.slice(0, -3) + 'y';
  else if (last.endsWith('sses')) last = last.slice(0, -2);
  else if (last.endsWith('s') && !last.endsWith('ss')) last = last.slice(0, -1);
  return pascal([...words.slice(0, -1), last].join('_'));
}

/** Pluriel en camelCase d'un nom de modèle (pour les relations inverses). */
export function pluralCamel(name) {
  const c = name.charAt(0).toLowerCase() + name.slice(1);
  if (/(Media|Off)$/.test(c)) return c;
  if (/History$/.test(c)) return c.replace(/History$/, 'Histories');
  if (/[^aeiou]y$/.test(c)) return c.slice(0, -1) + 'ies';
  if (/(s|x|ch|sh)$/.test(c)) return c + 'es';
  return c + 's';
}

function parse(src) {
  const blocks = [];
  const lines = src.split('\n');
  let pending = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(model|enum)\s+(\w+)\s*\{/.exec(lines[i]);
    if (!m) {
      if (/^(generator|datasource)\b/.test(lines[i])) {
        const body = [lines[i]];
        while (!/^\}/.test(lines[++i])) body.push(lines[i]);
        body.push('}');
        blocks.push({ kind: 'raw', text: [...pending, ...body].join('\n') });
        pending = [];
      } else if (lines[i].startsWith('///') || lines[i].startsWith('//')) pending.push(lines[i]);
      continue;
    }
    const body = [];
    while (!/^\}/.test(lines[++i])) body.push(lines[i]);
    blocks.push({ kind: m[1], name: m[2], comments: pending, body });
    pending = [];
  }
  return blocks;
}

function parseField(line) {
  const m = /^ {2}(\w+)\s+(\w+)(\[\]|\?)?(?:\(([^)]*)\))?(.*)$/.exec(line);
  if (!m || line.trim().startsWith('@@') || line.trim().startsWith('//')) return null;
  return { name: m[1], base: m[2], mod: m[3] ?? '', typeArgs: m[4], rest: m[5] };
}

export function convert(src) {
  const blocks = parse(src);
  const models = new Map(blocks.filter((b) => b.kind === 'model').map((b) => [b.name, b]));
  const enums = new Map(blocks.filter((b) => b.kind === 'enum').map((b) => [b.name, pascal(b.name)]));
  const newModel = (t) => modelName(t);

  // Pass 1 : champs de chaque modèle et noms des relations côté clé étrangère.
  for (const m of models.values()) {
    m.fields = m.body.map(parseField).filter(Boolean);
    m.scalarNames = new Map(m.fields.filter((f) => !models.has(f.base)).map((f) => [f.name, camel(f.name)]));
    for (const f of m.fields.filter((x) => models.has(x.base))) {
      const fk = /fields:\s*\[([^\]]+)\]/.exec(f.rest);
      f.relName = /@relation\("([^"]+)"/.exec(f.rest)?.[1] ?? null;
      if (fk) {
        const cols = fk[1].split(',').map((s) => s.trim());
        let n = camel(cols[0].replace(/_id$/, ''));
        if (cols.length > 1 || [...m.scalarNames.values()].includes(n)) n += newModel(f.base);
        f.newName = n;
        f.fkCols = cols;
      }
    }
  }
  // Pass 2 : relations inverses (listes ou 1-1 sans clé étrangère).
  for (const m of models.values()) {
    for (const f of m.fields.filter((x) => models.has(x.base) && !x.fkCols)) {
      const source = models.get(f.base);
      const toUs = source.fields.filter((x) => x.base === m.name && x.fkCols);
      const fkSide = f.relName ? toUs.find((x) => x.relName === f.relName) : toUs[0];
      let n;
      if (source === m) n = f.mod === '[]' ? 'children' : 'child';
      else n = f.mod === '[]' ? pluralCamel(newModel(source.name)) : camel(newModel(source.name).replace(/^./, (c) => c.toLowerCase()));
      if (toUs.length > 1 && source !== m && fkSide) n += 'As' + pascal(fkSide.newName);
      f.newName = n;
    }
  }

  const renameList = (list, model) => list.replace(/\w+/g, (w) => (model.scalarNames.has(w) ? model.scalarNames.get(w) : w));
  const out = [];
  for (const b of blocks) {
    if (b.kind === 'raw') { out.push(b.text, ''); continue; }
    if (b.kind === 'enum') {
      out.push(...b.comments, `enum ${enums.get(b.name)} {`, ...b.body.filter((l) => l.trim() !== ''), '', `  @@map("${b.name}")`, '}', '');
      continue;
    }
    const m = models.get(b.name);
    const lines = [];
    for (const line of b.body) {
      const parsed = parseField(line);
      const f = parsed && m.fields.find((x) => x.name === parsed.name);
      if (!f) {
        const t = line.trim();
        if (t.startsWith('@@')) {
          // Remplace uniquement les noms de champs dans la première liste [ ... ] de l'attribut.
          lines.push(line.replace(/\[([^\]]*)\]/, (_, inner) => `[${renameList(inner, m)}]`));
        } else lines.push(line);
        continue;
      }
      const isRel = models.has(f.base);
      const name = isRel ? f.newName : m.scalarNames.get(f.name);
      let type = isRel ? newModel(f.base) : enums.get(f.base) ?? f.base;
      if (f.typeArgs !== undefined) type += `(${f.typeArgs})`;
      let rest = f.rest;
      if (isRel) {
        rest = rest
          .replace(/fields:\s*\[([^\]]+)\]/, (_, l) => `fields: [${renameList(l, m)}]`)
          .replace(/references:\s*\[([^\]]+)\]/, (_, l) => `references: [${renameList(l, models.get(f.base))}]`);
      } else if (name !== f.name) {
        rest = `${rest} @map("${f.name}")`;
      }
      lines.push(`  ${name} ${type}${f.mod}${rest}`.replace(/\s+$/, ''));
    }
    const mapped = newModel(b.name) !== b.name;
    if (b.name === 'spatial_ref_sys') lines.push('', '  @@ignore');
    if (mapped) lines.push(`  @@map("${b.name}")`);
    out.push(...b.comments, `model ${newModel(b.name)} {`, ...lines, '}', '');
  }
  return out.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(convert(readFileSync(process.argv[2], 'utf8')));
}
