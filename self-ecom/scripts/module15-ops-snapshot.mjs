// 作用：在独立只读事务中生成全表全列、数据库结构和迁移的稳定摘要，不输出原始行。
import { createHash } from 'node:crypto';

export class OpsError extends Error {
  constructor(code) { super(code); this.name = 'OpsError'; this.code = code; }
}
export function requireCondition(condition, code) { if (!condition) throw new OpsError(code); }
export const identifier = value => '"' + String(value).replaceAll('"', '""') + '"';
export const SNAPSHOT_CANONICAL_VERSION = 2;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const userSchema = "n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast' AND n.nspname !~ '^pg_temp'";

// pg_dump/reparse distributes varchar[] -> text[] casts over constant elements. Normalize only those exact equivalent forms.
// Keep SQL strings/quoted identifiers opaque; unfamiliar comments/dollar quotes remain strict rather than broadening comparison.
export function canonicalSchemaDefinition(sql) {
  const quoted = "'(?:[^']|'')*'", literal = quoted + '::character varying';
  const items = item => '(?:' + item + ')(?:, (?:' + item + '))*';
  const forms = [
    { array: '^\\(ARRAY\\[(' + items(literal) + ')\\]\\)::text\\[\\]', item: '(' + quoted + ')::character varying' },
    { array: '^ARRAY\\[(' + items(literal) + ')\\]::text\\[\\]', item: '(' + quoted + ')::character varying' },
    { array: '^ARRAY\\[(' + items(literal + '::text') + ')\\]', item: '(' + quoted + ')::character varying::text' },
    { array: '^ARRAY\\[(' + items('\\(' + literal + '\\)::text') + ')\\]', item: '\\((' + quoted + ')::character varying\\)::text' },
  ].map(form => ({ array: new RegExp(form.array), item: new RegExp(form.item, 'g') }));
  let output = '';
  for (let index = 0; index < sql.length;) {
    const character = sql[index];
    if (character === "'" || character === '"') {
      const start = index++, escaped = character === "'" && /(?:^|[^A-Za-z0-9_$])[eE]$/.test(sql.slice(0, start));
      let closed = false;
      while (index < sql.length) {
        if (escaped && sql[index] === '\\') { index += 2; continue; }
        if (sql[index++] !== character) continue;
        if (sql[index] === character) { index++; continue; }
        closed = true; break;
      }
      if (!closed) return sql;
      output += sql.slice(start, index); continue;
    }
    if (sql.startsWith('--', index) || sql.startsWith('/*', index) || /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.test(sql.slice(index))) return sql;
    const previous = sql.slice(0, index).trimEnd().at(-1) ?? '';
    const eligible = character === '(' ? !/[A-Za-z0-9_$"\])]/.test(previous) : character === 'A' && !/[A-Za-z0-9_$.]/.test(sql[index - 1] ?? '');
    let matched = false;
    if (eligible) for (const form of forms) {
      const match = form.array.exec(sql.slice(index));
      if (!match) continue;
      output += 'ARRAY[' + match[1].replace(form.item, (_item, value) => value + '::text') + ']';
      index += match[0].length; matched = true; break;
    }
    if (!matched) output += sql[index++];
  }
  return output;
}

export function tableCursorSql(schema, table, columns) {
  const values = columns.map(column => identifier(column.name)).join(',');
  return 'DECLARE m415_rows NO SCROLL CURSOR FOR SELECT canonical_row FROM (SELECT jsonb_build_array(' + values + ')::text AS canonical_row FROM ONLY ' + identifier(schema) + '.' + identifier(table) + ') rows ORDER BY canonical_row COLLATE "C"';
}

export async function databaseIdentity(client) {
  const { rows: [row] } = await client.query("SELECT current_database() AS database, current_setting('server_version_num') AS version, system_identifier::text AS cluster FROM pg_control_system()");
  requireCondition(row && /^16\d{4}$/.test(row.version), 'POSTGRES_16_REQUIRED');
  return row;
}

export async function captureDatabase(client, { exportSnapshot = false, keepTransaction = false } = {}) {
  let active = false;
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'); active = true;
    for (const setting of ["timezone='UTC'", "datestyle='ISO,YMD'", "intervalstyle='iso_8601'", 'extra_float_digits=3', "bytea_output='hex'", "search_path=pg_catalog"]) await client.query('SET LOCAL ' + setting);
    const identity = await databaseIdentity(client);
    const largeObjects = (await client.query('SELECT count(*)::text AS count FROM pg_largeobject_metadata')).rows[0].count;
    requireCondition(largeObjects === '0', 'UNSUPPORTED_LARGE_OBJECTS');
    const snapshot = exportSnapshot ? (await client.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot : undefined;
    const database = (await client.query('SELECT pg_encoding_to_char(encoding) AS encoding, datcollate AS collate, datctype AS ctype, datlocprovider AS provider, daticulocale AS icu FROM pg_database WHERE datname=current_database()')).rows[0];
    const relations = (await client.query("SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind,c.relpersistence AS persistence FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE " + userSchema + " AND c.relkind IN ('r','p','v','m','S','f') ORDER BY n.nspname COLLATE \"C\",c.relname COLLATE \"C\"")).rows;
    requireCondition(!relations.some(row => ['m', 'f'].includes(row.kind)), 'UNSUPPORTED_MATERIALIZED_OR_FOREIGN_TABLE');
    const tables = [];
    for (const relation of relations.filter(row => ['r', 'p'].includes(row.kind))) {
      const columns = (await client.query("SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,a.attidentity AS identity,a.attgenerated AS generated,pg_get_expr(d.adbin,d.adrelid) AS default,c.collname AS collation FROM pg_attribute a JOIN pg_class t ON t.oid=a.attrelid JOIN pg_namespace n ON n.oid=t.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum LEFT JOIN pg_collation c ON c.oid=a.attcollation WHERE n.nspname=$1 AND t.relname=$2 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum", [relation.schema, relation.name])).rows;
      await client.query(tableCursorSql(relation.schema, relation.name, columns));
      const hash = createHash('sha256'); let count = 0n;
      for (;;) {
        const rows = (await client.query('FETCH FORWARD 500 FROM m415_rows')).rows;
        if (!rows.length) break;
        for (const row of rows) {
          requireCondition(typeof row.canonical_row === 'string', 'CANONICAL_ROW_INVALID');
          const bytes = Buffer.from(row.canonical_row, 'utf8');
          hash.update(String(bytes.length) + ':'); hash.update(bytes); hash.update('\n'); count++;
        }
      }
      await client.query('CLOSE m415_rows');
      tables.push({ ...relation, columns, count: count.toString(), sha256: hash.digest('hex') });
    }
    const sequences = [];
    for (const relation of relations.filter(row => row.kind === 'S')) {
      const config = (await client.query("SELECT format_type(s.seqtypid,NULL) AS type,s.seqstart::text AS start,s.seqincrement::text AS increment,s.seqmax::text AS max,s.seqmin::text AS min,s.seqcache::text AS cache,s.seqcycle AS cycle FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2", [relation.schema, relation.name])).rows[0];
      const value = (await client.query('SELECT last_value::text AS value,is_called FROM ' + identifier(relation.schema) + '.' + identifier(relation.name))).rows[0];
      sequences.push({ schema: relation.schema, name: relation.name, config, ...value });
    }
    const schemaQueries = {
      schemas: "SELECT n.nspname AS name FROM pg_namespace n WHERE " + userSchema + " ORDER BY n.nspname COLLATE \"C\"",
      constraints: "SELECT n.nspname AS schema,c.relname AS relation,t.conname AS name,t.contype AS type,pg_get_constraintdef(t.oid,true) AS definition,t.convalidated AS validated,t.condeferrable AS deferrable,t.condeferred AS initially_deferred FROM pg_constraint t JOIN pg_class c ON c.oid=t.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE " + userSchema + " ORDER BY n.nspname COLLATE \"C\",c.relname COLLATE \"C\",t.conname COLLATE \"C\"",
      indexes: "SELECT n.nspname AS schema,c.relname AS relation,i.relname AS name,pg_get_indexdef(i.oid) AS definition,x.indisvalid AS valid FROM pg_index x JOIN pg_class c ON c.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE " + userSchema + " ORDER BY n.nspname COLLATE \"C\",c.relname COLLATE \"C\",i.relname COLLATE \"C\"",
      triggers: "SELECT n.nspname AS schema,c.relname AS relation,t.tgname AS name,t.tgenabled AS enabled,pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE " + userSchema + " AND NOT t.tgisinternal ORDER BY n.nspname COLLATE \"C\",c.relname COLLATE \"C\",t.tgname COLLATE \"C\"",
      functions: "SELECT n.nspname AS schema,p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE " + userSchema + " AND p.prokind IN ('f','p','w') ORDER BY n.nspname COLLATE \"C\",p.proname COLLATE \"C\",pg_get_function_identity_arguments(p.oid) COLLATE \"C\"",
      enums: "SELECT n.nspname AS schema,t.typname AS name,e.enumlabel AS label,e.enumsortorder::text AS ordinal FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE " + userSchema + " ORDER BY n.nspname COLLATE \"C\",t.typname COLLATE \"C\",e.enumsortorder",
      views: "SELECT n.nspname AS schema,c.relname AS name,pg_get_viewdef(c.oid,true) AS definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE " + userSchema + " AND c.relkind='v' ORDER BY n.nspname COLLATE \"C\",c.relname COLLATE \"C\"",
      extensions: "SELECT extname AS name,extversion AS version,extrelocatable AS relocatable FROM pg_extension ORDER BY extname COLLATE \"C\"",
    };
    const schema = {};
    for (const [name, sql] of Object.entries(schemaQueries)) {
      const rows = (await client.query(sql)).rows;
      schema[name] = ['constraints', 'indexes'].includes(name) ? rows.map(row => ({ ...row, definition: canonicalSchemaDefinition(row.definition) })) : rows;
    }
    const migrations = (await client.query('SELECT migration_name,checksum,finished_at::text AS finished_at,rolled_back_at::text AS rolled_back_at,applied_steps_count FROM public._prisma_migrations ORDER BY migration_name COLLATE "C",id COLLATE "C"')).rows;
    requireCondition(migrations.every(row => row.finished_at && !row.rolled_back_at), 'MIGRATION_NOT_COMPLETE');
    const summary = { canonicalVersion: SNAPSHOT_CANONICAL_VERSION, postgresVersion: identity.version, database, tables, sequences, schema, schemaSha256: digest(schema), migrations };
    if (!keepTransaction) { await client.query('COMMIT'); active = false; }
    return { identity, snapshot, summary };
  } catch (error) {
    if (active) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}
