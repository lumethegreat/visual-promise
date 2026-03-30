import type { DatasetCaseId } from './expected';

export const SNIPPETS: Record<DatasetCaseId, string> = {
  1: `async function example() {
  console.log("start");
  const result = await Promise.resolve(42);
  console.log(result);
  return result;
}

example();
`,
  2: `async function example() {
  await Promise.resolve();
  console.log("A");
}

example();
Promise.resolve().then(() => console.log("B"));
`,
  3: `Promise.resolve()
  .then(() => {
    console.log("A");
  })
  .then(() => {
    console.log("B");
  });
`,
  4: `Promise.resolve()
  .then(async () => {
    console.log("A");
  })
  .then(() => {
    console.log("B");
  });
`,
  5: `async function f() {
  console.log("A");
  await Promise.resolve();
  console.log("B");
  await Promise.resolve();
  console.log("C");
}

f();
`,
  6: `const inner = async () => {
  await Promise.resolve();
  console.log("X");
};

Promise.resolve()
  .then(async () => {
    inner();
  })
  .then(() => {
    console.log("Y");
  });
`
};
