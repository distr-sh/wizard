// Progress goes to stderr, so stdout carries only the result a coding agent parses.
export function info(message: string): void {
  process.stderr.write(`${message}\n`);
}

export function result(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
