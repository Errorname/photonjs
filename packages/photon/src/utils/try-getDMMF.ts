import fs from 'fs'
import { enums } from '../fixtures/enums'
import { getDMMF, getRawDMMF } from './getDMMF'

async function main() {
  console.log('fetching dmmf')
  const dmmf = await getRawDMMF(enums)
  fs.writeFileSync(__dirname + '/enums-dmmf.json', JSON.stringify(dmmf, null, 2))
}

main().catch(console.error)
