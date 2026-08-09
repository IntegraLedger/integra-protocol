export class KernelError extends Error {
  // Declared-and-assigned rather than a `public readonly` constructor parameter: parameter properties
  // are TypeScript-only syntax that cannot be erased, and the workspace compiles under
  // `erasableSyntaxOnly` so every source file stays valid under Node's native type stripping.
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "KernelError";
  }
}
