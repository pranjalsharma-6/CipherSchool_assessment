import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createContainer } from './container.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const container = await createContainer(config);
  const app = createApp(container);

  const server = app.listen(config.PORT, () => {
    console.log(
      JSON.stringify({
        message: 'server.listening',
        port: config.PORT,
        storage: config.MONGODB_URI ? 'mongodb' : 'in-memory',
        reviewer: container.reviewer,
      }),
    );
  });

  // Finish in-flight evaluations before exiting rather than losing them.
  const shutdown = async (signal: string): Promise<void> => {
    console.log(JSON.stringify({ message: 'server.shutting_down', signal }));
    server.close();
    await container.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('server.failed_to_start', error);
  process.exit(1);
});
