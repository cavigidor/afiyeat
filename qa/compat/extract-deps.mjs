// Lists every Supabase dependency the app's source uses: tables (with the
// operation and the select string), RPCs (with argument names) and storage
// buckets. Reads TypeScript source from a git ref; touches no database.
import { execFileSync } from 'node:child_process';
import ts from '/home/claude/afiyeat/node_modules/typescript/lib/typescript.js';

const [ref, repo = '/home/claude/afiyeat'] = process.argv.slice(2);
const files = execFileSync('git', ['-C', repo, 'ls-tree', '-r', '--name-only', ref, 'src/'], { encoding: 'utf8' })
  .split('\n').filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('/demo/') && !f.includes('integrations/supabase/types'));

const out = { tables: {}, rpcs: {}, buckets: {}, functions: {} };
const unwrap = (n) => { while (n && (ts.isAsExpression(n) || ts.isParenthesizedExpression(n) || ts.isNonNullExpression(n) || ts.isTypeAssertionExpression?.(n))) n = n.expression; return n; };
const lit0 = (n) => (n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : n && ts.isTemplateExpression(n) ? n.getText().slice(1, -1) : null);
const lit = (n) => lit0(unwrap(n));
const add = (o, k, v) => ((o[k] ??= new Set()).add(v));

for (const f of files) {
  const src = execFileSync('git', ['-C', repo, 'show', `${ref}:${f}`], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && /^untypedRpc$/.test(node.expression.text) && lit(node.arguments[0])) {
      const a = node.arguments[1];
      const keys = a && ts.isObjectLiteralExpression(a) ? a.properties.map((p) => p.name?.getText() ?? '…').join(',') : a ? '<expr>' : '';
      add(out.rpcs, lit(node.arguments[0]), `(${keys})  @${f} [untyped]`);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text;
      const arg0 = node.arguments[0];
      if (name === 'from' && lit(arg0)) {
        const target = lit(arg0);
        // Walk up the chain to find what's done to this table / bucket.
        let p = node.parent, ops = [];
        while (p && (ts.isPropertyAccessExpression(p) || ts.isCallExpression(p) || ts.isAwaitExpression(p) || ts.isNonNullExpression(p) || ts.isAsExpression(p) || ts.isParenthesizedExpression(p))) {
          if (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression)) {
            const m = p.expression.name.text;
            if (['select', 'insert', 'update', 'upsert', 'delete'].includes(m)) ops.push(m + (m === 'select' && lit(p.arguments[0]) !== null ? `(${lit(p.arguments[0]).replace(/\s+/g, ' ').trim()})` : m === 'select' ? '(*)' : ''));
            if (['upload', 'getPublicUrl', 'createSignedUrl', 'createSignedUrls', 'remove', 'download', 'list', 'move', 'copy'].includes(m)) ops.push('storage.' + m);
          }
          p = p.parent;
        }
        const isStorage = ops.some((o) => o.startsWith('storage.')) || /storage\s*\.\s*from/.test(node.expression.expression.getText());
        if (isStorage) for (const o of ops.length ? ops : ['storage.?']) add(out.buckets, target, `${o}  @${f}`);
        else for (const o of ops.length ? ops : ['?']) add(out.tables, target, `${o}  @${f}`);
      }
      if (name === 'rpc' && lit(arg0)) {
        const a = node.arguments[1];
        const keys = a && ts.isObjectLiteralExpression(a) ? a.properties.map((p) => p.name?.getText() ?? '…').join(',') : a ? '<expr>' : '';
        add(out.rpcs, lit(arg0), `(${keys})  @${f}`);
      }
      if (name === 'invoke' && lit(arg0) && /functions/.test(node.expression.expression.getText())) add(out.functions, lit(arg0), `@${f}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
const plain = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, [...o[k]].sort()]));
console.log(JSON.stringify({ ref, sha: execFileSync('git', ['-C', repo, 'rev-parse', ref], { encoding: 'utf8' }).trim(), tables: plain(out.tables), rpcs: plain(out.rpcs), buckets: plain(out.buckets), edgeFunctions: plain(out.functions) }, null, 1));
