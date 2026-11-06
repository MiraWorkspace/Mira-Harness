import { resolve } from 'node:path'

export function miraHome(packaged: boolean, env: NodeJS.ProcessEnv, defaultHome: string) {
  return (!packaged || env.MIRA_PACKAGED_TEST_MODE === '1') && env.MIRA_TEST_HOME ? resolve(env.MIRA_TEST_HOME) : defaultHome
}
