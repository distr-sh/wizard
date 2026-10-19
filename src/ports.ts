import {createConnection} from 'node:net';

export function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({host: '127.0.0.1', port});
    socket.setTimeout(2_000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', (error: NodeJS.ErrnoException) => resolve(error.code !== 'ECONNREFUSED'));
  });
}
