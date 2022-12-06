import type { Config } from 'node-config-ts'
import cloneDeep from 'lodash.clonedeep'

function replaceBools(o: object): void {
  for (const prop of Object.keys(o)) {
    if (o[prop] === 'true' || o[prop] === 'false') {
      o[prop] = o[prop] === 'true'
    }
    if (o[prop] !== null && typeof o[prop] === 'object') {
      replaceBools(o[prop])
    }
  }
}

/**
 * Handles normalizing the arguments passed via the config, for example turning string
 * representations of booleans and numbers into the proper types
 */
export function normalizeConfig(config: Config): void {
  config.mode = config.mode.trim().toLowerCase()
  if (typeof config.merkleDepthLimit == 'string') {
    config.merkleDepthLimit = parseInt(config.merkleDepthLimit, 10)
  }
  replaceBools(config)
}

/**
 * Returns a copy of the config with any sensitive information removed so it is safe to display.
 */
export function cleanupConfigForLogging(config: Config): Record<string, any> {
  const configCopy = cloneDeep(config)
  delete configCopy?.blockchain?.connectors?.ethereum?.account?.privateKey
  delete configCopy?.anchorLauncherUrl
  return configCopy
}
