import { describe, expect, it } from 'vitest';
import { simulate } from './simulate';

function outputs(steps: Array<{ output?: string }>) {
  return steps.flatMap((s) => (s.output ? [s.output] : []));
}

describe('P2.2 simulate(code) — subset (chains + multi-statement + async fn calls)', () => {
  it('Promise.resolve().then(A).then(B) => A,B', () => {
    const r = simulate(`Promise.resolve().then(() => console.log("A")).then(() => console.log("B"));`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(outputs(r.steps)).toEqual(['A', 'B']);
  });

  it('Promise.reject().then(A).catch(B) => B', () => {
    const r = simulate(`Promise.reject().then(() => console.log("A")).catch(() => console.log("B"));`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(outputs(r.steps)).toEqual(['B']);
  });

  it('Promise.resolve().finally(F).then(T) => F,T', () => {
    const r = simulate(`Promise.resolve("x").finally(() => console.log("F")).then(() => console.log("T"));`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(outputs(r.steps)).toEqual(['F', 'T']);
  });


  it('multi-statement: async fn call + Promise.then ordering (like case2, but different names)', () => {
    const code = `async function foo() {
  await Promise.resolve();
  console.log("A1");
}

foo();
Promise.resolve().then(() => console.log("B1"));
`;
    const r = simulate(code);
    expect(r.ok).toBe(true);
    if (r.ok) expect(outputs(r.steps)).toEqual(['A1', 'B1']);
  });

  it('realistic snippet: const p1 + named handlers + innerTask multiple awaits (subset)', () => {
    const code = `const p1 = Promise.resolve();

const innerTask = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  console.log('innerTask');
}

const task1 = async () => {
  console.log('task1');

  innerTask();
}

const task2 = () => {
  console.log('task2')
}

const task3 = async () => {
  console.log('task3');
}

p1.then(task1).then(task2).then(task3);
`;

    const r = simulate(code);
    expect(r.ok).toBe(true);
    if (r.ok) expect(outputs(r.steps)).toEqual(['task1', 'task2', 'innerTask', 'task3']);
  });

  it('async function with multiple awaits (subset)', () => {
    const code = `async function f2() {
  console.log("A");
  await Promise.resolve();
  console.log("B");
}

f2();
`;
    const r = simulate(code);
    expect(r.ok).toBe(true);
    if (r.ok) expect(outputs(r.steps)).toEqual(['A', 'B']);
  });

  it('handler calls inner async (subset; like case6 but different names)', () => {
    const code = `const inner2 = async () => {
  await Promise.resolve();
  console.log("X1");
};

Promise.resolve()
  .then(async () => {
    inner2();
  })
  .then(() => {
    console.log("Y1");
  });
`;

    const r = simulate(code);
    expect(r.ok).toBe(true);
    if (r.ok) expect(outputs(r.steps)).toEqual(['X1', 'Y1']);
  });

  it('handler awaits inner async (subset; await inner2() changes ordering)', () => {
    const code = `const inner2 = async () => {
  await Promise.resolve();
  console.log("X1");
};

Promise.resolve()
  .then(async () => {
    await inner2();
    console.log("Z1");
  })
  .then(() => {
    console.log("Y1");
  });
`;

    const r = simulate(code);
    expect(r.ok).toBe(true);
    if (r.ok) expect(outputs(r.steps)).toEqual(['X1', 'Z1', 'Y1']);
  });

  it('then() handler returns inner async promise (subset; adoption) => X1,Y1', () => {
    const code = `const inner2 = async () => {
  await Promise.resolve();
  console.log("X1");
};

Promise.resolve()
  .then(() => inner2())
  .then(() => console.log("Y1"));
`;

    const r = simulate(code);
    expect(r.ok).toBe(true);
    if (r.ok) expect(outputs(r.steps)).toEqual(['X1', 'Y1']);
  });

  it('then() handler returns inner2().then(sync cb) (subset; adoption) => X1,Z1,Y1', () => {
    const code = `const inner2 = async () => {
  await Promise.resolve();
  console.log("X1");
};

Promise.resolve()
  .then(() => inner2().then(() => console.log("Z1")))
  .then(() => console.log("Y1"));
`;

    const r = simulate(code);
    expect(r.ok).toBe(true);
    if (r.ok) expect(outputs(r.steps)).toEqual(['X1', 'Z1', 'Y1']);
  });

  it('then() handler returns inner2().then(async cb with awaits) (subset; adoption) => X1,Z0,Z1,Y1', () => {
    const code = `const inner2 = async () => {
  await Promise.resolve();
  console.log("X1");
};

Promise.resolve()
  .then(() =>
    inner2().then(async () => {
      console.log("Z0");
      await Promise.resolve();
      console.log("Z1");
    })
  )
  .then(() => console.log("Y1"));
`;

    const r = simulate(code);
    expect(r.ok).toBe(true);
    if (r.ok) expect(outputs(r.steps)).toEqual(['X1', 'Z0', 'Z1', 'Y1']);
  });

  it('fire-and-forget: inner2().then(Z1); console.log(Y1) => Y1,X1,T1,Z1', () => {
    const code = `const inner2 = async () => {
  await Promise.resolve();
  console.log("X1");
};

Promise.resolve()
  .then(() => {
    inner2().then(() => console.log("Z1"));
    console.log("Y1");
  })
  .then(() => console.log("T1"));
`;

    const r = simulate(code);
    expect(r.ok).toBe(true);
    if (r.ok) expect(outputs(r.steps)).toEqual(['Y1', 'X1', 'T1', 'Z1']);
  });

  it('fire-and-forget: inner2().then(async cb with await) => Y1,X1,T1,Z0,Z1', () => {
    const code = `const inner2 = async () => {
  await Promise.resolve();
  console.log("X1");
};

Promise.resolve()
  .then(() => {
    inner2().then(async () => {
      console.log("Z0");
      await Promise.resolve();
      console.log("Z1");
    });
    console.log("Y1");
  })
  .then(() => console.log("T1"));
`;

    const r = simulate(code);
    expect(r.ok).toBe(true);
    if (r.ok) expect(outputs(r.steps)).toEqual(['Y1', 'X1', 'T1', 'Z0', 'Z1']);
  });

  it('handler returns inner async (subset; return inner2() behaves like awaiting for chain)', () => {
    const code = `const inner2 = async () => {
  await Promise.resolve();
  console.log("X1");
};

Promise.resolve()
  .then(async () => {
    return inner2();
    console.log("Z1");
  })
  .then(() => {
    console.log("Y1");
  });
`;

    const r = simulate(code);
    expect(r.ok).toBe(true);
    if (r.ok) expect(outputs(r.steps)).toEqual(['X1', 'Y1']);
  });

  it('handler returns await inner async (subset; return await inner2() behaves like awaiting)', () => {
    const code = `const inner2 = async () => {
  await Promise.resolve();
  console.log("X1");
};

Promise.resolve()
  .then(async () => {
    return await inner2();
    console.log("Z1");
  })
  .then(() => {
    console.log("Y1");
  });
`;

    const r = simulate(code);
    expect(r.ok).toBe(true);
    if (r.ok) expect(outputs(r.steps)).toEqual(['X1', 'Y1']);
  });

  it('handler returns inner async .then (subset; return inner2().then(Z1) blocks chain until Z1)', () => {
    const code = `const inner2 = async () => {
  await Promise.resolve();
  console.log("X1");
};

Promise.resolve()
  .then(async () => {
    return inner2().then(() => console.log("Z1"));
  })
  .then(() => {
    console.log("Y1");
  });
`;

    const r = simulate(code);
    expect(r.ok).toBe(true);
    if (r.ok) expect(outputs(r.steps)).toEqual(['X1', 'Z1', 'Y1']);
  });

  it('handler returns inner async .then(async cb) (subset; cb may await Promise.resolve)', () => {
    const code = `const inner2 = async () => {
  await Promise.resolve();
  console.log("X1");
};

Promise.resolve()
  .then(async () => {
    return inner2().then(async () => {
      await Promise.resolve();
      console.log("Z1");
    });
  })
  .then(() => {
    console.log("Y1");
  });
`;

    const r = simulate(code);
    expect(r.ok).toBe(true);
    if (r.ok) expect(outputs(r.steps)).toEqual(['X1', 'Z1', 'Y1']);
  });

  it('handler returns inner async .then(async cb with multiple stmts) ordering: X1,Z0,Z1,Y1', () => {
    const code = `const inner2 = async () => {
  await Promise.resolve();
  console.log("X1");
};

Promise.resolve()
  .then(async () => {
    return inner2().then(async () => {
      console.log("Z0");
      await Promise.resolve();
      console.log("Z1");
    });
  })
  .then(() => {
    console.log("Y1");
  });
`;

    const r = simulate(code);
    expect(r.ok).toBe(true);
    if (r.ok) expect(outputs(r.steps)).toEqual(['X1', 'Z0', 'Z1', 'Y1']);
  });
});
