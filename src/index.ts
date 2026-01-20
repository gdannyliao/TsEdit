import path from "path";
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { existsSync, readFileSync } from "fs";
import { TsObfusBuilder as TsObfuseBuilder } from "./TsObfusBuilder";
import process from "process";
import * as fs from 'fs/promises';
import { RenameMap } from "./RenameMapBuilder";

const version = "2.0.2"
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

  if (args['reset-uuid']) {
    obfusBuilder.resetUUID()
  }

  const scanner = obfusBuilder.build()
  scanner.scan()
  scanner.saveSync()
  console.log("obfus success")
})()