import { Engine, PhotonError } from './Engine'
import got from 'got'
import Process from './process'
import Deferred from 'deferral'
import through from 'through2'
import debugLib from 'debug'
import { getPlatform, Platform } from '@prisma/get-platform'
import * as path from 'path'
import * as net from 'net'
import fs from 'fs'
import chalk from 'chalk'
import { GeneratorConfig } from '@prisma/cli'
import { printGeneratorConfig } from './printGeneratorConfig'
import { fixPlatforms, plusX } from './util'

const debug = debugLib('engine')

interface EngineConfig {
  cwd?: string
  datamodel: string
  debug?: boolean
  prismaPath?: string
  platform?: Platform
  fetcher?: (query: string) => Promise<{ data?: any; error?: any }>
  generator?: GeneratorConfig
}

/**
 * Global process list so node.js doesn't get all uptight
 * about "Possible EventEmitter memory leak detected. 11 SIGTERM listeners added"
 */
const processes: Process[] = []

/**
 * Pass the signals through
 */
// process.on('beforeExit', () => {
//   processes.map(proc => proc.signal('SIGTERM'))
// })
// process.once('SIGTERM', sig => processes.map(proc => proc.signal(sig)))
// process.once('SIGINT', sig => processes.map(proc => proc.signal(sig)))

/**
 * Node.js based wrapper to run the Prisma binary
 */
export class NodeEngine extends Engine {
  port?: number
  debug: boolean
  child?: Process
  /**
   * exiting is used to tell the .on('exit') hook, if the exit came from our script.
   * As soon as the Prisma binary returns a correct return code (like 1 or 0), we don't need this anymore
   */
  exiting: boolean = false
  managementApiEnabled: boolean = false
  datamodelJson?: string
  cwd: string
  datamodel: string
  prismaPath?: string
  url: string
  starting?: Deferred<void>
  stderrLogs: string = ''
  stdoutLogs: string = ''
  currentRequestPromise?: Promise<any>
  cwdPromise: Promise<string>
  platformPromise: Promise<Platform>
  platform?: Platform
  generator?: GeneratorConfig

  constructor({ cwd, datamodel, prismaPath, platform, generator, ...args }: EngineConfig) {
    super()
    this.cwd = cwd
    this.debug = args.debug || false
    this.datamodel = datamodel
    this.prismaPath = prismaPath
    this.platform = platform
    this.generator = generator
    if (!platform) {
      this.getPlatform()
    }
    if (this.debug) {
      debugLib.enable('engine')
    }
  }

  async getPlatform() {
    if (this.platformPromise) {
      return this.platformPromise
    }

    this.platformPromise = getPlatform()

    return this.platformPromise
  }

  private async resolvePrismaPath() {
    if (this.prismaPath) {
      return this.prismaPath
    }

    const platform = await this.getPlatform()
    if (this.platform && this.platform !== platform) {
      console.log(`${chalk.yellow('Warning:')} You pinned the platform ${chalk.bold(
        this.platform,
      )}, but Photon detects ${chalk.bold(platform)}.
This means you should very likely pin the platform ${chalk.greenBright(platform)} instead.
${chalk.dim("In case we're mistaken, please report this to us 🙏.")}`)
    }

    this.platform = this.platform || platform

    const fileName = eval(`path.basename(__filename)`)
    if (fileName === 'NodeEngine.js') {
      return path.join(__dirname, `../query-engine-${this.platform}`)
    } else {
      return path.join(__dirname, `query-engine-${this.platform}`)
    }
  }

  private async getPrismaPath() {
    const prismaPath = await this.resolvePrismaPath()
    if (!fs.existsSync(prismaPath)) {
      let info = '.'
      if (this.generator) {
        const fixedGenerator = {
          ...this.generator,
          platforms: fixPlatforms(this.generator.platforms as Platform[], this.platform!),
        }
        info = `:\n${chalk.greenBright(printGeneratorConfig(fixedGenerator))}`
      }

      throw new Error(
        `Photon binary for current platform ${chalk.bold(this.platform)} could not be found.
Make sure to add it to your generator configuration in the schema.prisma file${info}
${chalk.gray(
  `Note, that by providing \`native\`, Photon automatically resolves \`${this.platform}\`.
Read more about deploying Photon: ${chalk.underline(
    'https://github.com/prisma/prisma2/blob/master/docs/core/generators/photonjs.md',
  )}`,
)}`,
      )
    }

    plusX(prismaPath)

    return prismaPath
  }

  /**
   * Starts the engine, returns the url that it runs on
   */
  async start(): Promise<void> {
    if (this.starting) {
      return this.starting.wait()
    }
    this.starting = new Deferred()
    this.child = new Process(await this.getPrismaPath())

    // set the working directory
    if (this.cwd) {
      this.child.cwd(this.cwd)
    }

    this.port = await this.getFreePort()

    debugLib('node-engine', process.env)

    // add the environment
    this.child.env({
      ...process.env,
      PRISMA_DML: this.datamodel,
      PORT: String(this.port),
      RUST_BACKTRACE: '1',
    })

    // proxy stdout and stderr
    this.child.stderr(
      debugStream(data => {
        this.stderrLogs += data
        debugLib('engine:stderr')(data)
      }),
    )
    this.child.stdout(
      debugStream(data => {
        this.stdoutLogs += data
        debugLib('engine:stdout')(data)
      }),
    )

    // start the process
    await this.child.start()

    // add process to processes list
    processes.push(this.child)

    // wait for the engine to be ready
    // TODO: we should fix this since it's not obvious what's happening
    // here. We wait for the engine to try and connect, if it fails
    // we'll try to kill the child. Often times the child is already
    // dead and will also throw. We prefer that error over engineReady's
    // error, so we take that first. If there wasn't an error, we'll use
    // engineReady's error.
    try {
      await this.engineReady()
    } catch (err) {
      await this.child.kill()
      throw err
    }

    const url = `http://localhost:${this.port}`
    this.url = url

    // resolve starting to unlock other stakeholders
    this.starting.resolve()
    return
  }

  fail = async (e, why) => {
    debug(e, why)
    await this.stop()
  }

  /**
   * If Prisma runs, stop it
   */
  async stop() {
    await this.start()
    if (this.currentRequestPromise) {
      try {
        await this.currentRequestPromise
      } catch (e) {
        //
      }
    }
    if (this.child) {
      debug(`Stopping Prisma engine`)
      this.exiting = true
      await this.child.kill()
      delete this.child
      // cleanup processes array
      const i = processes.indexOf(this.child)
      if (~i) processes.splice(i, 1)
    }
  }

  /**
   * Use the port 0 trick to get a new port
   */
  protected getFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer(s => s.end(''))
      server.unref()
      server.on('error', reject)
      server.listen(0, () => {
        const address = server.address()
        const port = typeof address === 'string' ? parseInt(address.split(':').slice(-1)[0], 10) : address.port
        server.close(e => {
          if (e) {
            reject(e)
          }
          resolve(port)
        })
      })
    })
  }

  /**
   * Make sure that our internal port is not conflicting with the prisma.yml's port
   * @param str config
   */
  protected trimPort(str: string) {
    return str
      .split('\n')
      .filter(l => !l.startsWith('port:'))
      .join('\n')
  }

  // TODO: Replace it with a simple tcp connection
  protected async engineReady() {
    let tries = 0
    while (true) {
      if (!this.child) {
        return
      } else if (!(await this.child.running())) {
        throw new Error('Engine has died')
      }
      try {
        await new Promise(r => setTimeout(r, 50)) // TODO: Try out lower intervals here, but we also don't want to spam it too much.
        const response = await got(`http://localhost:${this.port}/status`, {
          timeout: 5000, // not official but node-fetch supports it
        })
        debug(`Ready after try number ${tries}`)
        return
      } catch (e) {
        debug(e.message)
        if (tries >= 100) {
          throw e
        }
      } finally {
        tries++
      }
    }
  }

  async getDmmf(): Promise<any> {
    const result = await got.get(this.url + '/dmmf', {
      json: true,
    })
    return result.body.data
  }

  async request<T>(query: string, typeName?: string): Promise<T> {
    await this.start()

    if (!this.child) {
      throw new Error(`Engine has already been stopped`)
    }
    this.currentRequestPromise = got
      .post(this.url, {
        json: true,
        headers: {
          'Content-Type': 'application/json',
        },
        body: { query, variables: {}, operationName: '' },
      })
      .then(({ body }) => {
        const errors = body.error || body.errors
        if (errors) {
          return this.handleErrors({
            errors,
            query,
          })
        }
        return body.data
      })
      .catch(errors => {
        if (errors.code && errors.code === 'ECONNRESET') {
          const logs = this.stderrLogs || this.stdoutLogs
          throw new Error(logs)
        }
        if (!(errors instanceof PhotonError)) {
          return this.handleErrors({ errors, query })
        } else {
          throw errors
        }
      })
    return this.currentRequestPromise
  }

  private serializeErrors(errors: any) {
    // make the happy case beautiful
    if (Array.isArray(errors) && errors.length === 1 && errors[0].error && typeof errors[0].error === 'string') {
      return errors[0].error
    }

    return JSON.stringify(errors, null, 2)
  }

  handleErrors({ errors, query }: { errors?: any; query: string }) {
    const stringified = errors ? this.serializeErrors(errors) : null
    const message = stringified.length > 0 ? stringified : `Error in photon.\$\{rootField || 'query'}`
    const isPanicked = this.stderrLogs.includes('panicked')
    if (isPanicked) {
      this.stop()
    }
    throw new PhotonError(message, query, errors, this.stderrLogs + this.stdoutLogs, isPanicked)
  }
}

// simple utility function to turn debug into a writable stream
function debugStream(debugFn: any): NodeJS.WritableStream {
  return through(function(chunk, _enc, fn) {
    debugFn(chunk.toString())
    fn()
  })
}
