import path from "node:path";
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CocosInvokeGraph } from "./CocosInvokeGraph.ts";
import { existsSync, readFileSync } from "node:fs";
import { TsObfusBuilder as TsObfuseBuilder } from "./TsObfusBuilder.ts";
import process from "node:process";
import * as fs from 'node:fs/promises';

const args = yargs(hideBin(process.argv)).scriptName("ts-rename")
  .option('project', {
    type: 'string', description: '要处理的ts项目路径', require: true, alias: 'p'
  })
  .option('name-map', {
    type: 'string', description: '名称映射关系文件路径', alias: 'n'
  })
  .option('random', {
    type: 'boolean', description: '是否随机重命名', alias: 'r'
  })
  .option('keep', {
    type: 'string', description: '要保留的符号名，以类全名为首行，后跟-PROPERTY_NAME作为此类的属性名', alias: 'k'
  })
  .check((argv) => {
    if (!argv['name-map'] && !argv['random']) {
      throw new Error("请指定名称映射文件或指定随机重命名")
    }
    return true
  })
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
  return true
}

async function parseFileToMap(filePath: string): Promise<Map<string, Set<string>>> {
  const data = await fs.readFile(filePath, 'utf-8');
  const lines = data
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  const result = new Map<string, Set<string>>();
  let className: string | null = null;

  for (const line of lines) {
    if (line.startsWith('-')) {
      const propertyName = line.substring(1); // 去掉 `-`
      result.get(className!)!.add(propertyName);
    } else {
      className = line;
      result.set(className, new Set());
    }
  }

  return result;
}

if (!isCocosProject(args.project)) {
  console.error("不是cocos项目")
  process.exit(1)
}


const obfusBuilder = new TsObfuseBuilder().setProjectDir(args.project)
if (args['keep']) {
  const file = args['keep']
  if (!existsSync(file)) {
    console.error(`文件${file}不存在`)
  }
  obfusBuilder.setKeepMap(await parseFileToMap(file))
}

obfusBuilder.rename(CocosInvokeGraph)
obfusBuilder.splitMethod()

const scanner = obfusBuilder.build()
scanner.scan()
scanner.saveSync()
console.log("obfus success")