import { describe, expect, jest, test } from '@jest/globals'
import { CeramicAnchorServer } from '../../server.js'
import { logger } from '../../logger/index.js'
import request from 'supertest'
import { Config } from 'node-config-ts'

const FAUX_CONFIG = {} as Config

describe('CeramicAnchorServer', () => {
  describe('error handling middleware', () => {
    test('should log errors with the express error logger when a controller throws an error', async () => {
      // Define a mock controller with a GET route that throws an error
      const error = new Error('Test error message')
      const mockController = {
        path: '/mock',
        router: {
          get: jest.fn((req, res, next) => {
            throw error
          }),
        },
      }

      // Create a new instance of CeramicAnchorServer with the mock controller and an empty config object
      const server = new CeramicAnchorServer([mockController], FAUX_CONFIG)

      // spy on logger
      const loggerSpy = jest.spyOn(logger, 'log')

      // Call the server's start method to start listening for requests
      await server.start()

      // Use supertest to send a GET request to the mock controller's route
      const response = await request(server.app).get('/mock')

      // Assert that the response status is 500
      expect(response.status).toBe(500)

      const errorData = {
        type: 'error',
        message: error.message,
        stack: error.stack || '',
        status: 500,
        originalUrl: '/mock',
        baseUrl: '',
        path: '/mock',
        sourceIp: '',
        did: '',
      }
      expect(loggerSpy).toHaveBeenCalledWith(errorData)

      // Stop the server
      server.stop()
    })
  })
})
