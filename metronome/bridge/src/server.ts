import 'dotenv/config';
import { createRuntime, log } from './runtime.js';

async function main() {
  const { cfg, chainId, prisma, submitter, app, ctx } = await createRuntime();
  await submitter.start();
  await app.listen({ port: cfg.port, host: '0.0.0.0' });
  log.info({ port: cfg.port, chainId, vault: cfg.vault, relayers: ctx.chain.relayers.length }, 'bridge listening');

  const shutdown = async () => {
    await app.close();
    await submitter.stop();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.error({ err: String(err) }, 'bridge failed to start');
  process.exit(1);
});
