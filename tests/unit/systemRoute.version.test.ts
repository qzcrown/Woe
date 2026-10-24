describe('system route version metadata', () => {
  beforeEach(() => {
    jest.resetModules()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('returns generated version/buildDate and ignores env VERSION across repeated /version calls', async () => {
    const generatedVersion = '2.3.4'
    const generatedBuildDate = '2026-04-03T00:00:00.000Z'

    jest.doMock(
      '../../src/generated/buildInfo.ts',
      () => ({
        buildInfo: {
          version: generatedVersion,
          buildDate: generatedBuildDate
        }
      }),
      { virtual: true }
    )

    const { system } = await import('../../src/routes/system')

    jest.useFakeTimers()
    jest.setSystemTime(new Date('2030-01-01T00:00:00.000Z'))

    const response1 = await system.fetch(
      new Request('http://localhost/version', { method: 'GET' }),
      { VERSION: '9.9.9' } as any,
      {} as any
    )
    const body1 = (await response1.json()) as { version: string; buildDate: string }

    jest.setSystemTime(new Date('2040-01-01T00:00:00.000Z'))

    const response2 = await system.fetch(
      new Request('http://localhost/version', { method: 'GET' }),
      { VERSION: '9.9.9' } as any,
      {} as any
    )
    const body2 = (await response2.json()) as { version: string; buildDate: string }

    expect(response1.status).toBe(200)
    expect(response2.status).toBe(200)

    expect(response1.headers.get('cache-control')).toBe('no-store')
    expect(response2.headers.get('cache-control')).toBe('no-store')
    expect(body1.version).toBe(generatedVersion)
    expect(body2.version).toBe(generatedVersion)
    expect(body2.version).toBe(body1.version)
    expect(body1.buildDate).toBe(generatedBuildDate)
    expect(body2.buildDate).toBe(generatedBuildDate)
    expect(body2.buildDate).toBe(body1.buildDate)
  })

  test('returns buildInfo.version from /status without relying on env VERSION', async () => {
    const generatedVersion = '3.4.5'
    const generatedBuildDate = '2026-04-04T00:00:00.000Z'

    jest.doMock(
      '../../src/generated/buildInfo.ts',
      () => ({
        buildInfo: {
          version: generatedVersion,
          buildDate: generatedBuildDate
        }
      }),
      { virtual: true }
    )

    jest.doMock('../../src/drizzle/index.ts', () => ({
      createDrizzle: jest.fn(() => ({
        $client: {
          prepare: jest.fn(() => ({
            first: jest.fn().mockResolvedValue({ test: 1 })
          }))
        }
      }))
    }))

    jest.doMock('../../src/services/initService.ts', () => ({
      InitService: jest.fn().mockImplementation(() => ({
        isSystemInitialized: jest.fn().mockResolvedValue(true)
      }))
    }))

    const { system } = await import('../../src/routes/system')

    const response = await system.fetch(
      new Request('http://localhost/status', { method: 'GET' }),
      { VERSION: '8.8.8', DB: {} } as any,
      {} as any
    )
    const body = (await response.json()) as { initialized: boolean; version: string; health: string }

    expect(response.status).toBe(200)
    expect(body.initialized).toBe(true)
    expect(body.health).toBe('green')
    expect(body.version).toBe(generatedVersion)
  })
})
