import type {ReadStream} from 'node:tty';

export type InputState = {value: string; done: boolean; cancelled: boolean};

// Arrow and function keys, and the markers of bracketed paste, arrive as escape sequences that can share a chunk
// with typed or pasted characters.
const escapeSequence = /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|O.|.)?/g;

export function applyInput(value: string, chunk: string): InputState {
  for (const char of chunk.replace(escapeSequence, '')) {
    if (char === '\u0003') {
      return {value: '', done: false, cancelled: true};
    } else if (char === '\r' || char === '\n' || char === '\u0004') {
      return {value, done: true, cancelled: false};
    } else if (char === '\u007f' || char === '\b') {
      value = value.slice(0, -1);
    } else if (char >= ' ') {
      value += char;
    }
  }
  return {value, done: false, cancelled: false};
}

export function readHidden(
  prompt: string,
  input: ReadStream,
  output: NodeJS.WritableStream
): Promise<string | undefined> {
  return new Promise((resolve) => {
    let value = '';
    const onData = (chunk: string) => {
      const state = applyInput(value, chunk);
      value = state.value;
      if (state.done || state.cancelled) {
        input.off('data', onData);
        input.setRawMode(false);
        input.pause();
        output.write('\n');
        resolve(state.cancelled ? undefined : value);
      }
    };
    output.write(prompt);
    input.setEncoding('utf8');
    input.setRawMode(true);
    input.on('data', onData);
    input.resume();
  });
}
