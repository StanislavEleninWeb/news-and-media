/**
 * Operator CLI. In containers: `docker compose run --rm worker node dist/cli.js <command>`.
 * Locally: `pnpm --filter @nm/worker cli <command>`.
 */
import { getLogger } from '@nm/core';

type Command = (args: string[]) => Promise<void>;

const commands: Record<string, { describe: string; run: Command }> = {
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
  await command.run(args);
}

main().catch((error: unknown) => {
  getLogger({ service: 'cli' }).error({ err: error }, 'command failed');
  process.exit(1);
});
