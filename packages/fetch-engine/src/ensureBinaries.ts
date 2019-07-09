import fs from 'fs'
import path from 'path'
import { download, downloadMigrationBinary } from './download'
import { promisify } from 'util'
import makeDir from 'make-dir'

const exists = promisify(fs.exists)

export async function ensureQueryEngineBinary(resultPath?: string, version?: string) {
  const runtimeDir = resultPath || (await getRuntimeDir())
  await makeDir(runtimeDir)
  const prisma = path.join(runtimeDir, 'prisma')
  await download(prisma, version)
}

export async function ensureMigrationBinary(resultPath: string, version?: string) {
  await makeDir(resultPath)
  const prisma = path.join(resultPath, 'migration-engine')
  await downloadMigrationBinary(prisma, version)
}

async function getRuntimeDir() {
  let runtimeDir = path.join(__dirname, '../runtime')
  if (await exists(runtimeDir)) {
    return runtimeDir
  }
  runtimeDir = path.join(__dirname, '../../runtime')
  if (await exists(runtimeDir)) {
    return runtimeDir
  }
  // node_modules/fetch-engine/run.js
  runtimeDir = path.join(__dirname, '../../../runtime')
  if (await exists(runtimeDir)) {
    return runtimeDir
  }
  throw new Error(`Cannot download binaries as path ${runtimeDir} does not exist`)
}
