export function capture() {
  const sink = { text: '', write(s) { sink.text += s; return true; } };
  return sink;
}
