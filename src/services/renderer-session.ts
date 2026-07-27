/** Tracks renderer identity/readiness independently of Electron. */
export class RendererSession<TSender> {
  private sender: TSender | null = null;
  private ready = false;
  private generation = 0;
  private detached = false;
  attach(sender: TSender): number { this.sender = sender; this.ready = false; this.detached = false; return ++this.generation; }
  teardown(sender: TSender): boolean { if (this.sender !== sender || this.detached) return false; this.ready = false; ++this.generation; return true; }
  detach(sender: TSender): boolean { if (this.sender !== sender || this.detached) return false; this.ready = false; this.detached = true; this.sender = null; ++this.generation; return true; }
  acknowledgeReady(sender: TSender, generation: number): boolean { if (this.sender !== sender || this.detached || generation !== this.generation || this.ready) return false; this.ready = true; return true; }
  isAvailable(sender: TSender): boolean { return this.sender === sender && this.ready; }
  get currentGeneration(): number { return this.generation; }
}
