import {spawn} from 'node:child_process';

export type RunResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type RunOptions = {
  cwd?: string;
  input?: string;
  /** Streams the output to stderr while the command runs. */
  show?: boolean;
};

export function run(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {cwd: options.cwd, stdio: ['pipe', 'pipe', 'pipe']});
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (options.show) {
        process.stderr.write(chunk);
      }
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      if (options.show) {
        process.stderr.write(chunk);
      }
    });
    child.on('error', (error) => resolve({code: 127, stdout, stderr: `${stderr}${error.message}`}));
    child.on('close', (code) => resolve({code: code ?? 1, stdout, stderr}));
    child.stdin.end(options.input ?? '');
  });
}

export function docker(args: string[], options: RunOptions = {}): Promise<RunResult> {
  return run('docker', args, options);
}
