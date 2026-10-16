// One location selection owns its loading state and may publish only while active.
// Closing the picker invalidates it even when a provider ignores cancellation.
export class LocationSelection {
  private active?: {
    controller: AbortController;
    busy: (value: boolean) => void;
  };

  cancel() {
    const operation = this.active;
    this.active = undefined;
    if (operation) {
      operation.controller.abort();
      operation.busy(false);
    }
  }

  async run<T>(
    load: (signal: AbortSignal) => Promise<T>,
    actions: {
      busy: (value: boolean) => void;
      accept: (value: T) => void;
      error: (error: unknown) => void;
    },
  ): Promise<void> {
    this.cancel();
    const operation = {
      controller: new AbortController(),
      busy: actions.busy,
    };
    this.active = operation;
    actions.busy(true);
    const current = () =>
      this.active === operation && !operation.controller.signal.aborted;
    try {
      const value = await load(operation.controller.signal);
      if (current()) actions.accept(value);
    } catch (error) {
      if (current()) actions.error(error);
    } finally {
      if (this.active === operation) {
        this.active = undefined;
        actions.busy(false);
      }
    }
  }
}
