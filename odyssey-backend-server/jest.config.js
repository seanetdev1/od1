module.exports = {
  // Sequelize sync({alter:true}) runs as a side effect of requiring
  // ../models (see models/index.js), and every integration test file
  // shares the same odyssey-test database - running them in parallel
  // workers would race that sync and stomp on each other's seeded rows.
  // Pure unit tests don't touch the DB at all, but pinning globally to 1
  // keeps this simple and correctness-first over speed for now.
  maxWorkers: 1,
  /* 60s, not the 20s this was.
   *
   * An integration test here drives real HTTP against real Postgres, and the
   * heavier routes are genuinely slow: POST /aviationJob/create takes 3-6
   * SECONDS, because it writes the flight, its consignments and their charge
   * lines and then reads the whole thing back through the same deep include
   * the screen uses. A setup hook that creates four flights therefore sits
   * right on 20s, and tipped over it whenever the machine was otherwise busy.
   *
   * That failed as EIGHT OR TEN timed-out tests in one block, all of them
   * naming the report they were about rather than the setup that never
   * finished - which reads as a broken feature and is not one. The suites
   * themselves take no longer for this; it only changes when jest gives up. */
  testTimeout: 60000,
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/unit/**/*.test.js'],
    },
    {
      displayName: 'integration',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/integration/**/*.test.js'],
      setupFilesAfterEnv: ['<rootDir>/tests/setupTestDb.js'],
      // puppeteer's package entry is ESM-only and can't be parsed by Jest's
      // default CJS transform; requiring the app (routes/invoice ->
      // functions/pdf.js) pulls it in even for tests unrelated to PDF
      // generation, so stub it at the module-resolution level.
      moduleNameMapper: {
        '^puppeteer$': '<rootDir>/tests/mocks/puppeteerMock.js',
      },
    },
  ],
};
