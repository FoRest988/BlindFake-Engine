import { createGameServer } from './server.js';

createGameServer().listen().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
