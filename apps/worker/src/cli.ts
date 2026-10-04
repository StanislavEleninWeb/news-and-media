/**
 * Operator CLI. In containers: `docker compose run --rm worker node dist/cli.js <command>`.
 * Locally: `pnpm --filter @nm/worker cli <command>`.
 */
import { getConfig, getLogger } from '@nm/core';
import { closeDb, getDb } from '@nm/db';
import { runMigrations } from '@nm/db/migrate';
import { seedDevelopment, seedTopics } from '@nm/db/seed';

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
