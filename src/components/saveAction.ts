export type SaveActionState = {
  status: "idle" | "saving" | "saved" | "error";
  error: string | null;
};

/** Success describes a completed local flush, not an optimistic in-memory update. */
export class SaveAction {
  private state: SaveActionState = { status: "idle", error: null };
  private listeners = new Set<() => void>();
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(state: SaveActionState) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
  edited = () => {
    if (this.state.status !== "saving") this.publish({ status: "idle", error: null });
  };
  run = async (change: () => void | Promise<void>, flush: () => Promise<void>): Promise<boolean> => {
    if (this.state.status === "saving") return false;
    this.publish({ status: "saving", error: null });
    try {
      await change();
      await flush();
      this.publish({ status: "saved", error: null });
      return true;
    } catch (error) {
      this.publish({
        status: "error",
        error: error instanceof Error ? error.message : "Unable to save. Your inputs are still here; try again.",
      });
      return false;
    }
  };
}
