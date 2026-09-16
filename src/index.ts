import path from "path";
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { existsSync, readFileSync } from "fs";
import { TsObfusBuilder as TsObfuseBuilder } from "./TsObfusBuilder";
import process from "process";
import * as fs from 'fs/promises';
import { RenameMap } from "./RenameMapBuilder";

const version = "2.0.3"
const args = yargs(hideBin(process.argv)).scriptName(`ts-obfus`)
  .option('project', {
    type: 'string', description: '要处理的ts项目路径', require: true, alias: 'p'
  })
  .option('rename', {
    type: 'boolean', description: '是否对类和属性进行重命名', alias: 'r'
  })
  .option('name-map', {
    type: 'string', description: '名称映射关系文件路径，未指定的类和属性将会被随机重命名', alias: 'n', implies: 'rename'
  })
  .option('keep', {
    type: 'string', description: '要保留的符号名，以类全名为首行，后跟-PROPERTY_NAME作为此类的属性名', alias: 'k'
  })
  .option('split-method', {
    type: 'boolean', description: '是否将方法拆分成多个函数', alias: 's'
  })
  .option('reset-uuid', {
    type: 'boolean', description: '是否重置所有类的uuid, 仅在cocos项目中生效', alias: 'ru'
  })
  .option('uuid-scope', {
    type: 'string',
    description: 'uuid 重置范围：相对 assets/ 的路径前缀，逗号分隔（如 "Piggies/,Script/"）。' +
      '不传 = 全量重置。用于一个工程里存在多份资源、只该给本包换身份的场景',
    requiresArg: true
  })
  .option('seed', {
    type: 'string',
    description: '随机种子：决定改名与拆分的随机名。同一 seed 必得同一产物（可复现），' +
      '不同包给不同 seed 即差异化。不传则回落 projectDir（历史行为）',
    requiresArg: true
  })
  .option('emit-name-map', {
    type: 'string',
    description: '把本次改名映射（old→new 全量）写成 JSON。审计凭证：改名是一次性随机的，' +
      '不落盘则事后无从回答"两个包有没有改到同一个名字"',
    requiresArg: true
  })
  .version(version)
  .showVersion("log")
  .parseSync()



function isCocosProject(projectDir: string): boolean {
  const projectJsonFile = path.join(projectDir, "project.json")
  if (!existsSync(projectJsonFile)) {
    return false
  }

  const projectJson = JSON.parse(readFileSync(projectJsonFile, "utf-8"))
  if ('engine' in projectJson && projectJson['engine'].includes('cocos')) {
    return true
  }
  return false
}

async function parseKeepMap(filePath: string): Promise<Map<string, Set<string>>> {
  const data = await fs.readFile(filePath, 'utf-8');
  const lines = data
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  const result = new Map<string, Set<string>>();
  let className: string | undefined = undefined;

  for (const line of lines) {
    if (line === "--") {
      if (className !== undefined) {
        result.get(className)!.add(className); //-- 表示保留类名
      }
    }else if (line.startsWith('-')) {
      const propertyName = line.substring(1); // 去掉 `-`
      if (className !== undefined) {
        result.get(className)!.add(propertyName);
      }
    } else {
      className = line;
      result.set(className, new Set());
    }
  }

  return result;
}


async function parseNameMap(filePath: string): Promise<Map<string, RenameMap>> {
  const data = await fs.readFile(filePath, 'utf-8');
  const lines = data
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  const result = new Map<string, RenameMap>();
  let className: string | undefined = undefined;
  for (const line of lines) {
    if (line.startsWith('-')) {
      const propertyName = line.substring(1); // 去掉 `-`
      const renameMap = result.get(className!)!
      const [oldName, newName] = propertyName.split('=');
      renameMap.setProperty(oldName, newName)
    } else {
      const [oldName, newName] = line.split('=');
      result.set(oldName, new RenameMap(oldName, newName));
      className = oldName
    }
  }

  return result;
}


(async () => {
  const obfusBuilder = new TsObfuseBuilder().setProjectDir(args.project)

  if (args['seed']) {
    obfusBuilder.setSeed(args['seed'])
    console.log(`[seed] 使用显式种子 ${args['seed']}`)
  } else if (args['rename'] || args['split-method']) {
    // 回落 projectDir 是历史行为；但它是"不可复现 + 跨包可能撞车"的来源，
    // 值得提示一句（存量调用方不受影响，只是多行日志）。
    console.log(`[seed] 未指定 --seed，回落到 projectDir（产物随目录路径变化，不可复现）`)
  }

  if (args['keep']) {
    const file = args['keep']
    if (!existsSync(file)) {
      console.error(`文件${file}不存在`)
    }
    obfusBuilder.setKeepMap(await parseKeepMap(file))
  }

  if (args['rename']) {
    obfusBuilder.rename(args['name-map'] ? await parseNameMap(args['name-map']) : undefined, isCocosProject(args.project) ? "cocos" : undefined)
  }

  if (args['split-method']) {
    obfusBuilder.splitMethod()
  }

  if (args['uuid-scope']) {
    if (!args['reset-uuid']) {
      console.error('--uuid-scope 需要与 --reset-uuid 同时使用（单独给范围不会重置任何 uuid）')
    }
    const prefixes = String(args['uuid-scope'])
      .split(',').map(s => s.trim()).filter(s => s.length > 0)
      .map(s => s.endsWith('/') ? s : `${s}/`)
    obfusBuilder.resetUUIDInScope(prefixes)
  } else if (args['reset-uuid']) {
    obfusBuilder.resetUUID()
  }

  const scanner = obfusBuilder.build()
  scanner.scan()
  scanner.saveSync()
  obfusBuilder.saveSceneRefs()

  if (args['emit-name-map']) {
    obfusBuilder.writeNameMap(String(args['emit-name-map']))
    console.log(`[name-map] 改名凭证已写入 ${args['emit-name-map']}`)
  }

  console.log("obfus success")
})()