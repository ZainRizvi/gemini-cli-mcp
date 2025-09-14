// Jest setup file
beforeEach(() => {
  // Clear any environment variables that might affect tests
  delete process.env.GEMINI_TEST_MODE;

  // Mock console methods to avoid cluttering test output
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  // Restore console methods
  jest.restoreAllMocks();
});