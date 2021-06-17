process.env.NODE_ENV = 'test';


describe('Ceramic Integration Test',  () => {
  jest.setTimeout(10000);

  beforeAll(async () => {
  });

  beforeEach(async () => {
  });

  afterAll(async () => {
  });

  test('Basic integration', async () => {
    expect(true).toEqual(true)
  });

  test('Basic integration2', async () => {
    expect(true).toEqual(false)
  });


});
