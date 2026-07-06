/* eslint-disable no-console */
require('dotenv').config();
const { Client } = require('pg');

const APPLY = process.argv.includes('--apply');
const mathCommand = /\\(?:frac|sqrt|int|sum|lim|sin|cos|tan|theta|alpha|beta|gamma|delta|pi|phi|psi|omega|lambda|sigma|mu|nu|zeta|eta|iota|kappa|tau|upsilon|xi|chi|rho)\b|√/;

function hasMathDelimiter(value) {
  return /(?<!\\)\$|\\\(|\\\[/.test(value);
}

// Deliberately limited to math-only lines. Embedded prose is too ambiguous for
// a safe automatic migration and remains handled by the frontend formatter.
function addMathDelimiters(value) {
  if (!value) return value;
  return value.split(/(\r?\n)/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed || hasMathDelimiter(trimmed) || !mathCommand.test(trimmed)) return line;

    const prefix = line.match(/^\s*(?:(?:\d+|[A-Da-d])[.)]\s*|[-*]\s*)?/)?.[0] || '';
    const body = line.slice(prefix.length).trim();
    if (!/[=+\-*/^_{}\\√]/.test(body)) return line;

    const proseWithoutCommands = body.replace(/\\[A-Za-z]+/g, '');
    const sentenceLike = /[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(proseWithoutCommands);
    const startsLikeMath = /^[A-Za-z]\s*=/.test(body)
      || /^(?:\\(?:frac|sqrt|int|sum|lim)|√|\d+\s*[+\-*/=]|\(?\s*[A-Za-z0-9]+\s*[+\-*/=])/.test(body);
    if (sentenceLike && !startsLikeMath) return line;

    const leading = line.slice(0, line.indexOf(trimmed));
    const trailing = line.slice(line.indexOf(trimmed) + trimmed.length);
    return `${leading}${prefix.trimStart()}$${body}$${trailing}`;
  }).join('');
}

function dbOptions() {
  if (process.env.COACHING_DB_URL) {
    return { connectionString: process.env.COACHING_DB_URL, ssl: { rejectUnauthorized: false } };
  }
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'apexiq',
  };
}

function preview(value, max = 180) {
  return String(value).replace(/\s+/g, ' ').slice(0, max);
}

async function main() {
  const client = new Client(dbOptions());
  await client.connect();
  try {
    const { rows } = await client.query(`
      SELECT q.id AS question_id, q.content, q.solution_text,
             o.id AS option_id, o.content AS option_content
      FROM questions q
      JOIN (
        SELECT DISTINCT jsonb_array_elements_text(mt.question_ids) AS question_id
        FROM mock_tests mt
        WHERE mt.deleted_at IS NULL
      ) used ON used.question_id = q.id::text
      LEFT JOIN question_options o
        ON o.question_id = q.id AND o.deleted_at IS NULL
      WHERE q.deleted_at IS NULL
      ORDER BY q.id, o.sort_order
    `);

    const questionChanges = new Map();
    const optionChanges = [];
    for (const row of rows) {
      if (!questionChanges.has(row.question_id)) {
        const content = addMathDelimiters(row.content);
        const solutionText = addMathDelimiters(row.solution_text);
        if (content !== row.content || solutionText !== row.solution_text) {
          questionChanges.set(row.question_id, {
            oldContent: row.content,
            content,
            oldSolutionText: row.solution_text,
            solutionText,
          });
        }
      }
      if (row.option_id) {
        const content = addMathDelimiters(row.option_content);
        if (content !== row.option_content) {
          optionChanges.push({ id: row.option_id, oldContent: row.option_content, content });
        }
      }
    }

    console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ${questionChanges.size} question(s), ${optionChanges.length} option(s) would change.`);
    for (const [id, change] of [...questionChanges].slice(0, 20)) {
      console.log(`question ${id}: ${preview(change.oldContent)} -> ${preview(change.content)}`);
      if (change.oldSolutionText !== change.solutionText) {
        console.log(`solution ${id}: ${preview(change.oldSolutionText)} -> ${preview(change.solutionText)}`);
      }
    }
    for (const change of optionChanges.slice(0, 20)) {
      console.log(`option ${change.id}: ${preview(change.oldContent)} -> ${preview(change.content)}`);
    }

    if (!APPLY || (!questionChanges.size && !optionChanges.length)) return;

    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS mock_test_math_backfill_audit (
        id bigserial PRIMARY KEY,
        entity_type text NOT NULL,
        entity_id uuid NOT NULL,
        old_content text,
        old_solution_text text,
        changed_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    for (const [id, change] of questionChanges) {
      await client.query(
        `INSERT INTO mock_test_math_backfill_audit
           (entity_type, entity_id, old_content, old_solution_text)
         VALUES ('question', $1, $2, $3)`,
        [id, change.oldContent, change.oldSolutionText],
      );
      await client.query(
        'UPDATE questions SET content = $2, solution_text = $3, updated_at = now() WHERE id = $1',
        [id, change.content, change.solutionText],
      );
    }
    for (const change of optionChanges) {
      await client.query(
        `INSERT INTO mock_test_math_backfill_audit (entity_type, entity_id, old_content)
         VALUES ('option', $1, $2)`,
        [change.id, change.oldContent],
      );
      await client.query(
        'UPDATE question_options SET content = $2, updated_at = now() WHERE id = $1',
        [change.id, change.content],
      );
    }
    await client.query('COMMIT');
    console.log('Backfill committed. Original values are in mock_test_math_backfill_audit.');
  } catch (error) {
    if (APPLY) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

module.exports = { addMathDelimiters };
