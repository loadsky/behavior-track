type Task = () => void;

export class Scheduler {
  private queue: Task[] = [];
  private running = false;

  schedule(task: Task): void {
    this.queue.push(task);
    if (!this.running) {
      this.flush();
    }
  }

  private flush(): void {
    this.running = true;
    const run = () => {
      const task = this.queue.shift();
      if (!task) {
        this.running = false;
        return;
      }
      task();
      if (this.queue.length > 0) {
        this.nextTick(run);
      } else {
        this.running = false;
      }
    };
    this.nextTick(run);
  }

  private nextTick(fn: () => void): void {
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(() => fn(), { timeout: 2000 });
    } else {
      setTimeout(fn, 0);
    }
  }

  clear(): void {
    this.queue = [];
    this.running = false;
  }
}
