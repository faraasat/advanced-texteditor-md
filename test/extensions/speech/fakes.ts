/** Fakes of SpeechRecognition and speechSynthesis for jsdom, driven by the tests. */
export class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  processLocally?: boolean;
  started = false;
  aborted = false;
  stopped = false;
  onstart: ((e: unknown) => void) | null = null;
  onend: ((e: unknown) => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  onresult: ((e: { resultIndex: number; results: unknown }) => void) | null = null;
  results: (any)[] = [];
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    if (this.started) throw new Error("InvalidStateError");
    this.started = true;
    queueMicrotask(() => this.onstart?.({}));
  }
  stop() {
    this.stopped = true;
    queueMicrotask(() => this.end());
  }
  abort() {
    this.aborted = true;
    this.end();
  }
  end() {
    if (!this.started) return;
    this.started = false;
    this.onend?.({});
  }
  /** Emit a result event: `parts` are [transcript, isFinal] from `index` on. */
  say(parts: [string, boolean][], index = this.results.length) {
    this.results.length = index;
    for (const [t, f] of parts) this.results.push(Object.assign([{ transcript: t, confidence: 0.9 }], { isFinal: f }));
    this.onresult?.({ resultIndex: index, results: this.results });
  }
  fail(code: string) {
    this.onerror?.({ error: code });
  }
  static get last() {
    return FakeRecognition.instances[FakeRecognition.instances.length - 1];
  }
}

export class FakeUtterance {
  voice: unknown = null;
  lang = "";
  rate = 1;
  pitch = 1;
  onstart: ((e: unknown) => void) | null = null;
  onend: ((e: unknown) => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  onboundary: ((e: { name?: string; charIndex?: number; charLength?: number }) => void) | null = null;
  constructor(public text = "") {}
}

export class FakeSynth {
  spoken: FakeUtterance[] = [];
  current: FakeUtterance | null = null;
  paused = false;
  speaking = false;
  cancelled = 0;
  voices: { name: string; lang: string }[] = [];
  getVoices() {
    return this.voices;
  }
  speak(u: FakeUtterance) {
    this.spoken.push(u);
    this.current = u;
    this.speaking = true;
    queueMicrotask(() => u.onstart?.({}));
  }
  cancel() {
    this.cancelled++;
    const u = this.current;
    this.current = null;
    this.speaking = false;
    if (u) queueMicrotask(() => u.onerror?.({ error: "canceled" }));
  }
  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
  }
  /** Finish the current utterance. */
  finish() {
    const u = this.current;
    this.current = null;
    this.speaking = false;
    u?.onend?.({});
  }
  word(w: string, nth = 0) {
    const u = this.current!;
    let i = -1;
    for (let k = 0; k <= nth; k++) i = u.text.indexOf(w, i + 1);
    u.onboundary?.({ name: "word", charIndex: i, charLength: w.length });
  }
}

export function installRecognition(name: "SpeechRecognition" | "webkitSpeechRecognition" = "SpeechRecognition") {
  FakeRecognition.instances = [];
  (window as any)[name] = FakeRecognition;
  return () => {
    delete (window as any)[name];
  };
}

export function installSynthesis() {
  const synth = new FakeSynth();
  (window as any).speechSynthesis = synth;
  (window as any).SpeechSynthesisUtterance = FakeUtterance;
  return {
    synth,
    uninstall() {
      delete (window as any).speechSynthesis;
      delete (window as any).SpeechSynthesisUtterance;
    },
  };
}
