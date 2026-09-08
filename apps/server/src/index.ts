import { createApp } from './app.js';

const port = Number(process.env['PORT'] ?? 3210);
// Loopback only. Reaching Narrate from a phone on the LAN is a deliberate,
// later decision (see docs/decisions), not an accident of binding 0.0.0.0.
const host = '127.0.0.1';

createApp().listen(port, host, () => {
  console.log(`narrate server listening on http://${host}:${port}`);
});
