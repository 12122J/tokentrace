import { open } from 'node:fs/promises';
import { nowIso } from './util.mjs';

export class EventWriter {
  constructor(path) {
    this.path = path;
    this.handlePromise = open(path, 'a');
  }

  async write(type, data = {}) {
    const handle = await this.handlePromise;
    const event = {
      type,
      timestamp: nowIso(),
      ...data
    };
    await handle.appendFile(`${JSON.stringify(event)}\n`);
    return event;
  }

  async close() {
    const handle = await this.handlePromise;
    await handle.close();
  }
}
