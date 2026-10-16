import { describe, expect, it, vi } from "vitest";
import { LocationSelection } from "../apps/mobile/src/core/location-selection";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("Dismissed location selection", () => {
  it("closes a delayed map-pin resolution without applying its late location", async () => {
    const selection = new LocationSelection();
    const response = deferred<{ name: string }>();
    let visibleLocation = { name: "Original place" },
      busy = false;
    let providerSignal!: AbortSignal;
    const error = vi.fn();
    const pending = selection.run(
      (signal) => {
        providerSignal = signal;
        return response.promise; // Deliberately model a provider ignoring abort.
      },
      {
        busy: (value) => {
          busy = value;
        },
        accept: (place) => {
          visibleLocation = place;
        },
        error,
      },
    );
    expect(busy).toBe(true);
    selection.cancel(); // Shared by the sheet's X, Back and drag dismissal.
    expect(providerSignal.aborted).toBe(true);
    expect(busy).toBe(false);
    response.resolve({ name: "Dismissed pin" });
    await pending;
    expect(visibleLocation).toEqual({ name: "Original place" });
    expect(error).not.toHaveBeenCalled();
    expect(busy).toBe(false);
  });

  it("does not let a dismissed request clear or replace a new selection", async () => {
    const selection = new LocationSelection();
    const old = deferred<string>(),
      next = deferred<string>();
    let busy = false;
    const accept = vi.fn(),
      error = vi.fn();
    const actions = {
      busy: (value: boolean) => {
        busy = value;
      },
      accept,
      error,
    };
    const previous = selection.run(() => old.promise, actions);
    selection.cancel();
    const current = selection.run(() => next.promise, actions);
    old.resolve("Old location");
    await previous;
    expect(busy).toBe(true);
    expect(accept).not.toHaveBeenCalled();
    next.resolve("Chosen location");
    await current;
    expect(accept).toHaveBeenCalledExactlyOnceWith("Chosen location");
    expect(busy).toBe(false);
  });

  it("suppresses a late dismissed error and accepts a subsequent normal choice", async () => {
    const selection = new LocationSelection();
    const response = deferred<string>();
    const busy = vi.fn(),
      accept = vi.fn(),
      error = vi.fn();
    const pending = selection.run(() => response.promise, {
      busy,
      accept,
      error,
    });
    selection.cancel();
    response.reject(new Error("Late point failure"));
    await pending;
    expect(error).not.toHaveBeenCalled();
    await selection.run(async () => "New place", { busy, accept, error });
    expect(accept).toHaveBeenCalledExactlyOnceWith("New place");
    expect(busy).toHaveBeenLastCalledWith(false);
  });
});
