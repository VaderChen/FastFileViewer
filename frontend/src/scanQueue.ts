const chunkCapacity = 256;
interface PathChunk { paths: string[]; next?: PathChunk }

class PathQueue {
  private first?: PathChunk;
  private last?: PathChunk;
  private readIndex = 0;
  private writeIndex = 0;
  private count = 0;

  get length(): number { return this.count; }

  push(path: string) {
    if (!this.last || this.writeIndex === chunkCapacity) {
      const chunk = { paths: new Array<string>(chunkCapacity) };
      if (this.last) this.last.next = chunk;
      else this.first = chunk;
      this.last = chunk;
      this.writeIndex = 0;
    }
    this.last.paths[this.writeIndex++] = path;
    this.count++;
  }

  shift(): string | undefined {
    if (!this.length) return undefined;
    const chunk = this.first!;
    const path = chunk.paths[this.readIndex];
    chunk.paths[this.readIndex++] = ''; // Release consumed paths immediately.
    this.count--;
    if (this.readIndex === chunkCapacity) {
      this.first = chunk.next;
      chunk.next = undefined;
      this.readIndex = 0;
    }
    if (!this.count) {
      this.first = this.last = undefined;
      this.readIndex = this.writeIndex = 0;
    }
    return path;
  }
}

// Equivalent to a stable priority partition after each append. Classify once,
// retaining FIFO order within each priority instead of repeatedly sorting.
export class ScanQueue {
  private preferred = new PathQueue();
  private remaining = new PathQueue();
  private readonly isPreferred?: (path: string) => boolean;

  constructor(isPreferred?: (path: string) => boolean) { this.isPreferred = isPreferred; }

  get length(): number { return this.preferred.length + this.remaining.length; }

  push(path: string) {
    (this.isPreferred?.(path) ? this.preferred : this.remaining).push(path);
  }

  shift(): string | undefined {
    return this.preferred.length ? this.preferred.shift() : this.remaining.shift();
  }
}
