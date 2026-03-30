/**
 * Cross-version mock.timers.enable() compatibility helper.
 *
 * Node 18: enable(["setTimeout"])        — array form
 * Node 20+: enable({ apis: ["setTimeout"] }) — object form
 */

interface TestContext {
  mock: {
    timers: {
      enable(arg: unknown): void;
      tick(ms: number): void;
    };
  };
}

const nodeMajor = parseInt(process.version.slice(1), 10);

export function enableTimerMock(t: TestContext): void {
  if (nodeMajor < 20) {
    t.mock.timers.enable(["setTimeout"]);
  } else {
    t.mock.timers.enable({ apis: ["setTimeout"] });
  }
}
