export async function createApp() {
  return {
    get: () => ({ all: () => [] }),
    close: () => Promise.resolve(),
  };
}
