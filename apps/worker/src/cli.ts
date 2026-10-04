/**
 * Operator CLI. In containers: `docker compose run --rm worker node dist/cli.js <command>`.
 * Locally: `pnpm --filter @nm/worker cli <command>`.
 */
import { eq } from 'drizzle-orm';
import { getConfig, getLogger } from '@nm/core';
import { closeDb, getDb } from '@nm/db';
import { runMigrations } from '@nm/db/migrate';
import { sources } from '@nm/db/schema';
import { seedDevelopment, seedTopics } from '@nm/db/seed';
import { monthToDateSpend } from '@nm/services/ai/budget';
import { createProcessDeps, processArticles, requeueArticles } from '@nm/services/ai/process';
import { createIngestDeps, ingestSource, runIngestion } from '@nm/services/ingestion/ingest';
import { createSearchBackend, createTypesense } from '@nm/services/search/search';
import { rebuildSearchIndex, syncSearchIndex } from '@nm/services/search/sync';

function requireTypesense() {
  const index = createTypesense();
  if (!index) throw new Error('TYPESENSE_URL / TYPESENSE_API_KEY are not set');
  return index;
}

function flagValues(args: string[], flag: string): string[] {
  return args.flatMap((arg, i) => (arg === flag && args[i + 1] ? [args[i + 1]!] : []));
}

type Command = { describe: string; run: (args: string[]) => Promise<void> };

const commands: Record<string, Command> = {
  migrate: {
    describe: 'Apply pending database migrations',
    run: async () => {
      const url = getConfig().DATABASE_URL;
      if (!url) throw new Error('DATABASE_URL is not set');
      await runMigrations(url);
      console.log('migrations applied');
    },
  },
  seed: {
    describe: 'Load development data (topics, example sources, sample articles). Dev only.',
    run: async () => {
      await seedDevelopment(getDb(), getConfig().APP_ENV);
      console.log('development seed loaded');
    },
  },
  'seed-topics': {
    describe: 'Insert the default topic list (safe in every environment)',
    run: async () => {
      const inserted = await seedTopics(getDb());
      console.log(`${inserted} topics inserted`);
    },
  },
  ingest: {
    describe: 'Fetch due sources now (or: --source <id> [--source <id>])',
    run: async (args) => {
      const ids = flagValues(args, '--source');
      const summary = await runIngestion(createIngestDeps(getDb()), {
        trigger: 'cli',
        sourceIds: ids.length ? ids : undefined,
      });
      console.log(JSON.stringify({ ...summary, results: undefined }, null, 2));
    },
  },
  process: {
    describe: 'Rewrite/translate queued articles now (or: --article <id>)',
    run: async (args) => {
      const ids = flagValues(args, '--article');
      const summary = await processArticles(createProcessDeps(getDb()), {
        trigger: 'cli',
        articleIds: ids.length ? ids : undefined,
      });
      console.log(JSON.stringify(summary, null, 2));
    },
  },
  reprocess: {
    describe: 'Put articles back in the AI queue: reprocess <id> [<id> ...]',
    run: async (ids) => {
      console.log(`${await requeueArticles(getDb(), ids)} article(s) queued`);
    },
  },
  'llm-spend': {
    describe: 'LLM spend this month vs. the budget',
    run: async () => {
      const spent = await monthToDateSpend(getDb());
      const budget = getConfig().LLM_MONTHLY_BUDGET_USD;
      console.log(`$${spent.toFixed(4)} of $${budget} (${((spent / budget) * 100).toFixed(1)}%)`);
    },
  },
  'index-sync': {
    describe: 'Push new/changed articles to Typesense now',
    run: async () => {
      console.log(await syncSearchIndex(getDb(), requireTypesense()));
    },
  },
  reindex: {
    describe: 'Drop and rebuild the Typesense collection from PostgreSQL',
    run: async () => {
      console.log(await rebuildSearchIndex(getDb(), requireTypesense()));
    },
  },
  search: {
    describe: 'Query the search backend: search <text> [--locale bg|en] [--topic slug]',
    run: async (args) => {
      const q = args
        .filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'))
        .join(' ');
      const locale = flagValues(args, '--locale')[0] === 'en' ? 'en' : 'bg';
      const backend = createSearchBackend(getDb());
      const result = await backend.search({ q, locale, topic: flagValues(args, '--topic')[0] });
      console.log(`${backend.kind}: ${result.found} found`);
      for (const hit of result.hits) console.log(`- ${hit.publishedAt.slice(0, 10)}  ${hit.title}`);
    },
  },
  'add-source': {
    describe:
      'Add a source: --url <feed> --name <name> [--lang bg] [--kind rss|html --selector <css>] [--images-allowed]',
    run: async (args) => {
      const [url] = flagValues(args, '--url');
      const [name] = flagValues(args, '--name');
      if (!url || !name) throw new Error('--url and --name are required');
      const [kind] = flagValues(args, '--kind');
      const [row] = await getDb()
        .insert(sources)
        .values({
          url,
          name,
          language: flagValues(args, '--lang')[0] ?? 'bg',
          kind: kind === 'html' ? 'html' : 'rss',
          linkSelector: flagValues(args, '--selector')[0] ?? null,
          imagesAllowed: args.includes('--images-allowed'),
        })
        .returning({ id: sources.id });
      console.log(row!.id);
    },
  },
  'test-source': {
    describe: 'Dry-run one source: list what would be ingested, without saving (<id>)',
    run: async ([id]) => {
      if (!id) throw new Error('usage: test-source <source id>');
      const [source] = await getDb().select().from(sources).where(eq(sources.id, id));
      if (!source) throw new Error(`source ${id} not found`);
      const result = await ingestSource(createIngestDeps(getDb()), source, { dryRun: true });
      console.log(JSON.stringify(result, null, 2));
    },
  },
  help: {
    describe: 'List available commands',
    run: async () => {
      for (const [name, command] of Object.entries(commands)) {
        console.log(`  ${name.padEnd(18)} ${command.describe}`);
      }
    },
  },
};

async function main() {
  const [name = 'help', ...args] = process.argv.slice(2);
  const command = commands[name];
  if (!command) {
    console.error(`Unknown command "${name}". Run "help" for the list.`);
    process.exit(2);
  }
  try {
    await command.run(args);
  } finally {
    await closeDb();
  }
}

main().catch((error: unknown) => {
  getLogger({ service: 'cli' }).error({ err: error }, 'command failed');
  process.exit(1);
});
