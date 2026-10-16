type RandomArray = Uint8Array<ArrayBuffer> | Uint32Array<ArrayBuffer>;
type PkceCrypto = {
  getRandomValues?: (value: RandomArray) => RandomArray;
  randomUUID?: () => string;
  subtle?: {
    digest?: (
      algorithm: string | { name: string },
      data: BufferSource,
    ) => Promise<ArrayBuffer>;
  };
};
export function ensurePkceCrypto(
  target: { crypto?: PkceCrypto },
  native: {
    fill: (value: RandomArray) => RandomArray;
    uuid: () => string;
    sha256: (data: BufferSource) => Promise<ArrayBuffer>;
  },
): void {
  const current = target.crypto ?? {};
  // Preserve full implementations (for example the browser). Hermes does
  // not provide WebCrypto by default; Supabase would otherwise fall back to
  // Math.random and a plain PKCE challenge. Supply the native primitives it uses.
  if (typeof current.getRandomValues !== "function")
    current.getRandomValues = (value) => native.fill(value);
  if (typeof current.randomUUID !== "function")
    current.randomUUID = () => native.uuid();
  if (typeof current.subtle?.digest !== "function")
    current.subtle = {
      ...current.subtle,
      digest: (algorithm, data) => {
        const name = typeof algorithm === "string" ? algorithm : algorithm.name;
        if (name.toUpperCase() !== "SHA-256")
          return Promise.reject(
            new Error(
              "Only SHA-256 is supported by the native PKCE crypto adapter.",
            ),
          );
        return native.sha256(data);
      },
    };
  if (!target.crypto)
    Object.defineProperty(target, "crypto", {
      configurable: true,
      value: current,
    });
}
